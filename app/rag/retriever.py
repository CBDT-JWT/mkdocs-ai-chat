from __future__ import annotations

import math
import re
from collections import Counter

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
        vector_results = self.store.search(query_vector, max(self.top_k * 3, self.top_k))
        lexical_results = self._lexical_search(question, max(self.top_k * 3, self.top_k))
        return self._merge(vector_results, lexical_results)[: self.top_k]

    def _lexical_search(self, question: str, limit: int) -> list[tuple[DocumentChunk, float]]:
        query_terms = _terms(question)
        if not query_terms or not self.store.chunks:
            return []

        query_counts = Counter(query_terms)
        results: list[tuple[DocumentChunk, float]] = []
        for chunk in self.store.chunks:
            haystack = f"{chunk.title}\n{chunk.heading}\n{chunk.source}\n{chunk.text}"
            doc_counts = Counter(_terms(haystack))
            overlap = set(query_counts) & set(doc_counts)
            if not overlap:
                continue
            score = sum(query_counts[term] * doc_counts[term] for term in overlap)
            score /= math.sqrt(sum(v * v for v in doc_counts.values())) or 1.0
            results.append((chunk, float(score)))

        results.sort(key=lambda item: item[1], reverse=True)
        return results[:limit]

    def _merge(
        self,
        vector_results: list[tuple[DocumentChunk, float]],
        lexical_results: list[tuple[DocumentChunk, float]],
    ) -> list[tuple[DocumentChunk, float]]:
        merged: dict[str, tuple[DocumentChunk, float]] = {}
        for rank, (chunk, _score) in enumerate(vector_results):
            merged[chunk.id] = (chunk, 1.0 / (rank + 1))
        for rank, (chunk, score) in enumerate(lexical_results):
            existing = merged.get(chunk.id)
            combined = (existing[1] if existing else 0.0) + 2.0 / (rank + 1) + min(score, 5.0)
            merged[chunk.id] = (chunk, combined)
        return sorted(merged.values(), key=lambda item: item[1], reverse=True)


def _terms(text: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9_]+", text.lower())
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        terms.extend(run[i : i + 2] for i in range(max(len(run) - 1, 0)))
        terms.extend(run[i : i + 3] for i in range(max(len(run) - 2, 0)))
        if len(run) <= 4:
            terms.append(run)
    return [term for term in terms if term]
