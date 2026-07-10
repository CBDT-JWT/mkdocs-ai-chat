from pathlib import Path

from app.crawler.markdown_loader import load_markdown_chunks


def test_load_markdown_chunks_builds_source_urls(tmp_path: Path):
    docs = tmp_path / "repo" / "docs" / "fpga"
    docs.mkdir(parents=True)
    (docs / "uart.md").write_text("# UART\n\n## RX\n\n状态机设计内容。", encoding="utf-8")

    chunks = load_markdown_chunks(tmp_path / "repo", "docs", site_base_url="https://docs.example.com")

    assert len(chunks) == 1
    assert chunks[0].title == "UART"
    assert chunks[0].heading == "RX"
    assert chunks[0].source == "fpga/uart.md"
    assert chunks[0].url == "https://docs.example.com/fpga/uart"
