from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import defaultdict, deque
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from flask import Flask, Response, jsonify, request, stream_with_context

from app.config import Settings, settings
from app.crawler.github_sync import GitHubSync
from app.crawler.markdown_loader import load_markdown_chunks
from app.llm.deepseek import DeepSeekClient
from app.rag.embedding import Embedder
from app.rag.retriever import Retriever
from app.rag.vector_store import VectorStore
from app.scheduler import Scheduler


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def create_app(config: Settings = settings) -> Flask:
    app = Flask(__name__)
    state = AppState(config)

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin", "*")
        allowed = [item.strip() for item in config.cors_origins.split(",") if item.strip()]
        if "*" in allowed or origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = "*" if "*" in allowed else origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "indexed_chunks": len(state.store.chunks), "last_sync": state.last_sync})

    @app.route("/api/chat", methods=["OPTIONS"])
    def chat_options():
        return "", 204

    @app.route("/api/chat", methods=["POST"])
    def chat():
        limited = state.rate_limited(request.remote_addr or "unknown")
        if limited:
            return jsonify({"error": "rate limit exceeded"}), 429
        payload = request.get_json(silent=True) or {}
        question = str(payload.get("question", "")).strip()
        if not question:
            return jsonify({"error": "question is required"}), 400
        history = _sanitize_history(payload.get("history", []))
        if _wants_event_stream():
            def generate():
                try:
                    for event in state.chat_events(question, history):
                        yield _sse(event)
                except Exception:
                    logging.exception("streaming chat failed")
                    yield _sse({"type": "error", "message": "回答生成失败，请稍后重试。"})

            return Response(
                stream_with_context(generate()),
                content_type="text/event-stream; charset=utf-8",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "X-Accel-Buffering": "no",
                },
            )

        try:
            answer, sources = state.chat_answer(question, history)
        except Exception:
            logging.exception("chat failed")
            return jsonify({"error": "回答生成失败，请稍后重试。"}), 502
        return jsonify({"answer": answer, "sources": sources})

    @app.route("/api/reindex", methods=["POST"])
    def reindex():
        if config.admin_token:
            token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if token != config.admin_token:
                return jsonify({"error": "unauthorized"}), 401
        try:
            state.sync_and_reindex()
        except Exception as exc:
            logging.exception("manual reindex failed")
            return jsonify({"status": "error", "error": str(exc)}), 500
        return jsonify({"status": "ok", "indexed_chunks": len(state.store.chunks), "last_sync": state.last_sync})

    if config.auto_sync_on_start:
        threading.Thread(target=state.sync_and_reindex, daemon=True, name="mkdocs-ai-initial-sync").start()
    else:
        state.store.load()

    Scheduler(config.sync_interval_hours * 3600, state.sync_and_reindex).start()
    return app


