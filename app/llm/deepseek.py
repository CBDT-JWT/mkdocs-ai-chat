from __future__ import annotations

import requests

from app.crawler.markdown_loader import DocumentChunk


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    def answer(self, question: str, chunks: list[DocumentChunk]) -> str:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not configured")
        context = "\n\n".join(
            f"[{idx}] {chunk.heading}\n来源: {chunk.source}\n{chunk.text}"
            for idx, chunk in enumerate(chunks, 1)
        )
        prompt = (
            "你是一个文档助手。请根据以下文档内容回答问题。\n"
            "如果文档没有相关信息，请明确说明不知道，不要编造。\n"
            "回答要比一句话更完整：先给出核心结论，再补充必要步骤、公式含义或适用条件。\n"
            "一般用 2 到 4 个自然段或 3 到 6 条要点回答；如果问题涉及推导、计算或电路/矩阵/概率等内容，可以更详细。\n"
            "保留并正确书写 LaTeX 公式：行内公式使用 $...$，独立公式使用 $$...$$。\n"
            "不要把 LaTeX 公式放进代码块。\n"
            "在相关结论后标注来源编号，例如 [1]。\n\n"
            f"文档:\n{context}\n\n问题:\n{question}"
        )
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload["choices"][0]["message"]["content"].strip()
