import json

from app.config import Settings
from app.crawler.markdown_loader import DocumentChunk
from app.llm.deepseek import DeepSeekClient
from app.main import _sanitize_history, _sources, create_app


def test_health_endpoint(tmp_path, monkeypatch):
    config = Settings(
        data_dir=tmp_path / "data",
        auto_sync_on_start=False,
        deepseek_api_key="test",
    )
    app = create_app(config)
    client = app.test_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_sources_filter_low_scores_and_add_highlight():
    results = [
        (
            DocumentChunk(
                id="sa",
                text="Sa信号定义为 sin t over t。",
                title="信号与系统",
                heading="基本概念",
                source="signals-and-systems.md",
                url="https://note.weitao-jiang.cn/signals-and-systems#_2",
            ),
            7.0,
        ),
        (
            DocumentChunk(
                id="sampling",
                text="抽样定理中的内插过程本质上就是卷一个 sinc。",
                title="通信",
                heading="抽样定理",
                source="communication-and-networks.md",
                url="https://note.weitao-jiang.cn/communication-and-networks#_22",
            ),
            6.0,
        ),
        (
            DocumentChunk(
                id="dsa",
                text="递归函数可以通过显式栈或循环消除。",
                title="数据结构与算法",
                heading="递归的消除",
                source="dsa.md",
                url="https://note.weitao-jiang.cn/dsa",
            ),
            6.5,
        ),
        (
            DocumentChunk(
                id="noise",
                text="二元已知信号检测。",
                title="统计信号处理",
                heading="二元已知信号检测",
                source="statistic-signal-processing.md",
                url="https://note.weitao-jiang.cn/statistic-signal-processing",
            ),
            2.0,
        ),
    ]

    sources = _sources(results, "什么是Sa函数？")

    assert [source["title"] for source in sources] == ["基本概念", "抽样定理"]
    assert sources[0]["url"] == "https://note.weitao-jiang.cn/signals-and-systems?h=Sa#_2"


def test_sanitize_history_keeps_recent_user_assistant_messages():
    history = _sanitize_history(
        [
            {"role": "system", "content": "ignore"},
            {"role": "user", "content": "前一个问题"},
            {"role": "assistant", "content": "前一个回答"},
            {"role": "user", "content": "x" * 1200},
        ]
    )

    assert [item["role"] for item in history] == ["user", "assistant", "user"]
    assert len(history[-1]["content"]) == 1000


def test_chat_endpoint_streams_agent_events(tmp_path, monkeypatch):
    def fake_agent_events(_self, question, history, _search_docs):
        assert question == "什么是 UART？"
        assert history == [{"role": "user", "content": "前文"}]
        yield {"type": "thinking", "text": "正在分析问题..."}
        yield {"type": "tool_call", "id": "call-1", "query": "UART", "text": "正在检索文档：UART"}
        yield {"type": "tool_result", "id": "call-1", "query": "UART", "count": 1, "text": "找到 1 条"}
        yield {"type": "delta", "content": "UART 是串行通信接口。"}
        yield {"type": "sources", "sources": [{"title": "UART", "url": "/uart", "source": "uart.md"}]}
        yield {"type": "done"}

    monkeypatch.setattr(DeepSeekClient, "agent_events", fake_agent_events)
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            auto_sync_on_start=False,
            deepseek_api_key="test",
        )
    )
    response = app.test_client().post(
        "/api/chat",
        headers={"Accept": "text/event-stream"},
        json={"question": "什么是 UART？", "history": [{"role": "user", "content": "前文"}]},
    )

    events = [
        json.loads(block.removeprefix("data: "))
        for block in response.get_data(as_text=True).strip().split("\n\n")
    ]
    assert response.status_code == 200
    assert response.content_type == "text/event-stream; charset=utf-8"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert [event["type"] for event in events] == [
        "thinking",
        "tool_call",
        "tool_result",
        "delta",
        "sources",
        "done",
    ]


def test_chat_endpoint_keeps_json_compatibility(tmp_path, monkeypatch):
    def fake_agent_events(_self, _question, _history, _search_docs):
        yield {"type": "delta", "content": "分段 "}
        yield {"type": "delta", "content": "回答"}
        yield {"type": "sources", "sources": []}
        yield {"type": "done"}

    monkeypatch.setattr(DeepSeekClient, "agent_events", fake_agent_events)
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            auto_sync_on_start=False,
            deepseek_api_key="test",
        )
    )
    response = app.test_client().post("/api/chat", json={"question": "测试"})

    assert response.status_code == 200
    assert response.get_json() == {"answer": "分段 回答", "sources": []}
