"""ENV vars read from process.env or import.meta.env and missing from .env.example."""

from __future__ import annotations

import re
from pathlib import Path

from ..config import repo_root
from ..models import AuditFinding

ENV_DOT = re.compile(r"(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)")
ENV_INDEX = re.compile(
    r"""(?:process\.env|import\.meta\.env)\s*\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]"""
)
EXAMPLE_LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=", re.M)


def documented_names(root: Path | None = None) -> set[str]:
    root = root or repo_root()
    found: set[str] = set()
    for relative in (".env.example", "whatsapp-bot/.env.example", "frontend/.env.example"):
        path = root / relative
        if not path.is_file():
            continue
        found.update(EXAMPLE_LINE.findall(path.read_text(encoding="utf-8", errors="replace")))
    return found


def read_names(texts: dict[str, str]) -> set[str]:
    found: set[str] = set()
    for text in texts.values():
        found.update(ENV_DOT.findall(text))
        found.update(ENV_INDEX.findall(text))
    return found


def read_names_by_kind(texts: dict[str, str]) -> tuple[set[str], set[str]]:
    backend: set[str] = set()
    vite: set[str] = set()
    for rel, text in texts.items():
        is_frontend = rel.startswith("frontend/")
        for name in ENV_DOT.findall(text):
            if name.startswith("VITE_") or (is_frontend and "import.meta.env" in text):
                vite.add(name)
            elif not name.startswith("VITE_"):
                backend.add(name)
        for name in ENV_INDEX.findall(text):
            if name.startswith("VITE_"):
                vite.add(name)
            else:
                backend.add(name)
    return backend, vite


def scan(texts: dict[str, str], root: Path | None = None) -> tuple[list[AuditFinding], int]:
    documented = documented_names(root)
    used = read_names(texts)
    backend_used, vite_used = read_names_by_kind(texts)
    missing = sorted(used - documented)
    unused = sorted(documented - used)
    findings: list[AuditFinding] = []
    if missing:
        findings.append(
            AuditFinding(
                id="env-read-undocumented",
                category="dead-code",
                subcategory="env-undocumented",
                severity="medium",
                confidence="medium",
                status="detected",
                title="Variables de entorno leídas y no documentadas",
                description=(
                    f"{len(missing)} variables se leen vía process.env o import.meta.env "
                    "y no están en los .env.example."
                ),
                evidence={
                    "vars": missing[:80],
                    "count": len(missing),
                    "backend_vars": sorted(backend_used - documented)[:40],
                    "vite_vars": sorted(vite_used - documented)[:40],
                    "native_vite_ignored": ["MODE", "DEV", "PROD", "SSR"],
                },
                recommendation="Documentarlas en .env.example (incluye VITE_* del frontend).",
                blocking=False,
            )
        )
    if unused:
        findings.append(
            AuditFinding(
                id="env-documented-unused",
                category="dead-code",
                subcategory="env-unused",
                severity="low",
                confidence="low",
                status="suspected",
                title="Variables documentadas y no leídas en el código escaneado",
                description=(
                    f"{len(unused)} variables de .env.example no aparecen en process.env "
                    "ni en import.meta.env. Pueden usarse desde shell o Compose."
                ),
                evidence={"vars": unused[:80], "count": len(unused)},
                recommendation="Quitar las que ya no aplican o anotar dónde se consumen.",
                blocking=False,
            )
        )
    return findings, len(missing)
