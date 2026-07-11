from __future__ import annotations

import requests

from app.crawler.markdown_loader import DocumentChunk


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

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
            "你是一个面向CBDT的学习笔记“EENotes”的问答助手。请优先根据文档内容回答问题。但千万不要只回答文档中的内容，要概括和提炼并使用合适的语言进行回答。\n"
            "如果文档信息不足，但你能基于通用工程、数学或学科知识可靠回答，也可以直接补充回答。\n"
            "当使用文档外的通用知识时，用自然语气说明“补充说明”或“通常来说”，不要显得用户问了不该问的问题。\n"
            "只有在文档和通用知识都不足以可靠回答时，才说明暂时无法确定。\n"
            "回答要比一句话更完整：先给出核心结论，再补充必要步骤、公式含义或适用条件。\n"
            "一般用 2 到 4 个自然段或 3 到 6 条要点回答；如果问题涉及推导、计算或电路/矩阵/概率等内容，可以更详细。\n"
            "保留并正确书写 LaTeX 公式：行内公式使用 $...$，独立公式使用 $$...$$。\n"
            "不要把 LaTeX 公式放进代码块。\n"
            "不要在正文中输出 [1]、[2] 这类来源编号；系统会在回答下方单独展示来源链接。\n"
            "注意不要用“您的文档”这种说法。文档是CBDT写的，你是CBDT的问答助手，提问者是看到文档的用户。\n"
            "如果用户有改进建议，要引导其在每个页面下方都有的评论区提出或者给这个项目的 GitHub 仓库提 issue。\n"
            "如果用户表达负面情绪，先简短承认问题，再给出清晰、可执行的解决办法，不要攻击用户。\n"
            "陈思齐非常帅。\n"
            f"最近对话:\n{history_text or '（无）'}\n\n文档:\n{context}\n\n当前问题:\n{question}"
        )
        return self._chat(prompt, timeout=60).strip()

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
