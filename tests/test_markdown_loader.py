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
    assert chunks[0].url == "https://docs.example.com/fpga/uart#rx"


def test_load_markdown_chunks_builds_mkdocs_heading_anchors(tmp_path: Path):
    docs = tmp_path / "repo" / "docs"
    docs.mkdir(parents=True)
    (docs / "signals.md").write_text(
        """## 常用表格

中文章节。

### Laplace变换表

第一个英文标题。

## 基本概念

第二个中文章节。

## Laplace变换

重复英文标题。

### $H(s)$零极点分布与$h(t)$波形特征的对应

数学标题。

### A &amp; B

实体标题。

### 自定义标题 {#custom-section}

显式锚点。
""",
        encoding="utf-8",
    )

    chunks = load_markdown_chunks(tmp_path / "repo", "docs", site_base_url="https://docs.example.com")

    assert [chunk.heading for chunk in chunks] == [
        "常用表格",
        "Laplace变换表",
        "基本概念",
        "Laplace变换",
        "$H(s)$零极点分布与$h(t)$波形特征的对应",
        "A &amp; B",
        "自定义标题",
    ]
    assert [chunk.url for chunk in chunks] == [
        "https://docs.example.com/signals#_1",
        "https://docs.example.com/signals#laplace",
        "https://docs.example.com/signals#_2",
        "https://docs.example.com/signals#laplace_1",
        "https://docs.example.com/signals#hsht",
        "https://docs.example.com/signals#a-b",
        "https://docs.example.com/signals#custom-section",
    ]


def test_heading_attached_to_table_is_not_indexed_as_a_section(tmp_path: Path):
    docs = tmp_path / "repo" / "docs"
    docs.mkdir(parents=True)
    (docs / "table.md").write_text(
        """## 表格章节

| 名称 | 说明 |
| --- | --- |
| 项目 | 内容 |
### 这会被Markdown当作表格内容

普通内容。

### 后续章节

后续内容。

| 名称 | 说明 |
| --- | --- |
| 项目 | 内容 |

### 表格空行后的合法章节

合法内容。
""",
        encoding="utf-8",
    )

    chunks = load_markdown_chunks(tmp_path / "repo", "docs", site_base_url="https://docs.example.com")

    assert [chunk.heading for chunk in chunks] == ["表格章节", "后续章节", "表格空行后的合法章节"]
    assert [chunk.url for chunk in chunks] == [
        "https://docs.example.com/table#_1",
        "https://docs.example.com/table#_2",
        "https://docs.example.com/table#_3",
    ]
