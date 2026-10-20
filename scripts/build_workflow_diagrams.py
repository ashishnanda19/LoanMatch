#!/usr/bin/env python3
"""Draws each n8n workflow as a Mermaid flowchart straight from its exported JSON (nodes + connections),
and writes the five diagrams into README.md between the workflows:start / workflows:end markers.

GitHub renders Mermaid natively, so the README always shows what is actually in n8n/workflows/ instead of a
hand-drawn picture that can drift. Re-run after changing a workflow:

    python3 scripts/build_workflow_diagrams.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = [  # (file, letter, heading, direction, one-line summary)
    ("A_loan_product_discovery.json", "A", "Loan Product Discovery (the crawler)", "TD",
     "Rates come from the list page without an LLM. Each lender page is cut down to its eligibility text, Groq extracts the rules, and Gemini is the fallback."),
    ("B_user_loan_matching.json", "B", "User-Loan Matching (the multi-stage filter)", "TD",
     "Called by the parse-csv Lambda. SQL stages cut 450,000 user-lender pairs to a top 5 per user, then R and C run."),
    ("R_lender_notes.json", "R", "Lender Notes (the cached LLM reviews)", "TD",
     "One LLM call per lender, only when its page text changed. Groq and Gemini lanes, saved every 6 lenders."),
    ("C_match_notifications.json", "C", "Match Notifications (SES)", "TD",
     "One email per user to a test alias, marked sent only after SES accepts."),
    ("E_failure_alerts.json", "E", "Failure Alerts (the error workflow)", "LR",
     "Started by n8n when A, B, C or R fails. Emails the owner the workflow, node and error."),
]
TRIGGERS = {"scheduleTrigger", "manualTrigger", "webhook", "executeWorkflowTrigger", "errorTrigger"}
BRANCH_LABELS = {"if": ["yes", "no"], "splitInBatches": ["done", "next lender"]}


def label(name: str) -> str:
    return name.replace('"', "'")


def shape(kind: str, text: str) -> str:
    t = f'"{label(text)}"'
    if kind in TRIGGERS:
        return f"([{t}])"
    if kind == "if":
        return "{" + t + "}"
    if kind == "postgres":
        return f"[({t})]"          # database
    if kind in ("httpRequest", "awsSes"):
        return f"[/{t}/]"          # external call
    if kind == "executeWorkflow":
        return f"[[{t}]]"          # sub-workflow
    if kind == "noOp":
        return f"({t})"
    return f"[{t}]"                # code / merge / split


def mermaid(wf: dict, direction: str) -> str:
    ids = {n["name"]: f"n{i}" for i, n in enumerate(wf["nodes"])}
    kinds = {n["name"]: n["type"].split(".")[-1] for n in wf["nodes"]}
    lines = [f"flowchart {direction}"]
    for n in wf["nodes"]:
        lines.append(f"  {ids[n['name']]}{shape(kinds[n['name']], n['name'])}")
    for src, outs in wf["connections"].items():
        for port, targets in enumerate(outs.get("main", [])):
            for t in targets or []:
                names = BRANCH_LABELS.get(kinds[src])
                edge = f'-->|{names[port]}|' if names and port < len(names) else "-->"
                lines.append(f"  {ids[src]} {edge} {ids[t['node']]}")
    lines += [
        "  classDef trig fill:#e8f0ff,stroke:#2d5bd6,color:#102a6b",
        "  classDef db fill:#fff4d6,stroke:#b7791f,color:#5a3a00",
        "  classDef ext fill:#e6f7ee,stroke:#1f8a4c,color:#0b3d22",
    ]
    for name, kind in kinds.items():
        cls = "trig" if kind in TRIGGERS else "db" if kind == "postgres" else "ext" if kind in ("httpRequest", "awsSes", "executeWorkflow") else None
        if cls:
            lines.append(f"  class {ids[name]} {cls}")
    return "\n".join(lines)


def section() -> str:
    out = [
        "Generated from the exported workflow JSON by "
        "[`scripts/build_workflow_diagrams.py`](scripts/build_workflow_diagrams.py), so it matches "
        "[`n8n/workflows/`](n8n/workflows). Blue rounded: trigger. Yellow cylinder: SQL. Green slanted: external call "
        "(LLM, web, SES). Double border: another workflow. Diamond: decision. Plain box: Code node.",
        "",
    ]
    for fname, letter, title, direction, summary in WORKFLOWS:
        wf = json.loads((ROOT / "n8n" / "workflows" / fname).read_text())
        out += [
            "<details>",
            f"<summary><b>Workflow {letter}: {title}</b> ({len(wf['nodes'])} nodes, "
            f"<a href=\"n8n/workflows/{fname}\">{fname}</a>)</summary>",
            "",
            summary,
            "",
            "```mermaid",
            mermaid(wf, direction),
            "```",
            "",
            "</details>",
            "",
        ]
    return "\n".join(out)


def main() -> None:
    readme = ROOT / "README.md"
    text = readme.read_text()
    block = f"<!-- workflows:start -->\n{section()}<!-- workflows:end -->"
    if "<!-- workflows:start -->" in text:
        text = re.sub(r"<!-- workflows:start -->.*?<!-- workflows:end -->", lambda _: block, text, flags=re.S)
    else:
        anchor = "The workflow JSON in [`n8n/workflows/`]"
        text = text.replace(anchor, "#### The workflows as drawn in n8n\n\n" + block + "\n\n" + anchor, 1)
    readme.write_text(text)
    print("README updated:", ", ".join(w[1] for w in WORKFLOWS))


if __name__ == "__main__":
    main()
