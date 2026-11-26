#!/usr/bin/env python3
"""Fail closed when new blocking SAST fingerprints appear.

Line numbers are not part of the fingerprint. The baseline holds inherited
findings. A missing baseline or a missing current report is a scanner failure,
not a pass.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _semgrep(payload: dict) -> list[dict]:
    rows = []
    for item in payload.get("results") or []:
        extra = item.get("extra") or {}
        severity = str(extra.get("severity") or "").upper()
        if severity != "ERROR":
            continue
        path = str(item.get("path") or "")
        check = str(item.get("check_id") or "")
        rows.append(
            {
                "key": f"{check}|{path}",
                "severity": severity,
                "file": path,
                "line": (item.get("start") or {}).get("line"),
                "message": extra.get("message") or check,
            }
        )
    return rows


def _hadolint(payload: list) -> list[dict]:
    rows = []
    for item in payload:
        level = str(item.get("level") or "").lower()
        if level != "error":
            continue
        path = str(item.get("file") or "")
        code = str(item.get("code") or "")
        rows.append(
            {
                "key": f"{code}|{path}",
                "severity": "ERROR",
                "file": path,
                "line": item.get("line"),
                "message": item.get("message") or code,
            }
        )
    return rows


def _trivy_misconfig(payload: dict) -> list[dict]:
    rows = []
    for result in payload.get("Results") or []:
        target = str(result.get("Target") or "")
        for item in result.get("Misconfigurations") or []:
            severity = str(item.get("Severity") or "").upper()
            if severity not in {"HIGH", "CRITICAL"}:
                continue
            check = str(item.get("ID") or item.get("AVDID") or "")
            rows.append(
                {
                    "key": f"{check}|{target}",
                    "severity": severity,
                    "file": target,
                    "line": ((item.get("CauseMetadata") or {}).get("StartLine")),
                    "message": item.get("Title") or check,
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
    keys = data.get("fingerprints")
    if not isinstance(keys, list):
        raise ValueError("baseline fingerprints must be a list")
    return {str(item) for item in keys}


def write_baseline(path: Path, kind: str, rows: list[dict]) -> None:
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
        write_baseline(baseline_path, args.kind, rows)
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
    # One line per fingerprint.
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
            print(f"  {row['severity']} {row['key']} {loc} {row['message']}", file=sys.stderr)
        return 1
    print(f"[sast] {args.kind} ok ({len(known)} inherited, 0 new)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
