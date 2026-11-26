#!/usr/bin/env python3
"""Fail closed when new blocking SAST fingerprints appear.

Fingerprints are per-occurrence and stable: line numbers are not part of the
identity. A new match of an already-baselined rule in the same file must still
produce a distinct fingerprint. Missing or invalid reports fail closed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any


def _digest(*parts: Any) -> str:
    material = "|".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def _require_mapping(payload: Any, label: str) -> dict:
    if not isinstance(payload, dict):
        raise ValueError(f"{label}: expected object, got {type(payload).__name__}")
    return payload


def _semgrep(payload: Any) -> list[dict]:
    data = _require_mapping(payload, "semgrep")
    if "results" not in data:
        raise ValueError("semgrep: missing results")
    results = data.get("results")
    if not isinstance(results, list):
        raise ValueError("semgrep: results must be a list")
    # Incomplete runs sometimes leave errors without a usable results payload.
    errors = data.get("errors")
    if errors is not None and not isinstance(errors, list):
        raise ValueError("semgrep: errors must be a list when present")
    rows = []
    for item in results:
        if not isinstance(item, dict):
            raise ValueError("semgrep: each result must be an object")
        extra = item.get("extra") or {}
        if not isinstance(extra, dict):
            raise ValueError("semgrep: extra must be an object")
        severity = str(extra.get("severity") or "").upper()
        if severity != "ERROR":
            continue
        path = str(item.get("path") or "")
        check = str(item.get("check_id") or "")
        message = str(extra.get("message") or check)
        snippet = str(extra.get("lines") or extra.get("metavars") or "")
        native = extra.get("fingerprint") or item.get("fingerprint")
        key = str(native) if native else _digest(check, path, message, snippet)
        rows.append(
            {
                "key": key,
                "severity": severity,
                "file": path,
                "rule": check,
                "line": (item.get("start") or {}).get("line"),
                "message": message,
            }
        )
    return rows


def _hadolint(payload: Any) -> list[dict]:
    if not isinstance(payload, list):
        raise ValueError("hadolint: expected a JSON array")
    rows = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("hadolint: each finding must be an object")
        level = str(item.get("level") or "").lower()
        if level != "error":
            continue
        path = str(item.get("file") or "")
        code = str(item.get("code") or "")
        message = str(item.get("message") or code)
        key = _digest(code, path, message)
        rows.append(
            {
                "key": key,
                "severity": "ERROR",
                "file": path,
                "rule": code,
                "line": item.get("line"),
                "message": message,
            }
        )
    return rows


def _trivy_misconfig(payload: Any) -> list[dict]:
    data = _require_mapping(payload, "trivy-misconfig")
    results = data.get("Results")
    if results is None:
        raise ValueError("trivy-misconfig: missing Results")
    if not isinstance(results, list):
        raise ValueError("trivy-misconfig: Results must be a list")
    rows = []
    for result in results:
        if not isinstance(result, dict):
            raise ValueError("trivy-misconfig: each Results entry must be an object")
        target = str(result.get("Target") or "")
        misconfigs = result.get("Misconfigurations") or []
        if misconfigs is None:
            misconfigs = []
        if not isinstance(misconfigs, list):
            raise ValueError("trivy-misconfig: Misconfigurations must be a list")
        for item in misconfigs:
            if not isinstance(item, dict):
                raise ValueError("trivy-misconfig: each misconfiguration must be an object")
            severity = str(item.get("Severity") or "").upper()
            if severity not in {"HIGH", "CRITICAL"}:
                continue
            check = str(item.get("ID") or item.get("AVDID") or "")
            title = str(item.get("Title") or check)
            message = str(item.get("Description") or title)
            key = _digest(check, target, title, message)
            rows.append(
                {
                    "key": key,
                    "severity": severity,
                    "file": target,
                    "rule": check,
                    "line": ((item.get("CauseMetadata") or {}).get("StartLine")),
                    "message": title,
                }
            )
    return rows


PARSERS = {
    "semgrep": _semgrep,
    "hadolint": _hadolint,
    "trivy-misconfig": _trivy_misconfig,
}


def load_current(path: Path, kind: str) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return PARSERS[kind](raw)


def load_baseline(path: Path) -> set[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("baseline must be an object")
    keys = data.get("fingerprints")
    if not isinstance(keys, list):
        raise ValueError("baseline fingerprints must be a list")
    if any(not isinstance(item, str) or not item for item in keys):
        raise ValueError("baseline fingerprints must be non-empty strings")
    return set(keys)


def write_baseline(path: Path, kind: str, rows: list[dict]) -> None:
    if os.environ.get("AUDIT_ALLOW_BASELINE_WRITE") != "1":
        raise PermissionError(
            "baseline write blocked: set AUDIT_ALLOW_BASELINE_WRITE=1 to regenerate SAST baselines"
        )
    keys = sorted({row["key"] for row in rows})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"kind": kind, "fingerprints": keys}, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare SAST findings with a baseline")
    parser.add_argument("--kind", required=True, choices=sorted(PARSERS))
    parser.add_argument("--current", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()

    current_path = Path(args.current)
    baseline_path = Path(args.baseline)
    if not current_path.is_file():
        print(f"[sast] scanner: missing report {current_path}", file=sys.stderr)
        return 2
    try:
        rows = load_current(current_path, args.kind)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"[sast] scanner: invalid report ({exc})", file=sys.stderr)
        return 2

    if args.write_baseline:
        try:
            write_baseline(baseline_path, args.kind, rows)
        except PermissionError as exc:
            print(f"[sast] scanner: {exc}", file=sys.stderr)
            return 2
        print(f"[sast] baseline written {baseline_path} ({len({r['key'] for r in rows})} fingerprints)")
        return 0

    if not baseline_path.is_file():
        print(f"[sast] scanner: missing baseline {baseline_path}", file=sys.stderr)
        return 2
    try:
        known = load_baseline(baseline_path)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"[sast] scanner: invalid baseline ({exc})", file=sys.stderr)
        return 2

    new_rows = [row for row in rows if row["key"] not in known]
    seen: set[str] = set()
    unique = []
    for row in new_rows:
        if row["key"] in seen:
            continue
        seen.add(row["key"])
        unique.append(row)
    if unique:
        print(f"[sast] new {args.kind} findings not in baseline:", file=sys.stderr)
        for row in unique:
            loc = f"{row['file']}:{row['line']}" if row.get("line") else row["file"]
            rule = row.get("rule") or row["key"]
            print(f"  {row['severity']} {rule} {loc} {row['message']}", file=sys.stderr)
        return 1
    print(f"[sast] {args.kind} ok ({len(known)} inherited, 0 new)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
