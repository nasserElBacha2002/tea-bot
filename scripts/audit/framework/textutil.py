"""Small source helpers shared by scanners and tests."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path


DECISION_RE = re.compile(r"\b(if|for|while|case|catch)\b|\?\?|&&|\|\||\?(?![.:?])")
FROM_RE = re.compile(r"""\bfrom\s+['"]([^'"]+)['"]""")
SIDE_RE = re.compile(r"""^\s*import\s+['"]([^'"]+)['"]""", re.M)
DYNAMIC_RE = re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)""")
REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
FUNC_RE = re.compile(
    r"\b(?:async\s+)?function(?:\s+[A-Za-z_][\w]*)?\s*\(|"
    r"\b[A-Za-z_][\w]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=>"
)


def stable_id(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def mask_non_code(text: str) -> str:
    """Replace comments and string contents with spaces, keeping newlines."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            if j < 0:
                j = n
            out.append(" " * (j - i))
            i = j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("".join("\n" if char == "\n" else " " for char in text[i:j]))
            i = j
            continue
        if text[i] in "'\"`":
            quote = text[i]
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == quote:
                    j += 1
                    break
                j += 1
            out.append("".join("\n" if char == "\n" else " " for char in text[i:j]))
            i = j
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def cyclomatic(text: str) -> int:
    masked = mask_non_code(text)
    return 1 + len(DECISION_RE.findall(masked))


def line_count(text: str) -> int:
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def extract_imports(text: str) -> list[str]:
    found = FROM_RE.findall(text)
    found.extend(SIDE_RE.findall(text))
    found.extend(DYNAMIC_RE.findall(text))
    found.extend(REQUIRE_RE.findall(text))
    return found


def count_functions(text: str) -> int:
    return len(FUNC_RE.findall(mask_non_code(text)))


def normalize_cycle(nodes: list[str]) -> str:
    if not nodes:
        return ""
    rotations = []
    size = len(nodes)
    for index in range(size):
        rotations.append(" > ".join(nodes[index:] + nodes[:index]))
    reversed_nodes = list(reversed(nodes))
    for index in range(size):
        rotations.append(" > ".join(reversed_nodes[index:] + reversed_nodes[:index]))
    return min(rotations)


def find_cycles(graph: dict[str, set[str]]) -> list[str]:
    cycles: list[str] = []
    seen: set[str] = set()
    visiting: set[str] = set()
    stack: list[str] = []

    def walk(node: str) -> None:
        seen.add(node)
        visiting.add(node)
        stack.append(node)
        for nxt in sorted(graph.get(node, ())):
            if nxt not in graph:
                continue
            if nxt not in seen:
                walk(nxt)
            elif nxt in visiting:
                start = stack.index(nxt)
                cycle = normalize_cycle(stack[start:])
                if cycle and cycle not in cycles:
                    cycles.append(cycle)
        stack.pop()
        visiting.remove(node)

    for node in sorted(graph):
        if node not in seen:
            walk(node)
    return sorted(cycles)


def duplicated_line_count(files: dict[str, str], *, min_lines: int, min_chars: int) -> int:
    """Count lines that participate in a cross-file duplicate window."""
    windows: dict[str, list[tuple[str, int]]] = {}
    for path, text in files.items():
        lines = []
        for raw in mask_non_code(text).splitlines():
            stripped = " ".join(raw.split())
            if len(stripped) < min_chars:
                lines.append(None)
            elif stripped.startswith("import ") or stripped.startswith("export "):
                lines.append(None)
            else:
                lines.append(stripped)
        for index in range(0, max(0, len(lines) - min_lines + 1)):
            chunk = lines[index : index + min_lines]
            if any(item is None for item in chunk):
                continue
            digest = hashlib.sha1("\n".join(chunk).encode()).hexdigest()  # type: ignore[arg-type]
            windows.setdefault(digest, []).append((path, index + 1))
    counted: set[tuple[str, int]] = set()
    for locations in windows.values():
        paths = {path for path, _line in locations}
        if len(paths) < 2:
            continue
        for path, line in locations:
            for offset in range(min_lines):
                counted.add((path, line + offset))
    return len(counted)


def resolve_specifier(source: Path, spec: str, known: set[str], root: Path) -> str | None:
    if not spec.startswith("."):
        return None
    base = (source.parent / spec).resolve()
    candidates = [base]
    if base.suffix == ".js":
        candidates.append(base.with_suffix(".ts"))
        candidates.append(base.with_suffix(".tsx"))
    elif base.suffix == "":
        for suffix in (".js", ".jsx", ".ts", ".tsx", ".mjs"):
            candidates.append(Path(str(base) + suffix))
        for suffix in (".js", ".jsx", ".ts", ".tsx"):
            candidates.append(base / f"index{suffix}")
    root_resolved = root.resolve()
    for candidate in candidates:
        try:
            rel = candidate.resolve().relative_to(root_resolved).as_posix()
        except ValueError:
            continue
        if rel in known:
            return rel
    return None
