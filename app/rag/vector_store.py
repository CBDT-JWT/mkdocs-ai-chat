from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.crawler.markdown_loader import DocumentChunk


class VectorStore:
    def __init__(self, index_dir: Path) -> None:
        self.index_dir = index_dir
        self.chunks: list[DocumentChunk] = []
        self.vectors: np.ndarray | None = None
        self.faiss_index = None

    def build(self, chunks: list[DocumentChunk], vectors: np.ndarray) -> None:
        self.chunks = chunks
        self.vectors = vectors.astype("float32")
        self.faiss_index = self._build_faiss(self.vectors)
        self.save()

    def search(self, query_vector: np.ndarray, top_k: int) -> list[tuple[DocumentChunk, float]]:
        if not self.chunks or self.vectors is None:
            return []
        query = query_vector.astype("float32").reshape(1, -1)
        if self.faiss_index is not None:
            scores, ids = self.faiss_index.search(query, min(top_k, len(self.chunks)))
            return [
                (self.chunks[int(idx)], float(score))
                for idx, score in zip(ids[0], scores[0])
                if int(idx) >= 0
            ]

        scores = np.dot(self.vectors, query[0])
        ids = np.argsort(scores)[::-1][:top_k]
        return [(self.chunks[int(idx)], float(scores[int(idx)])) for idx in ids]

    def save(self) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)
        (self.index_dir / "chunks.json").write_text(
            json.dumps([chunk.__dict__ for chunk in self.chunks], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if self.vectors is not None:
            np.save(self.index_dir / "vectors.npy", self.vectors)
        if self.faiss_index is not None:
            try:
                import faiss

                faiss.write_index(self.faiss_index, str(self.index_dir / "index.faiss"))
            except Exception:
                pass

    def load(self) -> bool:
        chunks_path = self.index_dir / "chunks.json"
        vectors_path = self.index_dir / "vectors.npy"
        if not chunks_path.exists() or not vectors_path.exists():
            return False
        payload = json.loads(chunks_path.read_text(encoding="utf-8"))
        self.chunks = [DocumentChunk(**item) for item in payload]
        self.vectors = np.load(vectors_path).astype("float32")
        self.faiss_index = self._load_faiss() or self._build_faiss(self.vectors)
        return True

    @staticmethod
    def _build_faiss(vectors: np.ndarray):
        try:
            import faiss

            index = faiss.IndexFlatIP(vectors.shape[1])
            index.add(vectors)
            return index
        except Exception:
            return None

    def _load_faiss(self):
        path = self.index_dir / "index.faiss"
        if not path.exists():
            return None
        try:
            import faiss

            return faiss.read_index(str(path))
        except Exception:
            return None
