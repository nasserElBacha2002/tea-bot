"""SOLID / GRASP heuristics. Informative only — they never block the gate."""

from __future__ import annotations

import re

from ..models import AuditFinding
from ..textutil import stable_id
from .heuristics import (
    classify_layer,
    count_methods,
    external_integrations,
    has_direct_sql,
    infer_domains,
    is_sql_owner,
)

SWITCH_TYPE = re.compile(r"switch\s*\(\s*\w*(type|kind|provider|status)\w*\s*\)", re.I)
IF_TYPE = re.compile(r"if\s*\(\s*[^)]*(type|provider|kind)\s*===?\s*['\"]", re.I)
NOT_IMPL = re.compile(r"throw\s+new\s+Error\(\s*['\"]NotImplemented|not implemented", re.I)
NEW_CONCRETE = re.compile(
    r"\bnew\s+(Twilio\w*|ConnectionPool|mssql\.|SqlServer\w*|Storage\w*|GCS\w*|Firebase\w*)\s*\(",
    re.I,
)


def scan(texts: dict[str, str]) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    for rel, text in texts.items():
        layer = classify_layer(rel)
        if layer == "tests":
            continue
        domains = infer_domains(text, rel)
        methods = count_methods(text)
        sql = has_direct_sql(text) and not is_sql_owner(rel)
        externals = external_integrations(text)
        lowered = text.lower()

        signals = 0
        if sql:
            signals += 1
        if externals:
            signals += 1
        if "authorize" in lowered or "permission" in lowered:
            signals += 1
        if len(domains) >= 3:
            signals += 1
        if "res." in text and layer == "services":
            signals += 1

        if signals >= 3 and methods >= 10 and layer != "repositories":
            findings.append(
                AuditFinding(
                    id=stable_id("srp", rel),
                    category="solid",
                    subcategory="srp",
                    severity="medium",
                    confidence="low",
                    status="suspected",
                    title="Posible violación de SRP",
                    description=(
                        f"Señales de responsabilidad={signals}, métodos≈{methods}, dominios={domains}. "
                        "Heurística: no bloquea."
                    ),
                    file=rel,
                    evidence={
                        "responsibility_signals": signals,
                        "domains": domains,
                        "methods": methods,
                        "direct_sql": sql,
                        "externals": externals,
                        "layer": layer,
                    },
                    recommendation="Confirmar la mezcla y extraer colaboradores si las responsabilidades son independientes.",
                    blocking=False,
                )
            )

        switches = len(SWITCH_TYPE.findall(text))
        type_ifs = len(IF_TYPE.findall(text))
        if switches + type_ifs >= 4:
            findings.append(
                AuditFinding(
                    id=stable_id("ocp", rel),
                    category="solid",
                    subcategory="ocp",
                    severity="low",
                    confidence="low",
                    status="suspected",
                    title="Ramificación repetida por tipo o proveedor (OCP)",
                    description=f"~{switches} switch y ~{type_ifs} if por type/provider/kind. No bloquea.",
                    file=rel,
                    evidence={"switches": switches, "type_ifs": type_ifs},
                    recommendation="Extraer una estrategia solo si la ramificación sigue creciendo.",
                    blocking=False,
                )
            )

        if NOT_IMPL.search(text):
            findings.append(
                AuditFinding(
                    id=stable_id("lsp", rel),
                    category="solid",
                    subcategory="lsp",
                    severity="medium",
                    confidence="medium",
                    status="suspected",
                    title="Riesgo LSP: camino NotImplemented",
                    description="Una implementación lanza NotImplemented. El contrato puede ser más débil que la interfaz.",
                    file=rel,
                    recommendation="Partir la interfaz o completar la implementación.",
                    blocking=False,
                )
            )

        if NEW_CONCRETE.search(text) and layer in {"services", "controllers"}:
            findings.append(
                AuditFinding(
                    id=stable_id("dip", rel),
                    category="solid",
                    subcategory="dip",
                    severity="low",
                    confidence="low",
                    status="suspected",
                    title="Infraestructura concreta construida en la capa de aplicación",
                    description="new Twilio|ConnectionPool|… dentro de un service o controller. No bloquea.",
                    file=rel,
                    recommendation="Preferir puertos inyectados; las factories quedan en la composición.",
                    blocking=False,
                )
            )

        if layer == "controllers":
            grasp = sum(
                [
                    bool(sql),
                    bool(externals),
                    "twilio" in lowered,
                    lowered.count("if (") > 25,
                ]
            )
            if grasp >= 2:
                findings.append(
                    AuditFinding(
                        id=stable_id("grasp-ctrl", rel),
                        category="grasp",
                        subcategory="controller",
                        severity="medium",
                        confidence="medium",
                        status="requires-review",
                        title="Controller con demasiada responsabilidad (GRASP)",
                        description="El controller muestra SQL, integraciones, Twilio o más de 25 if. No bloquea.",
                        file=rel,
                        evidence={"signals": grasp, "externals": externals, "direct_sql": sql},
                        recommendation="Dejar el controller en validar → service → responder.",
                        blocking=False,
                    )
                )

        if layer == "services" and len(domains) >= 4 and methods >= 15:
            findings.append(
                AuditFinding(
                    id=stable_id("cohesion", rel),
                    category="grasp",
                    subcategory="high-cohesion",
                    severity="medium",
                    confidence="low",
                    status="suspected",
                    title="Candidato a baja cohesión",
                    description=f"El service toca dominios {domains} con ~{methods} métodos. No bloquea.",
                    file=rel,
                    evidence={"domains": domains, "methods": methods},
                    recommendation="Separar por contexto si los grupos de métodos son independientes.",
                    blocking=False,
                )
            )
    return findings
