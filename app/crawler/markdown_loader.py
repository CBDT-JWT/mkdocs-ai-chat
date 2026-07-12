from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from urllib.parse import quote


FRONT_MATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
HEADING_ATTR_RE = re.compile(r"\s+\{([^{}]+)\}\s*$")


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
        for index, (heading, body, anchor) in enumerate(_split_sections(text)):
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
                        url=_source_url(rel_path, site_base_url, anchor),
                    )
                )
    return chunks


def _first_heading(text: str) -> str | None:
    matches = _heading_matches(text)
    match = matches[0] if matches else None
    return _heading_parts(match.group(2))[0] if match else None


def _title_from_path(path: Path) -> str:
    return path.stem.replace("-", " ").replace("_", " ").strip().title()


def _split_sections(text: str) -> list[tuple[str, str, str]]:
    matches = _heading_matches(text)
    if not matches:
        return [("", text, "")]

    used_anchors: set[str] = set()
    headings: list[tuple[str, str]] = []
    for match in matches:
        heading, explicit_anchor = _heading_parts(match.group(2))
        anchor = _unique_anchor(explicit_anchor or _slugify_heading(heading), used_anchors)
        headings.append((heading, anchor))

    sections: list[tuple[str, str, str]] = []
    for i, match in enumerate(matches):
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        heading, anchor = headings[i]
        body = text[start:end].strip()
        if body:
            sections.append((heading, body, anchor))
    return sections or [(_first_heading(text) or "", text, headings[0][1])]


def _heading_matches(text: str) -> list[re.Match[str]]:
    matches: list[re.Match[str]] = []
    for match in HEADING_RE.finditer(text):
        prefix = text[: match.start()]
        previous = ""
        if prefix and not prefix.endswith("\n\n"):
            prior_text = prefix[:-1] if prefix.endswith("\n") else prefix
            previous = prior_text.rsplit("\n", 1)[-1].strip()
        if previous.startswith("|") and previous.endswith("|"):
            continue
        matches.append(match)
    return matches


def _heading_parts(raw_heading: str) -> tuple[str, str]:
    heading = re.sub(r"\s+#+\s*$", "", raw_heading).strip()
    explicit_anchor = ""
    attrs = HEADING_ATTR_RE.search(heading)
    if attrs:
        anchor = re.search(r"(?:^|\s)#([^\s.]+)", attrs.group(1))
        if anchor:
            explicit_anchor = anchor.group(1)
        heading = heading[: attrs.start()].strip()
    return heading, explicit_anchor


def _slugify_heading(heading: str) -> str:
    value = re.sub(r"!?\[([^\]]+)\]\([^)]+\)", r"\1", heading)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("`", "").replace("*", "").replace("~", "")
    value = unescape(value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value)


def _unique_anchor(anchor: str, used: set[str]) -> str:
    candidate = anchor
    suffix = 1
    while not candidate or candidate in used:
        candidate = f"{anchor}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


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


def _source_url(rel_path: str, site_base_url: str, anchor: str = "") -> str:
    page = rel_path[:-3] if rel_path.endswith(".md") else rel_path
    if page.endswith("/index"):
        page = page[: -len("/index")]
    if page == "index":
        page = ""
    url_path = "/" + page.strip("/")
    url = f"{site_base_url}{url_path}" if site_base_url else url_path
    return f"{url}#{quote(anchor, safe='-._~')}" if anchor else url
