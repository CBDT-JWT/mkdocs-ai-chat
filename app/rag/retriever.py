from __future__ import annotations

from app.crawler.markdown_loader import DocumentChunk
from app.rag.embedding import Embedder
from app.rag.vector_store import VectorStore


class Retriever:
    def __init__(self, embedder: Embedder, store: VectorStore, top_k: int) -> None:
        self.embedder = embedder
        self.store = store
        self.top_k = top_k

    def retrieve(self, question: str) -> list[tuple[DocumentChunk, float]]:
        query_vector = self.embedder.encode([question])[0]
        return self.store.search(query_vector, self.top_k)
