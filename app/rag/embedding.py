from __future__ import annotations

import hashlib
import math
import re
from functools import cached_property

import numpy as np


class Embedder:
    def __init__(self, model_name: str, fallback_dimensions: int = 384) -> None:
        self.model_name = model_name
        self.fallback_dimensions = fallback_dimensions

    @cached_property
    def model(self):
        if not self.model_name or self.model_name.strip().lower() in {"hash", "fallback", "none"}:
            return None
        try:
            from sentence_transformers import SentenceTransformer

            return SentenceTransformer(self.model_name)
        except Exception:
            return None

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimensions), dtype="float32")
        if self.model is not None:
            vectors = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            return np.asarray(vectors, dtype="float32")
        return np.asarray([self._hash_embed(text) for text in texts], dtype="float32")

    @property
    def dimensions(self) -> int:
        return getattr(self.model, "get_sentence_embedding_dimension", lambda: self.fallback_dimensions)()

    def _hash_embed(self, text: str) -> np.ndarray:
        vector = np.zeros(self.fallback_dimensions, dtype="float32")
        tokens = _tokens(text)
        for token in tokens:
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            slot = int.from_bytes(digest[:4], "big") % self.fallback_dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[slot] += sign
        norm = math.sqrt(float(np.dot(vector, vector)))
        if norm:
            vector /= norm
        return vector


def _tokens(text: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9_]+", text.lower())
    cjk_runs = re.findall(r"[\u4e00-\u9fff]+", text)
    for run in cjk_runs:
        tokens.extend(run)
        tokens.extend(run[i : i + 2] for i in range(max(len(run) - 1, 0)))
        tokens.extend(run[i : i + 3] for i in range(max(len(run) - 2, 0)))
    return [token for token in tokens if token]
