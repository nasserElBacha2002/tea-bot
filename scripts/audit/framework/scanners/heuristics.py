"""Shared source heuristics for the design scanners.

Adapted from dinamic-localizador ``scripts/audit/framework/utils.py`` for the
Tea Bot trees (``whatsapp-bot/src`` and ``frontend/src``).
"""

from __future__ import annotations

import re

from ..textutil import mask_non_code

# Tea Bot bounded contexts. Substring match on path + source, same idea as the
# localizador DOMAIN_HINTS list.
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

INFRA_IMPORT_HINTS = (
    "twilio",
    "mssql",
    "@google-cloud",
    "googleapis",
    "firebase",
    "nodemailer",
    "redis",
    "axios",
    "fetch",
)

# SQL keywords plus a bare query( call. Tea Bot services such as
# agent-outbound-send, conversation-takeover and audit-log call query()
# directly and do not always spell the SQL verb in the same file.
SQL_RE = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b|\bquery\s*\(", re.I)
EXECUTABLE_SQL_RE = re.compile(
    r"\bquery\s*\(|\bgetPool\s*\(|\.query\s*\(|\.batch\s*\(|new\s+sql\.Request\b",
    re.I,
)

METHOD_RE = re.compile(
    r"^\s*(?:(?:public|private|protected|async|static|readonly|override)\s+)*"
    r"(?:async\s+)?"
    r"([A-Za-z_][\w]*)\s*\([^;]*\)\s*(?::\s*[^{;]+)?\s*\{",
    re.M,
)
CLASS_METHOD_RE = re.compile(
    r"^  (?:(?:public|private|protected|static|readonly|override|async)\s+)+([A-Za-z_][\w]*)\s*\(",
    re.M,
)
ARROW_METHOD_RE = re.compile(
    r"^\s*(?:(?:public|private|protected|readonly|static)\s+)*"
    r"(?:export\s+)?"
    r"(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=>",
    re.M,
)
FUNCTION_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)\s*\(",
    re.M,
)
# God-class branch proxy from localizador (includes optional chaining).
BRANCH_RE = re.compile(r"\b(if|else if|switch|case|for|while|\?\?|\|\||&&)\b")
# Route "heavy logic" branches, without optional-chaining noise.
ROUTE_BRANCH_RE = re.compile(r"\b(if|else if|switch|case|for|while|catch)\b|\?\?|\|\||&&")
IMPORT_FROM_RE = re.compile(
    r"""import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]""",
    re.M,
)
SIDE_IMPORT_RE = re.compile(r"""import\s+['"]([^'"]+)['"]""")
REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
DYNAMIC_IMPORT_RE = re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)""")
CTOR_RE = re.compile(r"constructor\s*\(([^)]*)\)", re.S)

LAYER_MARKERS = (
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
    "db",
    "monitoring",
)

METHOD_NOISE = {"if", "for", "while", "switch", "catch", "constructor", "get", "set"}


def classify_layer(rel_path: str) -> str:
    posix = rel_path.replace("\\", "/")
    name = posix.rsplit("/", 1)[-1]
    if ".test." in name or name.endswith(".spec.js") or name.endswith(".spec.ts"):
        return "tests"
    parts = posix.split("/")
    for marker in LAYER_MARKERS:
        if marker in parts:
            return marker
    if name.endswith(".repository.js") or name.endswith(".repository.ts"):
        return "repositories"
    return "other"


def is_sql_owner(rel_path: str) -> bool:
    """Repositories and the db access module are allowed to own SQL."""
    posix = rel_path.replace("\\", "/")
    name = posix.rsplit("/", 1)[-1]
    if "/repositories/" in f"/{posix}/" or name.endswith(".repository.js") or name.endswith(".repository.ts"):
        return True
    if "/db/" in f"/{posix}/":
        return True
    return False


def infer_domains(text: str, rel_path: str) -> list[str]:
    hay = f"{rel_path}\n{text}".lower()
    return [name for name in DOMAIN_HINTS if name in hay]


def count_methods(text: str) -> int:
    names = set(METHOD_RE.findall(text))
    names.update(FUNCTION_RE.findall(text))
    names.update(ARROW_METHOD_RE.findall(text))
    names.update(CLASS_METHOD_RE.findall(text))
    return len([name for name in names if name not in METHOD_NOISE])


def count_constructor_deps(text: str) -> int:
    match = CTOR_RE.search(text)
    if not match:
        return 0
    params = [part.strip() for part in match.group(1).split(",") if part.strip()]
    return len(params)


def branch_count(text: str) -> int:
    return len(BRANCH_RE.findall(mask_non_code(text)))


def route_branch_count(text: str) -> int:
    return len(ROUTE_BRANCH_RE.findall(mask_non_code(text)))


def has_direct_sql(text: str) -> bool:
    return bool(SQL_RE.search(mask_non_code(text)))


def has_executable_sql(text: str) -> bool:
    return bool(EXECUTABLE_SQL_RE.search(mask_non_code(text))) or has_direct_sql(text)


def external_integrations(text: str) -> list[str]:
    lowered = text.lower()
    return [hint for hint in INFRA_IMPORT_HINTS if hint.lower() in lowered]


def import_bindings(text: str) -> list[tuple[str, str | None]]:
    """Return ``(specifier, imported name)``.

    Default, namespace and side-effect imports use ``imported name = None``.
    ``import { query as q }`` yields the original name ``query``.
    """
    bindings: list[tuple[str, str | None]] = []
    for match in IMPORT_FROM_RE.finditer(text):
        clause = match.group(1).strip()
        spec = match.group(2)
        brace = re.search(r"\{([\s\S]*)\}", clause)
        if brace:
            for part in brace.group(1).split(","):
                cleaned = re.sub(r"^type\s+", "", part.strip()).strip()
                if not cleaned:
                    continue
                imported = re.split(r"\s+as\s+", cleaned, maxsplit=1, flags=re.I)[0].strip()
                if imported:
                    bindings.append((spec, imported))
            prefix = clause[: brace.start()].strip().rstrip(",").strip()
            if prefix and prefix != "type":
                bindings.append((spec, None))
        else:
            bindings.append((spec, None))
    for spec in SIDE_IMPORT_RE.findall(text):
        bindings.append((spec, None))
    for spec in REQUIRE_RE.findall(text):
        bindings.append((spec, None))
    for spec in DYNAMIC_IMPORT_RE.findall(text):
        bindings.append((spec, None))
    return bindings


def specifier_matches(spec: str, pattern: str, mode: str) -> bool:
    if mode == "module":
        return spec == pattern or spec.startswith(pattern + "/")
    if mode == "case_insensitive_contains":
        return pattern.lower() in spec.lower()
    return pattern in spec