class AppState:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self.embedder = Embedder(config.embedding_model)
        self.store = VectorStore(config.index_dir)
        self.store.load()
        self.retriever = Retriever(self.embedder, self.store, config.top_k)
        self.llm = DeepSeekClient(
            config.deepseek_api_key,
            config.deepseek_base_url,
            config.deepseek_model,
            thinking_enabled=config.deepseek_thinking,
        )
        self.last_sync: str | None = None
        self._sync_lock = threading.Lock()
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def sync_and_reindex(self) -> None:
        if not self._sync_lock.acquire(blocking=False):
            logging.info("sync already running")
            return
        try:
            logging.info("syncing %s", self.config.github_repo)
            commit = GitHubSync(
                self.config.github_repo,
                self.config.github_branch,
                self.config.repo_dir,
                use_system_proxy=self.config.git_use_system_proxy,
            ).sync()
            chunks = load_markdown_chunks(
                self.config.repo_dir,
                self.config.doc_path,
                site_base_url=self.config.site_base_url,
                chunk_size=self.config.chunk_size,
                chunk_overlap=self.config.chunk_overlap,
            )
            vectors = self.embedder.encode([chunk.text for chunk in chunks])
            self.store.build(chunks, vectors)
            self.last_sync = commit
            logging.info("indexed %s chunks at %s", len(chunks), commit)
        finally:
            self._sync_lock.release()

    def rate_limited(self, key: str) -> bool:
        now = time.time()
        bucket = self._requests[key]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= self.config.rate_limit_per_minute:
            return True
        bucket.append(now)
        return False

    def chat_events(self, question: str, history: list[dict[str, str]]) -> Iterator[dict[str, Any]]:
        yield from self.llm.agent_events(question, history, self.search_docs)

    def chat_answer(
        self,
        question: str,
        history: list[dict[str, str]],
    ) -> tuple[str, list[dict[str, str]]]:
        answer_parts: list[str] = []
        sources: list[dict[str, str]] = []
        for event in self.chat_events(question, history):
            if event.get("type") == "delta":
                answer_parts.append(str(event.get("content") or ""))
            elif event.get("type") == "sources":
                sources = list(event.get("sources") or [])
        answer = "".join(answer_parts).strip()
        if not answer:
            raise RuntimeError("agent returned an empty answer")
        return answer, sources

    def search_docs(self, query: str, limit: int) -> dict[str, Any]:
        results = _answer_results(self.retriever.retrieve(query, limit), query)
        documents = [
            {
                "title": chunk.title,
                "heading": chunk.heading,
                "source": chunk.source,
                "url": chunk.url,
                "content": chunk.text[:1600],
            }
            for chunk, _score in results
        ]
        return {
            "query": query,
            "count": len(documents),
            "results": documents,
            "sources": _sources(results, query),
        }

    def rewrite_query(self, question: str, history: list[dict[str, str]]) -> str:
        try:
            query = self.llm.rewrite_query(question, history)
        except Exception:
            logging.exception("query rewrite failed; falling back to original question")
            return question
        if query and query != question:
            logging.info("rewrote retrieval query: %s -> %s", question, query)
        return query or question


def _sources(results: list[tuple], question: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    sources: list[dict[str, str]] = []
    if not results:
        return sources
    top_score = max(score for _chunk, score in results) or 1.0
    for chunk, score in results:
        if score < max(top_score * 0.55, 2.0):
            continue
        if not _source_matches_question(chunk, question):
            continue
        key = chunk.url or chunk.source
        if key in seen:
            continue
        seen.add(key)
        sources.append(
            {
                "title": chunk.heading or chunk.title,
                "url": _source_url_with_highlight(chunk.url, question, chunk),
                "source": chunk.source,
            }
        )
        if len(sources) >= 3:
            break
    return sources


def _answer_results(results: list[tuple], question: str) -> list[tuple]:
    if "sa" not in question.lower():
        return results
    filtered = [(chunk, score) for chunk, score in results if _source_matches_question(chunk, question)]
    return filtered or results


def _source_url_with_highlight(url: str, question: str, chunk) -> str:
    term = _highlight_term(question, chunk)
    if not url or not term:
        return url
    parts = urlsplit(url)
    query = f"{parts.query}&h={quote(term)}" if parts.query else f"h={quote(term)}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _highlight_term(question: str, chunk) -> str:
    if "sa" in question.lower():
        return "Sa"
    haystack = f"{chunk.heading}\n{chunk.text}"
    for token in re.findall(r"[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9_]{1,20}", question):
        if token in haystack:
            return token
    return chunk.heading or ""


def _source_matches_question(chunk, question: str) -> bool:
    haystack = f"{chunk.title}\n{chunk.heading}\n{chunk.source}\n{chunk.text}".lower()
    if "sa" in question.lower():
        return any(term in haystack for term in ("sinc", "抽样", "采样")) or bool(
            re.search(r"(?<![a-z0-9])sa(?![a-z0-9])", haystack)
        )
    return True


def _sanitize_history(value) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    history: list[dict[str, str]] = []
    for item in value[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        history.append({"role": role, "content": content[:1000]})
    return history


def _wants_event_stream() -> bool:
    return "text/event-stream" in request.headers.get("Accept", "").lower()


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
