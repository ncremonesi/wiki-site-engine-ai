import tempfile
import unittest
from pathlib import Path

from wiki_site_engine.__main__ import ASSETS_ROOT
from wiki_site_engine import EngineConfig, build_payload
from wiki_site_engine.config import ValidationRule


def write_page(root: Path, name: str, content: str) -> None:
    path = root / "wiki" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class EngineTests(unittest.TestCase):
    def test_ui_assets_are_packaged_with_engine(self) -> None:
        required = {"index.html", "style.css", "app.js", "sw.js", "vis-network.min.js"}
        self.assertEqual(required, {path.name for path in ASSETS_ROOT.iterdir()})

    def test_category_from_parent_and_field_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "concetti/alpha.md", """---
tags: [uno, due]
data_ultimo_aggiornamento: 2026-07-17
---
# Alpha
""")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                category_from_parent=True,
                field_map={"tags": "tags"},
            )
            payload = build_payload(config)
            self.assertEqual(payload["pages"][0]["category"], "concetti")
            self.assertEqual(payload["pages"][0]["tags"], ["uno", "due"])

    def test_builds_graph_backlinks_and_exclusions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "alpha.md", """---
tipo: concetto
aggiornato: 2026-07-17
---
# Alpha

Vedi [[beta|Beta]].
""")
            write_page(root, "beta.md", """---
tipo: sintesi
aggiornato: 2026-07-17
---
# Beta
""")
            write_page(root, "segreta.md", """---
tipo: fonte
pubblicazione: escluso
aggiornato: 2026-07-17
---
# Segreta
""")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                validation=ValidationRule(required=("tipo", "aggiornato")),
            )
            payload = build_payload(config)

            self.assertEqual(payload["stats"], {
                "pages": 2,
                "edges": 1,
                "unresolved": 0,
                "warnings": 0,
                "categoryCounts": {"concetto": 1, "sintesi": 1},
            })
            alpha = next(page for page in payload["pages"] if page["id"] == "alpha")
            beta = next(page for page in payload["pages"] if page["id"] == "beta")
            self.assertEqual(alpha["outgoingIds"], ["beta"])
            self.assertEqual(beta["incomingIds"], ["alpha"])

    def test_reports_unresolved_and_validation_warning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "alpha.md", "# Alpha\n\n[[mancante]]\n")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                validation=ValidationRule(required=("tipo", "aggiornato")),
            )
            payload = build_payload(config)

            self.assertEqual(payload["unresolved"], [{"from": "alpha", "target": "mancante"}])
            self.assertEqual(payload["stats"]["warnings"], 2)

    def test_frontmatter_links_and_facets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "alpha.md", """---
tipo: attivita
area: lavoro
progetto: "[[beta]]"
aggiornato: 2026-07-17
---
# Alpha
""")
            write_page(root, "beta.md", """---
tipo: progetto
area: lavoro
aggiornato: 2026-07-17
---
# Beta
""")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                link_fields=("progetto",),
                field_map={"area": "area"},
                facets={"areas": {"field": "area", "order": ["lavoro"], "counts_key": "areaCounts"}},
            )
            payload = build_payload(config)
            self.assertEqual(payload["edges"], [{"source": "alpha", "target": "beta"}])
            self.assertEqual(payload["areas"], ["lavoro"])
            self.assertEqual(payload["stats"]["areaCounts"], {"lavoro": 2})

    def test_reports_missing_attachment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "alpha.md", """---
tipo: risorsa
origine: raw/manca.pdf|Documento
aggiornato: 2026-07-17
---
# Alpha
""")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                field_map={"origine": "origine"},
                list_fields=("origine",),
                file_fields=("origine",),
            )
            payload = build_payload(config)
            self.assertEqual(payload["stats"]["warnings"], 1)

    def test_derived_fields_and_page_override(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_page(root, "alpha.md", """---
categoria: tecniche
fonti: [03 - esempio.md]
aggiornato: 2026-07-17
---
# Alpha

[Video](https://example.test/video)
""")
            config = EngineConfig(
                root=root,
                source_dirs=("wiki",),
                category_field="categoria",
                field_map={"fonti": "fonti"},
                derived_fields={
                    "video": {"type": "body_regex", "pattern": r"(https://example\.test/[^)]+)"},
                    "ordine": {"type": "numbered_list_order", "source_field": "fonti", "default": 9999},
                },
                computed_stats={"videos": {"field": "video", "mode": "truthy"}},
                page_overrides={"alpha": {"category": "speciale"}},
            )
            payload = build_payload(config)
            page = payload["pages"][0]
            self.assertEqual(page["video"], "https://example.test/video")
            self.assertEqual(page["ordine"], 3)
            self.assertEqual(page["category"], "speciale")
            self.assertEqual(payload["stats"]["videos"], 1)


if __name__ == "__main__":
    unittest.main()
