from app.config import Settings
from app.crawler.markdown_loader import DocumentChunk
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
                url="https://note.weitao-jiang.cn/signals-and-systems",
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
                url="https://note.weitao-jiang.cn/communication-and-networks",
            ),
            6.0,
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
    assert sources[0]["url"].endswith("?h=Sa")


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
