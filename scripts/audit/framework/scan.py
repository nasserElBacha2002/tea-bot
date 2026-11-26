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
from .scanners.design import scan_design
from .scanners.heuristics import import_bindings, specifier_matches
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

        _architecture_findings(findings, rel, text, thresholds)
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
    design_findings, design_metrics = scan_design(texts, thresholds)
    findings.extend(design_findings)
    metrics = {
        "numbers": {
            "duplication.lines": dup_lines,
            "cycles.count": len(cycles),
            "backend.coverage.files_pct": backend_pct,
            "frontend.coverage.files_pct": frontend_pct,
            **(design_metrics.get("numbers") or {}),
        },
        "maps": {
            "complexity.cyclomatic": cyclomatic_map,
            **(design_metrics.get("maps") or {}),
        },
        "samples": dict(design_metrics.get("samples") or {}),
    }
    return findings, metrics


def _architecture_findings(findings: list[AuditFinding], rel: str, text: str, thresholds: dict[str, Any]) -> None:
    bindings = import_bindings(text)
    for rule in thresholds.get("architecture", {}).get("forbidden_import_patterns") or []:
        if not fnmatch(rel, rule.get("from_glob") or "**/*"):
            continue
        pattern = rule.get("to_pattern") or ""
        mode = rule.get("match_mode") or "contains"
        wanted = rule.get("imported_name")
        seen: set[tuple[str, str | None]] = set()
        for spec, imported in bindings:
            if wanted and imported != wanted:
                continue
            if not specifier_matches(spec, pattern, mode):
                continue
            key = (spec, imported)
            if key in seen:
                continue
            seen.add(key)
            blocking = bool(rule.get("blocking", False))
            label = f"{spec}#{imported}" if imported else spec
            findings.append(
                _finding(
                    id=stable_id("arch", rule.get("rule", "rule"), rel, label),
                    category="architecture",
                    subcategory=rule.get("rule") or "layer",
                    severity=rule.get("severity", "high"),
                    confidence=rule.get("confidence", "medium"),
                    status=rule.get("status", "detected"),
                    title=rule.get("rule") or "architecture-import-rule",
                    description=f"Import '{spec}' cruza el límite {rule.get('rule')}.",
                    file=rel,
                    evidence={
                        "import": spec,
                        "imported_name": imported,
                        "rule": rule.get("rule"),
                        "never_baseline": blocking,
                    },
                    recommendation="Respetar controllers → services → repositories.",
                    blocking=blocking,
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


def _read_exit_code(path: Path) -> int | None:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def ingest_tool_metrics(metrics: dict[str, Any], raw_dir: Path, findings: list[AuditFinding] | None = None) -> None:
    numbers = metrics.setdefault("numbers", {})
    samples = metrics.setdefault("samples", {})
    tool_status = metrics.setdefault("tool_status", {})

    eslint_exit = _read_exit_code(raw_dir / "frontend-eslint.exit")
    if eslint_exit is not None:
        tool_status["frontend.eslint.exit"] = eslint_exit
    eslint_path = raw_dir / "frontend-eslint.json"
    eslint_text = eslint_path.read_text(encoding="utf-8", errors="replace") if eslint_path.is_file() else ""
    if eslint_text.lstrip().startswith("["):
        errors, warnings, rows = _parse_eslint(eslint_path)
        numbers["frontend.eslint.errors"] = errors
        numbers["frontend.eslint.warnings"] = warnings
        samples["eslint"] = rows[:40]
    elif eslint_text.lstrip().startswith("{"):
        payload = json.loads(eslint_text)
        if isinstance(payload, dict) and payload.get("error"):
            tool_status["frontend.eslint.error"] = str(payload.get("error"))
            samples["eslint"] = [{"error": payload.get("error"), "exit": payload.get("exit")}]
        elif isinstance(payload, dict) and isinstance(payload.get("results"), list):
            errors, warnings, rows = _parse_eslint(eslint_path)
            numbers["frontend.eslint.errors"] = errors
            numbers["frontend.eslint.warnings"] = warnings
            samples["eslint"] = rows[:40]

    tsc_exit = _read_exit_code(raw_dir / "frontend-tsc.exit")
    if tsc_exit is not None:
        tool_status["frontend.tsc.exit"] = tsc_exit
    tsc_path = raw_dir / "frontend-tsc.txt"
    if tsc_path.is_file():
        tsc_text = tsc_path.read_text(encoding="utf-8", errors="replace")
        if "STATUS: MISSING_TOOL" in tsc_text or "STATUS: SKIPPED" in tsc_text:
            tool_status["frontend.tsc.error"] = "missing_or_skipped"
        else:
            count, rows = _parse_tsc(tsc_path)
            numbers["frontend.tsc.errors"] = count
            samples["tsc"] = rows[:40]

    checkjs_exit = _read_exit_code(raw_dir / "backend-checkjs.exit")
    if checkjs_exit is not None:
        tool_status["backend.checkjs.exit"] = checkjs_exit
    checkjs_path = raw_dir / "backend-checkjs.txt"
    if checkjs_path.is_file():
        checkjs_text = checkjs_path.read_text(encoding="utf-8", errors="replace")
        if "STATUS: MISSING_TOOL" in checkjs_text or "STATUS: SKIPPED" in checkjs_text:
            tool_status["backend.checkjs.error"] = "missing_or_skipped"
        else:
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

    unit_exit = _read_exit_code(raw_dir / "backend-unit-tests.exit")
    if unit_exit is not None:
        tool_status["backend.unit_tests.exit"] = unit_exit
        # Preservar el fallo de pruebas aparte de la cobertura: 1 = falló, 0 = pasó.
        numbers["backend.unit_tests.failed"] = 0 if unit_exit == 0 else 1

    coverage_path = raw_dir / "backend-coverage.txt"
    if coverage_path.is_file():
        pct = _parse_coverage(coverage_path.read_text(encoding="utf-8", errors="replace"))
        if pct is not None:
            numbers["backend.coverage.lines_pct"] = pct

    _ingest_function_metrics(metrics, raw_dir, findings)
    _ingest_dead_exports(metrics, raw_dir, findings)


def _ingest_function_metrics(
    metrics: dict[str, Any],
    raw_dir: Path,
    findings: list[AuditFinding] | None,
) -> None:
    path = raw_dir / "function-metrics.json"
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    tool_status = metrics.setdefault("tool_status", {})
    if not payload.get("ok"):
        tool_status["functions.error"] = str(payload.get("error") or "function_metrics_failed")
        return
    rows = list(payload.get("functions") or [])
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault((str(row.get("file") or ""), str(row.get("rule") or "")), []).append(row)
    smells = load_thresholds().get("code_smells") or {}
    param_high = int((smells.get("param_count") or {}).get("high", 10))
    line_high = int((smells.get("method_lines") or {}).get("high", 150))
    cc_map: dict[str, int] = {}
    long_map: dict[str, int] = {}
    param_map: dict[str, int] = {}
    numbers = metrics.setdefault("numbers", {})
    numbers["functions.cyclomatic_high"] = sum(1 for row in rows if row.get("rule") == "complexity")
    numbers["functions.long"] = sum(1 for row in rows if row.get("rule") == "max-lines-per-function")
    numbers["functions.params"] = sum(1 for row in rows if row.get("rule") == "max-params")
    numbers["functions.depth_high"] = sum(1 for row in rows if row.get("rule") == "max-depth")
    numbers["functions.statements_high"] = sum(1 for row in rows if row.get("rule") == "max-statements")
    samples = metrics.setdefault("samples", {})
    samples["functions"] = rows[:40]
    samples["functions_params"] = sorted(
        (row for row in rows if row.get("rule") == "max-params"),
        key=lambda row: (-int(row.get("params") or 0), str(row.get("file") or "")),
    )[:15]
    if findings is None:
        metrics.setdefault("maps", {})["functions.cyclomatic"] = {}
        return
    catalog = {
        "complexity": (cc_map, "Funciones con complejidad alta", "CC ≥ 25"),
        "max-lines-per-function": (long_map, "Funciones largas", "más de 80 líneas"),
        "max-params": (param_map, "Funciones con muchos parámetros", "más de 6 parámetros"),
    }
    for (rel, rule), items in sorted(grouped.items()):
        spec = catalog.get(rule)
        if spec is None or not rel:
            continue
        target, title, detail = spec
        target[rel] = len(items)
        shown = []
        for item in items[:8]:
            value = item.get("complexity") or item.get("lines") or item.get("params") or item.get("statements")
            shown.append(f"{item.get('name')}={value}@{item.get('line')}")
        severity = "low"
        if rule == "max-params" and any(int(item.get("params") or 0) >= param_high for item in items):
            severity = "medium"
        if rule == "max-lines-per-function" and any(int(item.get("lines") or 0) >= line_high for item in items):
            severity = "medium"
        if rule == "complexity":
            severity = "medium"
        findings.append(
            _finding(
                id=stable_id("fn", rule, rel),
                category="complexity",
                subcategory=rule,
                severity=severity,  # type: ignore[arg-type]
                confidence="high",
                status="detected",
                title=title,
                description=f"{len(items)} funciones con {detail}: {', '.join(shown)}.",
                file=rel,
                evidence={"count": len(items), "functions": items[:12]},
                recommendation="Partir la función si mezcla decisiones. El gate mira el conteo por archivo.",
                blocking=False,
            )
        )
        del map_key
    maps = metrics.setdefault("maps", {})
    maps["functions.cyclomatic"] = cc_map
    maps["functions.long"] = long_map
    maps["functions.params"] = param_map


def _ingest_dead_exports(
    metrics: dict[str, Any],
    raw_dir: Path,
    findings: list[AuditFinding] | None,
) -> None:
    path = raw_dir / "dead-exports.json"
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not payload.get("ok"):
        metrics.setdefault("tool_status", {})["dead_exports.error"] = str(payload.get("error") or "dead_exports_failed")
        return
    count = int(payload.get("count") or 0)
    metrics.setdefault("numbers", {})["dead_exports.count"] = count
    exports = list(payload.get("exports") or [])
    metrics.setdefault("samples", {})["dead_exports"] = exports[:40]
    if findings is None or count == 0:
        return
    findings.append(
        _finding(
            id="dead-exports-summary",
            category="dead-code",
            subcategory="dead-exports",
            severity="info",
            confidence="low",
            status="suspected",
            title="Exports sin referencias en otros archivos",
            description=(
                f"{count} exports con nombre que ningún otro archivo menciona. "
                "Equivalente informativo de ts-prune; puede haber falsos positivos."
            ),
            evidence={"count": count, "exports": exports[:40]},
            recommendation="Borrar el export si nadie lo importa, o usarlo desde el módulo que corresponde.",
            blocking=False,
        )
    )


def _parse_eslint(path: Path) -> tuple[int, int, list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        if data.get("error"):
            raise ValueError(f"eslint report error: {data.get('error')}")
        data = data.get("results") or []
    if not isinstance(data, list):
        raise ValueError("eslint report must be a JSON array of file results")
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
