import numpy as np

from app.crawler.markdown_loader import DocumentChunk
from app.rag.embedding import Embedder
from app.rag.retriever import Retriever
from app.rag.vector_store import VectorStore


def test_retriever_uses_chinese_lexical_matches(tmp_path):
    store = VectorStore(tmp_path)
    chunks = [
        DocumentChunk(
            id="a",
            text="戴维南定理说明，任何线性有源二端网络可以等效为一个电压源和串联电阻。",
            title="电路基础",
            heading="戴维南等效",
            source="circuit.md",
            url="/circuit",
        ),
        DocumentChunk(
            id="b",
            text="UART 接收模块通常包含波特率采样和状态机。",
            title="UART",
            heading="RX",
            source="uart.md",
            url="/uart",
        ),
    ]
    store.build(chunks, np.zeros((2, 384), dtype="float32"))

    results = Retriever(Embedder("hash"), store, top_k=1).retrieve("什么是戴维南等效？")

    assert results[0][0].id == "a"
