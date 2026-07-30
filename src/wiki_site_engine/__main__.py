from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .builder import build_payload
from .config import load_config


ASSETS_ROOT = Path(__file__).resolve().parent / "assets"


def render_ui(config) -> None:
    if not config.ui.get("enabled"):
        return
    output_dir = (config.root / config.output).parent
    assets = ASSETS_ROOT
    replacements = {
        "{{HTML_TITLE}}": config.ui.get("html_title", config.ui.get("title", "Wiki")),
        "{{SITE_TITLE}}": config.ui.get("title", "Wiki"),
        "{{SITE_SUBTITLE}}": config.ui.get("subtitle", ""),
        "{{THEME_COLOR}}": config.ui.get("theme_color", "#0d1117"),
        "{{LOGO}}": config.ui.get("logo_name", "logo.png"),
    }
    index = (assets / "index.html").read_text(encoding="utf-8")
    for source, target in replacements.items():
        index = index.replace(source, target)
    (output_dir / "index.html").write_text(index, encoding="utf-8")
    css = (assets / "style.css").read_text(encoding="utf-8")
    dark = config.ui.get("colors", {})
    light = config.ui.get("light_colors", {})
    if dark:
        css += "\n:root {" + "".join(f"--{key}: {value};" for key, value in dark.items()) + "}\n"
    if light:
        css += "\n@media (prefers-color-scheme: light) { :root {" + "".join(f"--{key}: {value};" for key, value in light.items()) + "} }\n"
    (output_dir / "style.css").write_text(css, encoding="utf-8")
    shutil.copy2(assets / "app.js", output_dir / "app.js")
    shutil.copy2(assets / "vis-network.min.js", output_dir / "vis-network.min.js")
    shutil.copy2(assets / "mermaid.min.js", output_dir / "mermaid.min.js")
    logo_path = config.ui.get("logo_path")
    if logo_path:
        source = config.root / logo_path
        destination = output_dir / config.ui.get("logo_name", "logo.png")
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
    for asset_path in config.ui.get("static_assets", []):
        source = config.root / asset_path
        destination = output_dir / source.name
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
    icons = config.ui.get("icons", [])
    manifest = {
        "name": config.ui.get("html_title", config.ui.get("title", "Wiki")),
        "short_name": config.ui.get("title", "Wiki"),
        "start_url": "./index.html",
        "display": "standalone",
        "background_color": config.ui.get("theme_color", "#0d1117"),
        "theme_color": config.ui.get("theme_color", "#0d1117"),
        "icons": icons,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    core_assets = ["./", "./index.html", "./style.css", "./app.js", "./app-data.js", "./vis-network.min.js", "./mermaid.min.js", "./manifest.json", "./" + config.ui.get("logo_name", "logo.png")]
    core_assets.extend("./" + Path(item).name for item in config.ui.get("static_assets", []))
    sw = (assets / "sw.js").read_text(encoding="utf-8")
    sw = sw.replace("{{CACHE_NAME}}", config.ui.get("cache_name", "wiki-site-v1"))
    sw = sw.replace("{{CORE_ASSETS}}", json.dumps(list(dict.fromkeys(core_assets)), ensure_ascii=False, indent=2))
    (output_dir / "sw.js").write_text(sw, encoding="utf-8")


def load_existing(path: Path, data_variable: str) -> dict | None:
    """Rilegge un app-data.js generato in precedenza; None se assente o illeggibile."""
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    prefix, suffix = f"window.{data_variable} = ", ";\n"
    if not text.startswith(prefix) or not text.endswith(suffix):
        return None
    try:
        return json.loads(text[len(prefix):-len(suffix)])
    except json.JSONDecodeError:
        return None


def is_regression(old_value, new_value) -> bool:
    """Un calo di copertura e' sospetto (sorgenti non sincronizzate, pagine perse); la crescita no."""
    if isinstance(old_value, dict):
        new_value = new_value or {}
        return any(new_value.get(key, 0) < value for key, value in old_value.items())
    if isinstance(old_value, bool):
        return False
    if isinstance(old_value, (int, float)):
        return (new_value or 0) < old_value
    return False


def comparison(old: dict, new: dict) -> dict:
    """Confronta ogni statistica numerica pubblicata dal dominio, piu' gli id delle pagine.

    Volutamente generico: ogni sito ha le sue chiavi (cinture, tipologie, video...) e
    un elenco fisso qui smetterebbe silenziosamente di sorvegliare quelle aggiunte dopo.
    """
    result = {}
    old_stats, new_stats = old.get("stats", {}), new.get("stats", {})
    for key in sorted(set(old_stats) | set(new_stats)):
        old_value, new_value = old_stats.get(key), new_stats.get(key)
        if isinstance(old_value, bool) or not isinstance(old_value, (int, float, dict)):
            continue
        result[key] = {
            "old": old_value,
            "new": new_value,
            "equal": old_value == new_value,
            "regression": is_regression(old_value, new_value),
        }
    old_ids = {page["id"] for page in old.get("pages", [])}
    new_ids = {page["id"] for page in new.get("pages", [])}
    missing = sorted(old_ids - new_ids)
    result["pageIds"] = {
        "equal": old_ids == new_ids,
        "missing": missing,
        "added": sorted(new_ids - old_ids),
        "regression": bool(missing),
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(prog="wiki-site-engine")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--config", type=Path, required=True)
    build_parser.add_argument(
        "--check-only",
        action="store_true",
        help="Confronta con l'app-data.js esistente senza sostituirlo. Esce 1 se il confronto segnala un calo.",
    )
    build_parser.add_argument(
        "--allow-regression",
        action="store_true",
        help=(
            "Scrivi anche se il confronto segnala un calo. La guardia intercetta i cali "
            "accidentali; usa questo flag solo quando il calo e' voluto, per esempio una "
            "correzione della tassonomia."
        ),
    )
    args = parser.parse_args()

    config = load_config(args.config)
    payload = build_payload(config)
    output = (config.root / config.output).resolve()
    for source_dir in config.source_dirs:
        source_path = (config.root / source_dir).resolve()
        if output == source_path or output.is_relative_to(source_path):
            raise SystemExit(f"Output non sicuro dentro una cartella sorgente: {output}")

    existing = load_existing(output, config.data_variable)
    diff = comparison(existing, payload) if existing else None
    regressed = bool(diff) and any(item.get("regression", False) for item in diff.values())

    if args.check_only:
        print(json.dumps({"comparison": diff}, ensure_ascii=False, indent=2))
        raise SystemExit(1 if regressed else 0)

    if regressed:
        print(json.dumps({"comparison": diff}, ensure_ascii=False, indent=2), file=sys.stderr)
        if not args.allow_regression:
            raise SystemExit("Dataset in regressione rispetto al precedente: sostituzione interrotta")
        print("--allow-regression: calo accettato esplicitamente, procedo", file=sys.stderr)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        f"window.{config.data_variable} = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    render_ui(config)
    print(json.dumps({"output": str(output), **payload["stats"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
