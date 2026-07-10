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
            "回答尽量简洁，并在相关结论后标注来源编号。\n\n"
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
