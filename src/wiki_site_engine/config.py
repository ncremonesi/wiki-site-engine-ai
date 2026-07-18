from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ValidationRule:
    required: tuple[str, ...] = ()
    allowed: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class EngineConfig:
    root: Path
    source_dirs: tuple[str, ...]
    output: str = "output/site/app-data.js"
    data_variable: str = "SITE_DATA"
    excluded_paths: tuple[str, ...] = ()
    ignored_targets: tuple[str, ...] = ()
    category_field: str = "tipo"
    category_from_parent: bool = False
    field_map: dict[str, str] = field(default_factory=dict)
    ui: dict = field(default_factory=dict)
    paths: dict = field(default_factory=dict)
    facets: dict = field(default_factory=dict)
    static_data: dict = field(default_factory=dict)
    link_fields: tuple[str, ...] = ()
    list_fields: tuple[str, ...] = ()
    file_fields: tuple[str, ...] = ()
    derived_fields: dict = field(default_factory=dict)
    computed_stats: dict = field(default_factory=dict)
    page_overrides: dict = field(default_factory=dict)
    title_field: str = "titolo"
    updated_field: str = "aggiornato"
    publication_field: str = "pubblicazione"
    publication_excluded_value: str = "escluso"
    validation: ValidationRule = field(default_factory=ValidationRule)


def load_config(path: Path) -> EngineConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    root_value = Path(raw.get("root", "."))
    root = root_value if root_value.is_absolute() else (path.parent / root_value).resolve()
    validation_raw = raw.get("validation", {})
    validation = ValidationRule(
        required=tuple(validation_raw.get("required", [])),
        allowed={key: tuple(values) for key, values in validation_raw.get("allowed", {}).items()},
    )
    return EngineConfig(
        root=root,
        source_dirs=tuple(raw["source_dirs"]),
        output=raw.get("output", "output/site/app-data.js"),
        data_variable=raw.get("data_variable", "SITE_DATA"),
        excluded_paths=tuple(raw.get("excluded_paths", [])),
        ignored_targets=tuple(raw.get("ignored_targets", [])),
        category_field=raw.get("category_field", "tipo"),
        category_from_parent=raw.get("category_from_parent", False),
        field_map=dict(raw.get("field_map", {})),
        ui=dict(raw.get("ui", {})),
        paths=dict(raw.get("paths", {})),
        facets=dict(raw.get("facets", {})),
        static_data=dict(raw.get("static_data", {})),
        link_fields=tuple(raw.get("link_fields", [])),
        list_fields=tuple(raw.get("list_fields", [])),
        file_fields=tuple(raw.get("file_fields", [])),
        derived_fields=dict(raw.get("derived_fields", {})),
        computed_stats=dict(raw.get("computed_stats", {})),
        page_overrides=dict(raw.get("page_overrides", {})),
        title_field=raw.get("title_field", "titolo"),
        updated_field=raw.get("updated_field", "aggiornato"),
        publication_field=raw.get("publication_field", "pubblicazione"),
        publication_excluded_value=raw.get("publication_excluded_value", "escluso"),
        validation=validation,
    )
