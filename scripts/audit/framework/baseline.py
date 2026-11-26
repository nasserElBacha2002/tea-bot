"""Baseline comparison for findings and numeric metrics."""

from __future__ import annotations

from typing import Any

from .models import AuditFinding, finding_key


def compare_findings(current: list[AuditFinding], baseline: list[AuditFinding]) -> dict[str, Any]:
    current_map = {finding_key(item): item for item in current}
    baseline_map = {finding_key(item): item for item in baseline}
    new_keys = sorted(set(current_map) - set(baseline_map))
    resolved_keys = sorted(set(baseline_map) - set(current_map))

    def summarize(keys: list[str], source: dict[str, AuditFinding]) -> list[dict[str, Any]]:
        out = []
        for key in keys:
            item = source[key]
            out.append(
                {
                    "id": item.id,
                    "key": key,
                    "severity": item.severity,
                    "confidence": item.confidence,
                    "status": item.status,
                    "title": item.title,
                    "file": item.file,
                    "blocking": item.blocking,
                }
            )
        return out

    return {
        "counts": {
            "previous": len(baseline),
            "current": len(current),
            "new": len(new_keys),
            "resolved": len(resolved_keys),
        },
        "new_findings": summarize(new_keys, current_map),
        "resolved_findings": summarize(resolved_keys, baseline_map),
    }


def _allowed_higher(base: float, rule: dict[str, Any]) -> float:
    tolerance = float(rule.get("tolerance") or 0)
    tolerance_abs = float(rule.get("tolerance_abs") or 0)
    pct = float(rule.get("tolerance_pct") or 0)
    allowed = base + max(tolerance, tolerance_abs)
    if pct:
        allowed = max(allowed, base * (1.0 + pct / 100.0))
    return allowed


def compare_metrics(current: dict[str, Any], baseline: dict[str, Any], progressive: dict[str, Any]) -> list[dict[str, Any]]:
    """Return regressions. Missing keys are ignored unless the baseline had them and the current run dropped them."""
    reasons: list[dict[str, Any]] = []
    cur_numbers = current.get("numbers") or {}
    base_numbers = baseline.get("numbers") or {}

    for key, rule in (progressive.get("numbers_higher_is_worse") or {}).items():
        if key not in base_numbers:
            continue
        if key not in cur_numbers:
            reasons.append(_metric_reason(key, rule, "missing", f"{key}: el baseline lo mide y esta corrida no"))
            continue
        base = float(base_numbers[key])
        cur = float(cur_numbers[key])
        allowed = _allowed_higher(base, rule)
        if cur > allowed + 1e-9:
            reasons.append(
                _metric_reason(key, rule, "higher", f"{key}: {cur:g} supera el baseline {base:g} (tope {allowed:g})")
            )

    for key, rule in (progressive.get("numbers_lower_is_worse") or {}).items():
        if key not in base_numbers:
            continue
        if key not in cur_numbers:
            reasons.append(_metric_reason(key, rule, "missing", f"{key}: el baseline lo mide y esta corrida no"))
            continue
        base = float(base_numbers[key])
        cur = float(cur_numbers[key])
        allowed = base - float(rule.get("tolerance") or 0)
        if cur < allowed - 1e-9:
            reasons.append(
                _metric_reason(key, rule, "lower", f"{key}: {cur:g} está bajo el baseline {base:g} (piso {allowed:g})")
            )

    cur_maps = current.get("maps") or {}
    base_maps = baseline.get("maps") or {}
    for key, rule in (progressive.get("maps_higher_is_worse") or {}).items():
        if key not in base_maps:
            continue
        if key not in cur_maps:
            reasons.append(_metric_reason(key, rule, "missing", f"{key}: mapa ausente"))
            continue
        floor = float(rule.get("only_if_at_least") or 0)
        base_map = base_maps[key] or {}
        for file, raw in sorted((cur_maps[key] or {}).items()):
            cur = float(raw)
            if file not in base_map:
                if cur >= floor:
                    reasons.append(
                        _metric_reason(
                            key,
                            rule,
                            "new-file",
                            f"{key}: archivo nuevo {file} = {cur:g} (umbral {floor:g})",
                            file=file,
                        )
                    )
                continue
            base = float(base_map[file])
            allowed = _allowed_higher(base, rule)
            if cur >= floor and cur > allowed + 1e-9:
                reasons.append(
                    _metric_reason(
                        key,
                        rule,
                        "higher",
                        f"{key}: {file} {cur:g} supera {base:g} (tope {allowed:g})",
                        file=file,
                    )
                )
    return reasons


def _metric_reason(key: str, rule: dict[str, Any], kind: str, message: str, file: str | None = None) -> dict[str, Any]:
    return {
        "key": key,
        "kind": kind,
        "priority": rule.get("priority") or "P1",
        "message": message,
        "file": file,
    }
