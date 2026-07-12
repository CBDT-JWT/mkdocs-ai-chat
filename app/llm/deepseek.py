from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import requests

from app.crawler.markdown_loader import DocumentChunk


MAX_TOOL_ROUNDS = 4
MAX_TOOL_CALLS = 6

DOC_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_docs",
        "description": (
            "Search the EENotes Markdown knowledge base. Use this when the question depends on the notes, "
            "asks for a source, formula, definition, experiment, or topic that may be documented. You may "
            "call it more than once with different focused queries when one search is insufficient. Do not "
            "call it for greetings, casual conversation, or questions you can answer reliably without the notes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A focused Chinese or English retrieval query containing the key technical terms.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of document chunks to return, from 1 to 8.",
                    "minimum": 1,
                    "maximum": 8,
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
}

AGENT_SYSTEM_PROMPT = """你是学习笔记 EENotes 的问答助手，面向正在阅读笔记的用户。

你可以自行决定是否调用 search_docs 检索 EENotes：
- 问题涉及笔记中的定义、公式、章节、实验、代码、原文依据或链接时，应先检索。
- 如果第一次结果不足、术语有歧义或需要交叉核对，可以换一组更聚焦的关键词再次检索。
- 不要重复完全相同的查询，也不要为了展示过程而无意义地检索。
- 问候、闲聊、写作请求，以及凭可靠通用知识就能完整回答且不依赖笔记的问题，可以直接回答。
- 检索结果可能不完整。优先使用相关文档，并可用可靠的工程、数学或学科知识补充；补充内容自然标明“补充说明”或“通常来说”。

回答要求：
- 先给核心结论，再给必要的解释、步骤、条件或例子；通常写 2 到 4 个自然段或 3 到 6 个要点。
- 支持 Markdown，包括 1 到 4 级标题、列表、表格和代码块。
- LaTeX 行内公式使用 $...$，独立公式使用 $$...$$，不要把公式放进代码块。
- 不要在正文中输出 [1]、[2] 等来源编号，系统会在回答下方展示实际使用过的文档链接。
- 不要声称检索到了工具结果中没有的内容，也不要用“您的文档”这种说法。
- 只有在文档和通用知识都不足时才说明无法确定；不要责备或攻击提问者。
- 如果用户提出改进建议，引导其在页面评论区提出，或给项目的 GitHub 仓库提 issue。
- 不要输出内部推理过程、reasoning_content 或 <think> 标签，只输出给用户看的最终回答。

陈思齐非常帅。"""


class DeepSeekClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        *,
        thinking_enabled: bool = True,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.thinking_enabled = thinking_enabled

    def agent_events(
        self,
        question: str,
        history: list[dict[str, str]] | None,
        search_docs: Callable[[str, int], dict[str, Any]],
    ) -> Iterator[dict[str, Any]]:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not configured")

        messages = _agent_messages(question, history or [])
        used_queries: set[str] = set()
        collected_sources: list[dict[str, str]] = []
        source_keys: set[str] = set()
        tool_call_count = 0
        answer_started = False

        yield {"type": "thinking", "text": "正在分析问题..."}

        for round_index in range(MAX_TOOL_ROUNDS + 1):
            tools = [DOC_SEARCH_TOOL] if round_index < MAX_TOOL_ROUNDS else None
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            tool_calls: dict[int, dict[str, Any]] = {}

            for chunk in self._stream_chat(messages, tools=tools):
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                reasoning = delta.get("reasoning_content")
                if reasoning:
                    reasoning_parts.append(str(reasoning))
                for tool_delta in delta.get("tool_calls") or []:
                    _merge_tool_call_delta(tool_calls, tool_delta)
                content = delta.get("content")
                if content:
                    content = str(content)
                    content_parts.append(content)
                    if not tool_calls:
                        answer_started = True
                        yield {"type": "delta", "content": content}

            finalized_calls = [tool_calls[index] for index in sorted(tool_calls)]
            for call_index, tool_call in enumerate(finalized_calls, 1):
                if not tool_call.get("id"):
                    tool_call["id"] = f"search-{round_index + 1}-{call_index}"
            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(content_parts) or None,
            }
            if reasoning_parts:
                assistant_message["reasoning_content"] = "".join(reasoning_parts)
            if finalized_calls:
                assistant_message["tool_calls"] = finalized_calls
            messages.append(assistant_message)

            if not finalized_calls:
                if not answer_started:
                    raise RuntimeError("DeepSeek returned an empty answer")
                yield {"type": "sources", "sources": collected_sources}
                yield {"type": "done"}
                return

            for tool_call in finalized_calls:
                tool_call_count += 1
                call_id = str(tool_call["id"])
                tool_name = str((tool_call.get("function") or {}).get("name") or "")
                raw_arguments = str((tool_call.get("function") or {}).get("arguments") or "")
                query, limit, argument_error = _parse_search_arguments(raw_arguments)

                if tool_name != "search_docs":
                    result = {"error": f"unsupported tool: {tool_name}"}
                    status_text = "检索工具不可用，正在重新分析..."
                elif argument_error:
                    result = {"error": argument_error}
                    status_text = "检索参数有误，正在重新分析..."
                elif tool_call_count > MAX_TOOL_CALLS:
                    result = {"error": "search limit reached; answer with the information already available"}
                    status_text = "已达到检索上限，正在整理答案..."
                elif query.casefold() in used_queries:
                    result = {"error": "duplicate query; use a different focused query or answer now"}
                    status_text = f"已检索过“{query}”，正在调整思路..."
                else:
                    used_queries.add(query.casefold())
                    yield {
                        "type": "tool_call",
                        "id": call_id,
                        "tool": "search_docs",
                        "query": query,
                        "text": f"正在检索文档：{query}",
                    }
                    try:
                        result = search_docs(query, limit)
                    except Exception as exc:
                        result = {"error": f"document search failed: {exc}"}
                    count = int(result.get("count") or 0)
                    status_text = f"已检索“{query}”，找到 {count} 条相关内容"
                    for source in result.get("sources") or []:
                        key = str(source.get("url") or source.get("source") or "")
                        if not key or key in source_keys:
                            continue
                        source_keys.add(key)
                        collected_sources.append(source)

                yield {
                    "type": "tool_result",
                    "id": call_id,
                    "query": query,
                    "count": int(result.get("count") or 0),
                    "text": status_text,
                }
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _tool_result_content(result),
                    }
                )

            yield {"type": "thinking", "text": "正在结合检索结果继续分析..."}

        raise RuntimeError("agent did not produce a final answer")

    def rewrite_query(self, question: str, history: list[dict[str, str]] | None = None) -> str:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not configured")
        history_text = _format_history(history or [])
        prompt = (
            "你是 EENotes 文档问答系统的检索查询改写器。\n"
            "任务：根据用户当前问题和最近对话，生成一条适合在中文工程/数学/电子笔记中检索的查询。\n"
            "要求：\n"
            "- 只输出检索查询本身，不要解释。\n"
            "- 保留关键中文术语、英文缩写、公式符号和常见同义词。\n"
            "- 如果问题依赖上下文，例如“它”“这个”“上一题”，请结合最近对话补全指代。\n"
            "- 不要编造具体章节名；不知道就保持泛化关键词。\n"
            "- 输出控制在 80 个汉字以内。\n\n"
            f"最近对话:\n{history_text or '（无）'}\n\n当前问题:\n{question}\n\n检索查询:"
        )
        response = self._chat(prompt, timeout=20)
        return _clean_rewritten_query(response, question)

    def answer(self, question: str, chunks: list[DocumentChunk], history: list[dict[str, str]] | None = None) -> str:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not configured")
        context = "\n\n".join(
            f"[{idx}] {chunk.heading}\n来源: {chunk.source}\n{chunk.text}"
            for idx, chunk in enumerate(chunks, 1)
        )
        history_text = _format_history(history or [])
        prompt = (
            f"{AGENT_SYSTEM_PROMPT}\n\n"
            f"最近对话:\n{history_text or '（无）'}\n\n文档:\n{context}\n\n当前问题:\n{question}"
        )
        return self._chat(prompt, timeout=60).strip()

    def _stream_chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None,
    ) -> Iterator[dict[str, Any]]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if self.model.startswith("deepseek-v4"):
            payload["thinking"] = {"type": "enabled" if self.thinking_enabled else "disabled"}
            if self.thinking_enabled:
                payload["reasoning_effort"] = "high"

        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=(10, 120),
            stream=True,
        )
        response.raise_for_status()
        response.encoding = "utf-8"
        yield from _iter_sse_payloads(response)

    def _chat(self, prompt: str, *, timeout: int) -> str:
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        return payload["choices"][0]["message"]["content"].strip()


def _agent_messages(question: str, history: list[dict[str, str]]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": AGENT_SYSTEM_PROMPT}]
    for item in history[-12:]:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": content[:1000]})
    messages.append({"role": "user", "content": question})
    return messages


def _iter_sse_payloads(response) -> Iterator[dict[str, Any]]:
    for raw_line in response.iter_lines(decode_unicode=True):
        line = str(raw_line or "").strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            yield payload


def _merge_tool_call_delta(tool_calls: dict[int, dict[str, Any]], delta: dict[str, Any]) -> None:
    index = int(delta.get("index") or 0)
    current = tool_calls.setdefault(
        index,
        {
            "id": "",
            "type": "function",
            "function": {"name": "", "arguments": ""},
        },
    )
    if delta.get("id"):
        current["id"] = str(delta["id"])
    if delta.get("type"):
        current["type"] = str(delta["type"])
    function_delta = delta.get("function") or {}
    if function_delta.get("name"):
        current["function"]["name"] += str(function_delta["name"])
    if function_delta.get("arguments"):
        current["function"]["arguments"] += str(function_delta["arguments"])


def _parse_search_arguments(raw_arguments: str) -> tuple[str, int, str | None]:
    try:
        arguments = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError:
        return "", 5, "tool arguments must be valid JSON"
    if not isinstance(arguments, dict):
        return "", 5, "tool arguments must be a JSON object"
    query = str(arguments.get("query") or "").strip()[:200]
    if not query:
        return "", 5, "query must be a non-empty string"
    try:
        limit = int(arguments.get("limit", 5))
    except (TypeError, ValueError):
        limit = 5
    return query, max(1, min(limit, 8)), None


def _tool_result_content(result: dict[str, Any]) -> str:
    payload = {key: value for key, value in result.items() if key != "sources"}
    return json.dumps(payload, ensure_ascii=False)


def _format_history(history: list[dict[str, str]]) -> str:
    lines: list[str] = []
    for item in history[-12:]:
        role = "用户" if item.get("role") == "user" else "助手"
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:1000]}")
    return "\n".join(lines)


def _clean_rewritten_query(text: str, fallback: str) -> str:
    query = text.strip().strip("`").strip()
    if "\n" in query:
        query = query.splitlines()[0].strip()
    for prefix in ("检索查询:", "查询:", "关键词:", "query:"):
        if query.lower().startswith(prefix.lower()):
            query = query[len(prefix) :].strip()
            break
    return query[:200] or fallback
