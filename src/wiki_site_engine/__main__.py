from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from .builder import build_payload
from .config import load_config


ENGINE_ROOT = Path(__file__).resolve().parents[2]


def render_ui(config) -> None:
    if not config.ui.get("enabled"):
        return
    output_dir = (config.root / config.output).parent
    assets = ENGINE_ROOT / "assets"
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
    core_assets = ["./", "./index.html", "./style.css", "./app.js", "./app-data.js", "./vis-network.min.js", "./manifest.json", "./" + config.ui.get("logo_name", "logo.png")]
    core_assets.extend("./" + Path(item).name for item in config.ui.get("static_assets", []))
    sw = (ENGINE_ROOT / "assets" / "sw.js").read_text(encoding="utf-8")
    sw = sw.replace("{{CACHE_NAME}}", config.ui.get("cache_name", "wiki-site-v1"))
    sw = sw.replace("{{CORE_ASSETS}}", json.dumps(list(dict.fromkeys(core_assets)), ensure_ascii=False, indent=2))
    (output_dir / "sw.js").write_text(sw, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(prog="wiki-site-engine")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    config = load_config(args.config)
    payload = build_payload(config)
    output = (config.root / config.output).resolve()
    for source_dir in config.source_dirs:
        source_path = (config.root / source_dir).resolve()
        if output == source_path or output.is_relative_to(source_path):
            raise SystemExit(f"Output non sicuro dentro una cartella sorgente: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        f"window.{config.data_variable} = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    render_ui(config)
    print(json.dumps({"output": str(output), **payload["stats"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
