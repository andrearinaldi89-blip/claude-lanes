"""Reading `.claude/metodo.json`: canonical English fields, Italian aliases still accepted.

Shared by guard.py and delivery.py, and called with `python3` by the shell scripts.
When both spellings are present the English one wins. Nothing is rewritten on disk.
"""
import json
import os

TOP = {
    "nome": "name", "prefisso": "prefix", "cartella": "root", "cloni": "clones",
    "binari": "lanes", "banco": "bench", "copia": "copyMarker", "lucchetto": "lock",
    "protetti": "protected", "rilascio": "release", "lavori": "jobs",
    "consegna": "deliveryChecks",
}
LANE = {"nome": "name", "rami": "branches", "lavoro": "jobPrefix"}
PROTECTED = {"volumi": "volumes", "stack": "stacks", "cartelle": "folders"}
JOB = {"binario": "lane", "cosa": "what"}


def _rename(d, table):
    out = dict(d)
    for old, new in table.items():
        if old in out:
            value = out.pop(old)
            out.setdefault(new, value)
    return out


def normalize(cfg):
    """Return a copy of the configuration with canonical English field names."""
    if not isinstance(cfg, dict):
        return {}
    out = _rename(cfg, TOP)
    out["lanes"] = [_rename(l, LANE) for l in out.get("lanes", []) if isinstance(l, dict)]
    out["protected"] = _rename(out.get("protected") or {}, PROTECTED)
    jobs = out.get("jobs") or {}
    out["jobs"] = {k: _rename(v, JOB) if isinstance(v, dict) else v for k, v in jobs.items()}
    return out


def load(path):
    with open(path) as f:
        return normalize(json.load(f))


def find_config(folder):
    """(project folder, normalized configuration) for the first `.claude/metodo.json` going up; None outside projects."""
    d = os.path.abspath(folder)
    while True:
        f = os.path.join(d, ".claude", "metodo.json")
        if os.path.isfile(f):
            try:
                return d, load(f)
            except ValueError:
                return None
        if os.path.dirname(d) == d:
            return None
        d = os.path.dirname(d)


def doc_paths(cwd, cfg):
    """(block documents folder, corrections file), relative to the repository root.

    The `docs` field wins. Otherwise docs/blocks and docs/corrections.md, falling back
    to the old Italian names when only those exist.
    """
    docs = cfg.get("docs") or {}
    blocks, corrections = docs.get("blocks"), docs.get("corrections")
    if not blocks:
        blocks = "docs/blocks"
        if not os.path.exists(os.path.join(cwd, blocks)) and os.path.exists(os.path.join(cwd, "docs/blocchi")):
            blocks = "docs/blocchi"
    if not corrections:
        corrections = "docs/corrections.md"
        if not os.path.exists(os.path.join(cwd, corrections)) and os.path.exists(os.path.join(cwd, "docs/correzioni.md")):
            corrections = "docs/correzioni.md"
    return blocks, corrections
