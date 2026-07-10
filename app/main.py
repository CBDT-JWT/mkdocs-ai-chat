from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque

from flask import Flask, jsonify, request

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
        results = state.retriever.retrieve(question)
        chunks = [chunk for chunk, _score in results]
        if not chunks:
            return jsonify({"answer": "知识库还没有可检索的文档。", "sources": []})
        answer = state.llm.answer(question, chunks)
        return jsonify(
            {
                "answer": answer,
                "sources": _sources(chunks),
            }
        )

    @app.route("/api/reindex", methods=["POST"])
    def reindex():
        if config.admin_token:
            token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if token != config.admin_token:
                return jsonify({"error": "unauthorized"}), 401
        state.sync_and_reindex()
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
        self.llm = DeepSeekClient(config.deepseek_api_key, config.deepseek_base_url, config.deepseek_model)
        self.last_sync: str | None = None
        self._sync_lock = threading.Lock()
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def sync_and_reindex(self) -> None:
        if not self._sync_lock.acquire(blocking=False):
            logging.info("sync already running")
            return
        try:
            logging.info("syncing %s", self.config.github_repo)
            commit = GitHubSync(self.config.github_repo, self.config.github_branch, self.config.repo_dir).sync()
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


def _sources(chunks: list) -> list[dict[str, str]]:
    seen: set[str] = set()
    sources: list[dict[str, str]] = []
    for chunk in chunks:
        key = chunk.url or chunk.source
        if key in seen:
            continue
        seen.add(key)
        sources.append({"title": chunk.heading or chunk.title, "url": chunk.url, "source": chunk.source})
    return sources


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
