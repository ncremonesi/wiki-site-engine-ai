from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
import re

from .config import EngineConfig
from .markdown import excerpt, first_heading, normalize_markdown, parse_frontmatter, wikilinks


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _validate(page: dict, config: EngineConfig) -> list[dict]:
    warnings = []
    metadata = page["metadata"]
    for field_name in config.validation.required:
        if not metadata.get(field_name):
            warnings.append({"path": page["path"], "issue": f"{field_name} mancante"})
    for field_name, allowed in config.validation.allowed.items():
        value = metadata.get(field_name, "")
        if value and value not in allowed:
            warnings.append({"path": page["path"], "issue": f"{field_name} non riconosciuto: {value}"})
    for field_name in config.file_fields:
        values = page.get(field_name, [])
        if not isinstance(values, list):
            values = [values] if values else []
        for value in values:
            relative = str(value).split("|", 1)[0]
            if relative and not (config.root / relative).is_file():
                warnings.append({"path": page["path"], "issue": f"{field_name} non trovato: {relative}"})
    return warnings


def build_payload(config: EngineConfig) -> dict:
    pages = []
    aliases: dict[str, str] = {}
    excluded = set(config.excluded_paths)

    files: list[Path] = []
    for source_dir in config.source_dirs:
        folder = config.root / source_dir
        if folder.exists():
            files.extend(sorted(folder.rglob("*.md")))

    for path in files:
        relative = _relative(path, config.root)
        if relative in excluded:
            continue
        frontmatter, body = parse_frontmatter(path.read_text(encoding="utf-8-sig"))
        if frontmatter.get(config.publication_field) == config.publication_excluded_value:
            continue
        page_id = path.stem
        title = frontmatter.get(config.title_field) or first_heading(body) or page_id
        category = path.parent.name if config.category_from_parent else frontmatter.get(config.category_field, "senza-categoria")
        page = {
            "id": page_id,
            "title": title,
            "path": relative,
            "folder": path.parent.relative_to(config.root).as_posix(),
            "category": category,
            "updated": frontmatter.get(config.updated_field, ""),
            "publication": frontmatter.get(config.publication_field, "pubblico"),
            "metadata": frontmatter,
            "excerpt": excerpt(body),
            "markdown": normalize_markdown(body, title),
            "linksRaw": wikilinks(body) + [target for field_name in config.link_fields for target in wikilinks(str(frontmatter.get(field_name, "")))],
        }
        for output_field, frontmatter_field in config.field_map.items():
            value = frontmatter.get(frontmatter_field, [] if output_field in {"tags", "fonti"} or output_field in config.list_fields else "")
            if output_field in config.list_fields and not isinstance(value, list):
                value = [value] if value else []
            page[output_field] = value
        for output_field, rule in config.derived_fields.items():
            if page_id in rule.get("exclude_ids", []):
                page[output_field] = rule.get("default", "")
            elif rule.get("type") == "body_regex":
                match = re.search(rule["pattern"], body)
                page[output_field] = match.group(int(rule.get("group", 1))) if match else rule.get("default", "")
            elif rule.get("type") == "numbered_list_order":
                values = page.get(rule["source_field"], [])
                first = values[0] if isinstance(values, list) and values else ""
                match = re.match(r"^\s*(\d+)\s*-", str(first))
                page[output_field] = int(match.group(1)) if match else int(rule.get("default", 9999))
        page.update(config.page_overrides.get(page_id, {}))
        pages.append(page)
        aliases[page_id] = page_id
        aliases[title] = page_id

    edges = []
    unresolved = []
    incoming: Counter = Counter()
    outgoing: Counter = Counter()
    seen_edges = set()
    ignored = set(config.ignored_targets)

    for page in pages:
        for raw_target in page.pop("linksRaw"):
            if raw_target in ignored:
                continue
            target = aliases.get(raw_target)
            if target and target != page["id"]:
                edge = (page["id"], target)
                if edge not in seen_edges:
                    seen_edges.add(edge)
                    edges.append({"source": edge[0], "target": edge[1]})
                    outgoing[edge[0]] += 1
                    incoming[edge[1]] += 1
            elif not target:
                unresolved.append({"from": page["id"], "target": raw_target})

    warnings = []
    for page in pages:
        page["incoming"] = incoming[page["id"]]
        page["outgoing"] = outgoing[page["id"]]
        page["incomingIds"] = sorted(edge["source"] for edge in edges if edge["target"] == page["id"])
        page["outgoingIds"] = sorted(edge["target"] for edge in edges if edge["source"] == page["id"])
        page["degree"] = page["incoming"] + page["outgoing"]
        warnings.extend(_validate(page, config))

    category_counts = Counter(page["category"] for page in pages)
    paths = []
    title_field = config.paths.get("title_field")
    if title_field:
        teaser_field = config.paths.get("teaser_field", "")
        category = config.paths.get("category", "")
        paths = [
            {
                "id": page["id"],
                "titolo": page["metadata"].get(title_field) or page["title"],
                "teaser": page["metadata"].get(teaser_field, "") if teaser_field else "",
            }
            for page in pages
            if (not category or page["category"] == category) and page["metadata"].get(title_field)
        ]
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "pages": pages,
        "edges": edges,
        "categories": list(category_counts),
        "aliases": aliases,
        "percorsi": paths,
        "stats": {
            "pages": len(pages),
            "edges": len(edges),
            "unresolved": len(unresolved),
            "warnings": len(warnings),
            "categoryCounts": dict(category_counts),
        },
        "unresolved": unresolved,
        "warnings": warnings,
    }
    for output_name, facet in config.facets.items():
        field_name = facet.get("field", output_name)
        values = list(facet.get("order", []))
        present = {page.get(field_name, "") for page in pages if page.get(field_name, "")}
        values.extend(sorted(value for value in present if value not in values))
        payload[output_name] = values
        if facet.get("labels"):
            payload[facet.get("labels_key", output_name + "Labels")] = facet["labels"]
        counts_key = facet.get("counts_key", output_name.rstrip("s") + "Counts")
        payload["stats"][counts_key] = dict(Counter(page.get(field_name, "") for page in pages if page.get(field_name, "")))
    for output_name, rule in config.computed_stats.items():
        field_name = rule.get("field", output_name)
        if rule.get("mode", "truthy") == "truthy":
            payload["stats"][output_name] = sum(bool(page.get(field_name)) for page in pages)
    payload.update(config.static_data)
    return payload
