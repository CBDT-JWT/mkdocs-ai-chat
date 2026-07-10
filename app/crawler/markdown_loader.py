from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


FRONT_MATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class DocumentChunk:
    id: str
    text: str
    title: str
    heading: str
    source: str
    url: str


def load_markdown_chunks(
    repo_dir: Path,
    doc_path: str,
    *,
    site_base_url: str = "",
    chunk_size: int = 1200,
    chunk_overlap: int = 180,
) -> list[DocumentChunk]:
    docs_root = repo_dir / doc_path
    if not docs_root.exists():
        return []

    chunks: list[DocumentChunk] = []
    for path in sorted(docs_root.rglob("*.md")):
        rel_path = path.relative_to(docs_root).as_posix()
        raw = path.read_text(encoding="utf-8", errors="ignore")
        text = FRONT_MATTER_RE.sub("", raw).strip()
        if not text:
            continue
        title = _first_heading(text) or _title_from_path(path)
        for index, (heading, body) in enumerate(_split_sections(text)):
            body = _clean_markdown(body)
            if not body:
                continue
            for part_index, part in enumerate(_chunk_text(body, chunk_size, chunk_overlap)):
                chunks.append(
                    DocumentChunk(
                        id=f"{rel_path}:{index}:{part_index}",
                        text=part,
                        title=title,
                        heading=heading or title,
                        source=rel_path,
                        url=_source_url(rel_path, site_base_url),
                    )
                )
    return chunks


def _first_heading(text: str) -> str | None:
    match = HEADING_RE.search(text)
    return match.group(2).strip() if match else None


def _title_from_path(path: Path) -> str:
    return path.stem.replace("-", " ").replace("_", " ").strip().title()


def _split_sections(text: str) -> list[tuple[str, str]]:
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return [("", text)]

    sections: list[tuple[str, str]] = []
    for i, match in enumerate(matches):
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        heading = match.group(2).strip()
        body = text[start:end].strip()
        if body:
            sections.append((heading, body))
    return sections or [(_first_heading(text) or "", text)]


def _clean_markdown(text: str) -> str:
    text = re.sub(r"```.*?```", lambda m: m.group(0), text, flags=re.DOTALL)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    if len(text) <= chunk_size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        boundary = text.rfind("\n\n", start, end)
        if boundary > start + chunk_size // 2:
            end = boundary
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _source_url(rel_path: str, site_base_url: str) -> str:
    page = rel_path[:-3] if rel_path.endswith(".md") else rel_path
    if page.endswith("/index"):
        page = page[: -len("/index")]
    if page == "index":
        page = ""
    url_path = "/" + page.strip("/")
    return f"{site_base_url}{url_path}" if site_base_url else url_path
