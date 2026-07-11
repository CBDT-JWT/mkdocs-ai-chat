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


def test_retriever_expands_sa_function_to_sa_signal(tmp_path):
    store = VectorStore(tmp_path)
    chunks = [
        DocumentChunk(
            id="system-function",
            text="系统函数 H(s) 是零状态响应的拉氏变换与激励拉氏变换之比。",
            title="信号与系统",
            heading="系统函数",
            source="signals-and-systems.md",
            url="/signals-and-systems",
        ),
        DocumentChunk(
            id="sa-signal",
            text="**Sa信号（抽样信号）**定义为：$\\mathrm{Sa}(t)=\\frac{\\sin t}{t}$，也与 sinc 函数有关。",
            title="信号与系统",
            heading="基本概念",
            source="signals-and-systems.md",
            url="/signals-and-systems",
        ),
    ]
    store.build(chunks, np.zeros((2, 384), dtype="float32"))

    results = Retriever(Embedder("hash"), store, top_k=1).retrieve("什么是Sa函数？")

    assert results[0][0].id == "sa-signal"
