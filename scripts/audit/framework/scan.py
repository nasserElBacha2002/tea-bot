"""Quality scanners for the Tea Bot JavaScript/TypeScript tree.

Heuristics (SOLID, cohesion, fan-out) are informative. Cycles and measured
metrics participate in the baseline gate.
"""

from __future__ import annotations

import json
import re
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

from .config import load_thresholds, repo_root
from .models import AuditFinding
from .textutil import (
    count_functions,
    cyclomatic,
    duplicated_line_count,
    extract_imports,
    find_cycles,
    line_count,
    resolve_specifier,
    stable_id,
)

SKIP_DIRS = {"node_modules", "dist", "coverage", "build", ".git"}
DOMAIN_HINTS = (
    "conversation",
    "twilio",
    "webhook",
    "flow",
    "handoff",
    "takeover",
    "sheet",
    "billing",
    "auth",
    "media",
    "classification",
    "session",
    "retention",
    "monitoring",
)
SQL_RE = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b", re.I)
ALL_FILES_RE = re.compile(r"all files\s*\|([^|\n]+)")


def _matches(rel: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if fnmatch(rel, pattern) or fnmatch(rel, pattern.lstrip("./")):
            return True
    return False


def iter_source_files(root: Path | None = None) -> list[Path]:
    root = root or repo_root()
    thresholds = load_thresholds()
    suffixes = {".js", ".jsx", ".ts", ".tsx"}
    files: list[Path] = []
    for rel_root in thresholds.get("scan_roots") or []:
        base = root / rel_root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            rel = path.relative_to(root).as_posix()
            if _matches(rel, list(thresholds.get("exclude_globs") or [])):
                continue
            files.append(path)
    return sorted(files)


def _layer(rel: str) -> str:
    parts = rel.split("/")
    for name in (
        "controllers",
        "routes",
        "services",
        "repositories",
        "middleware",
        "adapters",
        "pages",
        "components",
        "hooks",
        "api",
        "utils",
    ):
        if name in parts:
            return name
    return "other"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _finding(**kwargs: Any) -> AuditFinding:
    return AuditFinding(**kwargs)


def scan_sources(root: Path | None = None) -> tuple[list[AuditFinding], dict[str, Any]]:
    root = root or repo_root()
    thresholds = load_thresholds()
    complexity_cfg = thresholds["complexity"]
    god_cfg = thresholds["god_class"]
    dup_cfg = thresholds["duplication"]
    coupling_cfg = thresholds["coupling"]
    files = iter_source_files(root)
    known = {path.relative_to(root).as_posix() for path in files}
    texts = {path.relative_to(root).as_posix(): _read(path) for path in files}
    findings: list[AuditFinding] = []
    cyclomatic_map: dict[str, int] = {}
    graph: dict[str, set[str]] = {rel: set() for rel in known}
    fan_in: dict[str, int] = {rel: 0 for rel in known}

    for rel, text in texts.items():
        loc = line_count(text)
        score = cyclomatic(text)
        cyclomatic_map[rel] = score
        layer = _layer(rel)
        functions = count_functions(text)
        imports = extract_imports(text)
        internal = []
        for spec in imports:
            target = resolve_specifier(root / rel, spec, known, root)
            if target and target != rel:
                internal.append(target)
                graph[rel].add(target)
                fan_in[target] = fan_in.get(target, 0) + 1
        if loc >= complexity_cfg["file_loc_high"] or score >= complexity_cfg["file_cyclomatic_high"]:
            findings.append(
                _finding(
                    id=stable_id("cx", rel),
                    category="complexity",
                    subcategory="file",
                    severity="medium" if score < complexity_cfg["file_cyclomatic_high"] else "high",
                    confidence="high",
                    status="detected",
                    title="Complejidad o tamaño de archivo elevado",
                    description="Métrica heurística (puntos de decisión y líneas). No bloquea por sí misma; el gate mira la regresión contra el baseline.",
                    file=rel,
                    evidence={"loc": loc, "cyclomatic": score, "functions": functions},
                    recommendation="Partir el módulo solo si mezcla responsabilidades.",
                    blocking=False,
                )
            )
        elif loc >= complexity_cfg["file_loc_warn"] and layer in {"services", "controllers", "routes", "pages"}:
            findings.append(
                _finding(
                    id=stable_id("cx-watch", rel),
                    category="complexity",
                    subcategory="file-watch",
                    severity="low",
                    confidence="high",
                    status="detected",
                    title="Archivo grande en capa de aplicación",
                    description=f"{loc} líneas (umbral de observación {complexity_cfg['file_loc_warn']}).",
                    file=rel,
                    evidence={"loc": loc, "cyclomatic": score},
                    recommendation="Vigilar el crecimiento.",
                    blocking=False,
                )
            )

        _architecture_findings(findings, rel, imports, thresholds)
        if len(internal) >= coupling_cfg["fan_out_high"] and layer in {"services", "controllers", "pages", "hooks"}:
            findings.append(
                _finding(
                    id=stable_id("fanout", rel),
                    category="coupling",
                    subcategory="fan-out",
                    severity="medium",
                    confidence="medium",
                    status="requires-review",
                    title="Fan-out alto",
                    description=f"{len(internal)} imports internos (umbral {coupling_cfg['fan_out_high']}).",
                    file=rel,
                    evidence={"fan_out": len(internal)},
                    recommendation="Revisar si el módulo coordina demasiados colaboradores.",
                    blocking=False,
                )
            )
        _responsibility_findings(findings, rel, text, layer, functions, god_cfg)

    cycles = find_cycles(graph)
    for cycle in cycles:
        findings.append(
            _finding(
                id=stable_id("cycle", cycle),
                category="cycles",
                subcategory="import-cycle",
                severity="high",
                confidence="high",
                status="detected",
                title="Dependencia cíclica",
                description=cycle,
                file=cycle.split(" > ", 1)[0],
                evidence={"cycle": cycle},
                recommendation="Romper el ciclo con un módulo intermedio o invirtiendo la dependencia.",
                blocking=True,
            )
        )

    dup_lines = duplicated_line_count(
        texts,
        min_lines=int(dup_cfg["min_lines"]),
        min_chars=int(dup_cfg["min_line_chars"]),
    )
    if dup_lines:
        findings.append(
            _finding(
                id="duplication-summary",
                category="duplication",
                subcategory="cross-file",
                severity="low",
                confidence="medium",
                status="detected",
                title="Bloques duplicados entre archivos",
                description="Ventanas de líneas normalizadas repetidas en más de un archivo. El gate usa la métrica duplication.lines con tolerancia.",
                evidence={"duplicated_lines": dup_lines, "min_lines": dup_cfg["min_lines"]},
                recommendation="Extraer el bloque compartido si el duplicado sigue creciendo.",
                blocking=False,
            )
        )

    hot_in = sorted(fan_in.items(), key=lambda item: item[1], reverse=True)[:15]
    findings.append(
        _finding(
            id="fan-in-top",
            category="coupling",
            subcategory="fan-in",
            severity="info",
            confidence="high",
            status="detected",
            title="Módulos con más fan-in",
            description="Señal de acoplamiento, no una violación.",
            evidence={"top_fan_in": [{"file": file, "fan_in": count} for file, count in hot_in if count]},
            blocking=False,
        )
    )

    backend_pct, frontend_pct = _structural_coverage(texts)
    metrics = {
        "numbers": {
            "duplication.lines": dup_lines,
            "cycles.count": len(cycles),
            "backend.coverage.files_pct": backend_pct,
            "frontend.coverage.files_pct": frontend_pct,
        },
        "maps": {"complexity.cyclomatic": cyclomatic_map},
        "samples": {},
    }
    return findings, metrics


def _architecture_findings(findings: list[AuditFinding], rel: str, imports: list[str], thresholds: dict[str, Any]) -> None:
    for rule in thresholds.get("architecture", {}).get("forbidden_import_patterns") or []:
        if not fnmatch(rel, rule.get("from_glob") or "**/*"):
            continue
        pattern = rule.get("to_pattern") or ""
        mode = rule.get("match_mode") or "contains"
        for spec in imports:
            hay = spec.lower() if mode == "case_insensitive_contains" else spec
            needle = pattern.lower() if mode == "case_insensitive_contains" else pattern
            if needle not in hay:
                continue
            findings.append(
                _finding(
                    id=stable_id("arch", rule.get("rule", "rule"), rel, spec),
                    category="architecture",
                    subcategory=rule.get("rule") or "layer",
                    severity=rule.get("severity", "high"),
                    confidence=rule.get("confidence", "medium"),
                    status=rule.get("status", "detected"),
                    title=rule.get("rule") or "architecture-import-rule",
                    description=f"Import '{spec}' cruza el límite {rule.get('rule')}.",
                    file=rel,
                    evidence={"import": spec, "rule": rule.get("rule")},
                    recommendation="Respetar controllers → services → repositories.",
                    blocking=bool(rule.get("blocking", False)),
                )
            )


def _responsibility_findings(
    findings: list[AuditFinding],
    rel: str,
    text: str,
    layer: str,
    functions: int,
    god_cfg: dict[str, Any],
) -> None:
    domains = [name for name in DOMAIN_HINTS if name in rel.lower() or name in text.lower()]
    sql = bool(SQL_RE.search(text))
    externals = [name for name in ("twilio", "mssql", "googleapis", "axios") if name in text.lower()]
    signals = 0
    if sql and layer != "repositories":
        signals += 1
    if externals:
        signals += 1
    if len(domains) >= 3:
        signals += 1
    if layer == "services" and "res." in text:
        signals += 1
    if signals >= 3 and functions >= 8 and layer in {"services", "controllers", "pages"}:
        findings.append(
            _finding(
                id=stable_id("srp", rel),
                category="solid",
                subcategory="srp",
                severity="medium",
                confidence="low",
                status="suspected",
                title="Posible mezcla de responsabilidades",
                description=f"Señales={signals}, funciones≈{functions}, dominios={domains}. Heurística, no bloquea.",
                file=rel,
                evidence={"signals": signals, "functions": functions, "domains": domains, "sql": sql, "externals": externals},
                recommendation="Confirmar y extraer colaboradores si las responsabilidades son independientes.",
                blocking=False,
            )
        )
    loc = line_count(text)
    score = 0
    reasons = []
    if loc > god_cfg["loc_high"]:
        score += 3
        reasons.append("loc")
    elif loc > god_cfg["loc_watch"]:
        score += 2
        reasons.append("loc-watch")
    if functions > god_cfg["methods_high"]:
        score += 3
        reasons.append("functions")
    if len(domains) >= 4:
        score += 3
        reasons.append("domains")
    if sql and layer != "repositories":
        score += 3
        reasons.append("sql")
    if score >= god_cfg["score_watch"] and layer in {"services", "controllers", "pages"}:
        band = "high" if score >= god_cfg["score_high"] else "medium" if score >= god_cfg["score_medium"] else "low"
        findings.append(
            _finding(
                id=stable_id("god", rel),
                category="architecture",
                subcategory="god-class",
                severity=band,  # type: ignore[arg-type]
                confidence="medium",
                status="requires-review",
                title="Módulo con demasiadas responsabilidades (heurística)",
                description="Puntaje estilo god-class. Informativo salvo que empeore la complejidad medida.",
                file=rel,
                evidence={"score": score, "reasons": reasons, "loc": loc, "functions": functions, "domains": domains},
                recommendation="Separar por caso de uso si el puntaje sigue subiendo.",
                blocking=False,
            )
        )


def _structural_coverage(_texts: dict[str, str]) -> tuple[float, float]:
    """Porcentaje de archivos de producción con un test colocalizado."""
    backend_hit, backend_total = _covered_on_disk("whatsapp-bot/src/")
    frontend_hit, frontend_total = _covered_on_disk("frontend/src/")
    backend = round(100.0 * backend_hit / backend_total, 2) if backend_total else 0.0
    frontend = round(100.0 * frontend_hit / frontend_total, 2) if frontend_total else 0.0
    return backend, frontend


def _covered_on_disk(prefix: str) -> tuple[int, int]:
    root = repo_root()
    files = [path for path in iter_source_files(root) if path.relative_to(root).as_posix().startswith(prefix)]
    if not files:
        return 0, 0
    covered = 0
    for path in files:
        base = path.name
        for suffix in (".js", ".jsx", ".ts", ".tsx"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                break
        hit = False
        for sibling in path.parent.iterdir():
            if not sibling.is_file():
                continue
            name = sibling.name
            if ".test." not in name:
                continue
            if name.startswith(base + ".") or name.startswith(base + ".test"):
                hit = True
                break
        if hit:
            covered += 1
    return covered, len(files)


def ingest_tool_metrics(metrics: dict[str, Any], raw_dir: Path) -> None:
    numbers = metrics.setdefault("numbers", {})
    samples = metrics.setdefault("samples", {})
    eslint_path = raw_dir / "frontend-eslint.json"
    eslint_text = eslint_path.read_text(encoding="utf-8", errors="replace") if eslint_path.is_file() else ""
    if eslint_text.lstrip().startswith(("{", "[")):
        errors, warnings, rows = _parse_eslint(eslint_path)
        numbers["frontend.eslint.errors"] = errors
        numbers["frontend.eslint.warnings"] = warnings
        samples["eslint"] = rows[:40]
    tsc_path = raw_dir / "frontend-tsc.txt"
    if tsc_path.is_file() and "STATUS: SKIPPED" not in tsc_path.read_text(encoding="utf-8", errors="replace"):
        count, rows = _parse_tsc(tsc_path)
        numbers["frontend.tsc.errors"] = count
        samples["tsc"] = rows[:40]
    checkjs_path = raw_dir / "backend-checkjs.txt"
    if checkjs_path.is_file() and "STATUS: SKIPPED" not in checkjs_path.read_text(encoding="utf-8", errors="replace"):
        count, rows = _parse_tsc(checkjs_path)
        numbers["backend.checkjs.errors"] = count
        samples["checkjs"] = rows[:40]
    syntax_path = raw_dir / "backend-syntax.txt"
    if syntax_path.is_file():
        failed = [
            line.strip()
            for line in syntax_path.read_text(encoding="utf-8", errors="replace").splitlines()
            if line.startswith("FAIL ")
        ]
        numbers["backend.syntax.errors"] = len(failed)
        samples["syntax"] = failed[:40]
    coverage_path = raw_dir / "backend-coverage.txt"
    if coverage_path.is_file():
        pct = _parse_coverage(coverage_path.read_text(encoding="utf-8", errors="replace"))
        if pct is not None:
            numbers["backend.coverage.lines_pct"] = pct


def _parse_eslint(path: Path) -> tuple[int, int, list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("results") or []
    errors = 0
    warnings = 0
    rows = []
    root = repo_root()
    for item in data:
        file_path = str(item.get("filePath") or "")
        try:
            rel = Path(file_path).resolve().relative_to(root).as_posix()
        except ValueError:
            rel = file_path
        for message in item.get("messages") or []:
            severity = int(message.get("severity") or 0)
            if severity >= 2:
                errors += 1
            elif severity == 1:
                warnings += 1
            if len(rows) < 40 and severity >= 1:
                rows.append(
                    {
                        "file": rel,
                        "line": message.get("line"),
                        "rule": message.get("ruleId"),
                        "severity": "error" if severity >= 2 else "warning",
                        "message": message.get("message"),
                    }
                )
    return errors, warnings, rows


def _parse_tsc(path: Path) -> tuple[int, list[dict[str, Any]]]:
    rows = []
    count = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "error TS" not in line:
            continue
        count += 1
        if len(rows) < 40:
            rows.append({"line": line.strip()[:300]})
    return count, rows


def _parse_coverage(text: str) -> float | None:
    for line in text.splitlines():
        if "all files" not in line:
            continue
        match = ALL_FILES_RE.search(line)
        if not match:
            continue
        token = match.group(1).strip().rstrip("%")
        try:
            return float(token)
        except ValueError:
            return None
    return None
