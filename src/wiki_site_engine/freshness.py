"""Data di ultima modifica effettiva delle pagine.

Il campo `aggiornato` del frontmatter si dimentica facilmente: una nota
riscritta senza ritoccarlo resta indietro negli elenchi «aggiornate di recente».
Qui la data effettiva e' la piu' recente tra il frontmatter e l'ultima modifica
registrata da git (commit, oppure data del file se ha modifiche non committate).
"""
from __future__ import annotations

import re
import subprocess
from datetime import date, datetime
from pathlib import Path

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _git(root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-c", "core.quotepath=false", "-C", str(root), *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def git_dates(root: Path) -> dict[str, str]:
    """Mappa percorso (relativo a `root`, con `/`) -> data ISO dell'ultima modifica."""
    top = _git(root, "rev-parse", "--show-toplevel")
    if not top:
        return {}
    top_path = Path(top.strip())
    try:
        prefix = root.resolve().relative_to(top_path.resolve()).as_posix()
    except ValueError:
        return {}
    prefix = "" if prefix == "." else prefix + "/"

    dates: dict[str, str] = {}
    log = _git(root, "log", "--format=%x01%cs", "--name-only", "--diff-filter=AMRC", "--", ".")
    if log:
        current = ""
        for line in log.splitlines():
            if line.startswith("\x01"):
                current = line[1:].strip()
            elif line.strip() and current:
                name = line.strip()
                if prefix and not name.startswith(prefix):
                    continue
                dates.setdefault(name[len(prefix):], current)

    status = _git(root, "status", "--porcelain", "--untracked-files=all", "--", ".")
    if status:
        for line in status.splitlines():
            if len(line) < 4:
                continue
            name = line[3:].split(" -> ")[-1].strip().strip('"')
            if prefix and not name.startswith(prefix):
                continue
            relative = name[len(prefix):]
            file_path = root / relative
            if file_path.is_file():
                dates[relative] = datetime.fromtimestamp(file_path.stat().st_mtime).date().isoformat()
    return dates


def effective_updated(frontmatter_value: object, relative: str, dates: dict[str, str]) -> object:
    """Piu' recente tra la data del frontmatter e quella di git (stringhe ISO)."""
    from_git = dates.get(relative, "")
    if not from_git:
        return frontmatter_value
    if isinstance(frontmatter_value, (date, datetime)):
        frontmatter_value = frontmatter_value.isoformat()[:10]
    text = str(frontmatter_value or "").strip()
    if not _ISO.match(text):
        return text or from_git
    return max(text, from_git)
