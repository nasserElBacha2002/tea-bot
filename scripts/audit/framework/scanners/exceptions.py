"""Catch-block smells: empty, default return, log-and-continue."""

from __future__ import annotations

import re

from ..models import AuditFinding
from ..textutil import mask_non_code, stable_id

CATCH_RE = re.compile(r"\bcatch\b")
RETURN_DEFAULT_RE = re.compile(
    r"\breturn\s+(null|undefined|false|true|\[\]|\{\})\s*;",
    re.I,
)
LOG_CALL_RE = re.compile(
    r"(?:console\.(?:log|warn|error)|logger\.(?:warn|error|info))\s*\((?:[^()]|\([^()]*\))*\)\s*;?"
)


def _top_level(body: str) -> str:
    """Text of the catch body that is not inside a nested block."""
    depth = 0
    chunks: list[str] = []
    buf: list[str] = []
    for char in body:
        if char == "{":
            if depth == 0:
                chunks.append("".join(buf))
                buf = []
            depth += 1
        elif char == "}":
            depth = max(0, depth - 1)
            if depth == 0:
                buf = []
        elif depth == 0:
            buf.append(char)
    chunks.append("".join(buf))
    return "\n".join(chunks)


def _brace_body(text: str, open_idx: int) -> str:
    depth = 0
    index = open_idx
    while index < len(text):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : index]
        index += 1
    return text[open_idx + 1 :]


def _iter_catches(masked: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for match in CATCH_RE.finditer(masked):
        open_idx = masked.find("{", match.end())
        if open_idx < 0:
            continue
        # Ignore a catch whose brace is far away (likely a keyword in a type position).
        if masked[match.end() : open_idx].count("\n") > 3:
            continue
        body = _brace_body(masked, open_idx)
        line = masked.count("\n", 0, match.start()) + 1
        found.append((line, body))
    return found


def _classify(body: str) -> tuple[str, str] | None:
    if not body.strip():
        return "empty", ""
    top = _top_level(body)
    returned = RETURN_DEFAULT_RE.search(top)
    if returned and "throw" not in top:
        return "return-default", returned.group(1)
    if LOG_CALL_RE.search(top) and "throw" not in top and "return" not in top:
        stripped = LOG_CALL_RE.sub(" ", top)
        if not re.search(r"[A-Za-z0-9_]", stripped):
            return "log-only", ""
    return None


def scan(texts: dict[str, str]) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    for rel, text in texts.items():
        masked = mask_non_code(text)
        for line, body in _iter_catches(masked):
            kind = _classify(body)
            if kind is None:
                continue
            name, returned = kind
            if name == "empty":
                findings.append(
                    AuditFinding(
                        id=stable_id("ex-empty", rel, str(line)),
                        category="reliability",
                        subcategory="exception-empty",
                        severity="high",
                        confidence="high",
                        status="detected",
                        title=f"Catch vacío ({rel}:{line})",
                        description="El error se traga sin registro ni rethrow.",
                        file=rel,
                        line=line,
                        evidence={"kind": "empty"},
                        recommendation="Registrar con contexto, traducir a un error de dominio o relanzar.",
                        blocking=False,
                    )
                )
                continue
            if name == "return-default":
                severity = "critical" if returned.lower() == "true" else "medium"
                findings.append(
                    AuditFinding(
                        id=stable_id("ex-default", rel, str(line), returned),
                        category="reliability",
                        subcategory="exception-return-default",
                        severity=severity,  # type: ignore[arg-type]
                        confidence="medium",
                        status="suspected",
                        title=f"Catch devuelve {returned} ({rel}:{line})",
                        description="El camino de fallo devuelve un valor por defecto. Confirmar si es intencional.",
                        file=rel,
                        line=line,
                        evidence={"kind": "return-default", "returned": returned},
                        recommendation="No convertir un fallo en éxito. Preferir un error explícito.",
                        blocking=False,
                    )
                )
                continue
            findings.append(
                AuditFinding(
                    id=stable_id("ex-log", rel, str(line)),
                    category="reliability",
                    subcategory="exception-log-only",
                    severity="medium",
                    confidence="low",
                    status="requires-review",
                    title=f"Catch solo registra ({rel}:{line})",
                    description="Posible log-and-continue. Verificar que sea intencional.",
                    file=rel,
                    line=line,
                    evidence={"kind": "log-only"},
                    recommendation="Relanzar cuando el llamador tiene que observar el fallo.",
                    blocking=False,
                )
            )
    return findings
