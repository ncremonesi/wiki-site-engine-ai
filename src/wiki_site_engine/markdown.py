from __future__ import annotations

import re

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+?)\\?(?:[#|][^\]]*)?\]\]")


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not match:
        return {}, text
    frontmatter: dict = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            frontmatter[key] = [part.strip().strip('"').strip("'") for part in inner.split(",")] if inner else []
        else:
            frontmatter[key] = value.strip('"').strip("'")
    return frontmatter, text[match.end():]


def first_heading(body: str) -> str | None:
    for line in body.splitlines():
        match = re.match(r"^#\s+(.+?)\s*$", line)
        if match:
            return match.group(1).strip()
    return None


def wikilinks(text: str) -> list[str]:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    return [match.group(1).strip() for match in WIKILINK_RE.finditer(text) if match.group(1).strip()]


def normalize_markdown(body: str, title: str) -> str:
    lines = body.strip().splitlines()
    if lines:
        match = re.match(r"^#\s+(.+?)\s*$", lines[0])
        if match and match.group(1).strip().casefold() == title.strip().casefold():
            lines = lines[1:]
            while lines and not lines[0].strip():
                lines.pop(0)
    return "\n".join(lines)


def excerpt(body: str, max_len: int = 280) -> str:
    body = re.sub(r"```.*?```", " ", body, flags=re.S)
    lines = body.splitlines()
    for index, line in enumerate(lines):
        if line.strip():
            if re.match(r"^#\s+", line):
                lines = lines[index + 1:]
            break
    body = "\n".join(lines)
    heading = re.search(r"^#{1,6}\s", body, flags=re.M)
    if heading:
        body = body[:heading.start()]
    body = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", body)
    body = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", body)
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", body)
    body = re.sub(r"[#*_`>|\-]+", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:max_len].rstrip() + ("..." if len(body) > max_len else "")
