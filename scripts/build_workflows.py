#!/usr/bin/env python3
"""Assemble the n8n workflow JSON files from n8n/code/*.js (the tested source of truth).

    python3 scripts/build_workflows.py

Writes n8n/workflows/*.json, ready for `n8n import:workflow`. Keeping node code in real
.js files means it is unit-tested with Node and diff-friendly, instead of living as
escaped strings inside JSON.
"""
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE = ROOT / "n8n" / "code"
OUT = ROOT / "n8n" / "workflows"

CRED_GROQ = {"httpHeaderAuth": {"id": "credGroq000000001", "name": "Groq API"}}
CRED_GEMINI = {"httpHeaderAuth": {"id": "credGemini0000001", "name": "Gemini API"}}
CRED_PG = {"postgres": {"id": "credPostgres00001", "name": "Loan DB (RDS)"}}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def code(name: str, **subs: str) -> str:
    src = (CODE / name).read_text()
    for k, v in subs.items():
        src = src.replace(k, v)
    return src


def nid(workflow: str, name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{workflow}/{name}"))


class Flow:
    def __init__(self, wf_id: str, name: str):
        self.id, self.name = wf_id, name
        self.nodes, self.conns = [], {}

    def add(self, name, type_, version, params, pos, credentials=None, **extra):
        node = {"id": nid(self.id, name), "name": name, "type": type_, "typeVersion": version,
                "parameters": params, "position": list(pos)}
        if credentials:
            node["credentials"] = credentials
        node.update(extra)
        self.nodes.append(node)
        return name

    def link(self, src, dst, output=0, target_input=0):
        outs = self.conns.setdefault(src, {"main": []})["main"]
        while len(outs) <= output:
            outs.append([])
        outs[output].append({"node": dst, "type": "main", "index": target_input})

    def dump(self, filename):
        wf = {"id": self.id, "name": self.name, "nodes": self.nodes, "connections": self.conns,
              "active": False, "settings": {"executionOrder": "v1", "executionTimeout": 3600},
              "pinData": {}}
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / filename).write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote n8n/workflows/{filename} ({len(self.nodes)} nodes)")


def code_node(f, name, file, pos, **subs):
    return f.add(name, "n8n-nodes-base.code", 2,
                 {"mode": "runOnceForAllItems", "jsCode": code(file, **subs)}, pos)


def if_node(f, name, expr, pos):
    return f.add(name, "n8n-nodes-base.if", 2.2, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
            "conditions": [{"id": nid(f.id, name + "/cond"), "leftValue": expr, "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"},
        "options": {}}, pos)


def http_get(f, name, url_expr, pos, interval_ms=None, tries=2):
    options = {"response": {"response": {"responseFormat": "text", "outputPropertyName": "data"}},
               "timeout": 30000}
    if interval_ms:
        options["batching"] = {"batch": {"batchSize": 1, "batchInterval": interval_ms}}
    return f.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "GET", "url": url_expr, "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": UA},
                                            {"name": "Accept-Language", "value": "en-IN,en;q=0.9"}]},
        "options": options}, pos,
        onError="continueRegularOutput", retryOnFail=True, maxTries=tries, waitBetweenTries=3000)


def build_workflow_a(fallback_test=False):
    """fallback_test=True builds a throwaway variant (NOT committed): invalid Groq model and
    only 3 lenders, to prove the Gemini fallback path works end to end."""
    f = Flow("workflowAtest0001" if fallback_test else "workflowA0000001",
             "TEST - Gemini fallback" if fallback_test else "A - Loan Product Discovery (crawler)")

    if not fallback_test:
        f.add("Daily schedule", "n8n-nodes-base.scheduleTrigger", 1.2,
              {"rule": {"interval": [{"field": "days", "daysInterval": 1, "triggerAtHour": 2}]}}, (0, 160))
        f.add("Manual trigger", "n8n-nodes-base.manualTrigger", 1, {}, (0, 360))
    # On-demand run: curl -X POST http://<n8n>:5678/webhook/crawl-now  (replies immediately)
    f.add("Crawl now (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "crawl-fallback-test" if fallback_test else "crawl-now",
           "responseMode": "onReceived", "options": {}},
          (0, 560), webhookId="crawl-fallback-test-wh" if fallback_test else "crawl-now-webhook")
    code_node(f, "Seed sources", "seed_sources.js", (240, 260))
    http_get(f, "Fetch list page", "={{ $json.list_url }}", (480, 260))
    code_node(f, "Parse lender tables", "parse_lenders.js", (720, 260))
    http_get(f, "Fetch lender page", "={{ $json.detail_url }}", (960, 260), interval_ms=400)
    code_node(f, "Extract eligibility text", "extract_eligibility.js", (1200, 260))
    if_node(f, "Has eligibility text?", "={{ !!$json.eligibility_text }}", (1440, 260))
    f.add("Skipped: no eligibility text", "n8n-nodes-base.noOp", 1, {}, (1680, 440))
    system_prompt = json.dumps((CODE / "prompt_system.txt").read_text().strip())
    code_node(f, "Build LLM prompt", "build_prompt.js", (1680, 200), __SYSTEM_PROMPT__=system_prompt)

    # --- Groq (primary): paced to stay inside the free tier's 8k tokens/min ---
    groq_body = ("={{ JSON.stringify({ model: '" + ("invalid-model-for-fallback-test" if fallback_test else "openai/gpt-oss-120b") + "', temperature: 0, reasoning_effort: 'low', "
                 "max_completion_tokens: 800, response_format: { type: 'json_object' }, messages: ["
                 "{ role: 'system', content: $json.system_prompt }, { role: 'user', content: $json.user_prompt }] }) }}")
    f.add("Groq: extract criteria", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": "https://api.groq.com/openai/v1/chat/completions",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "User-Agent", "value": "n8n-loan-crawler/1.0"}]},
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": groq_body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": 8000}}}},
          (1920, 200), credentials=CRED_GROQ,
          onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=10000)
    code_node(f, "Validate groq output", "normalize_extraction.js", (2160, 200), __PROVIDER__="groq")
    if_node(f, "Groq output valid?", "={{ $json.valid === true }}", (2400, 200))

    # --- Gemini (fallback): only for items Groq failed on ---
    gem_body = ("={{ JSON.stringify({ systemInstruction: { parts: [{ text: $json.system_prompt }] }, "
                "contents: [{ role: 'user', parts: [{ text: $json.user_prompt }] }], "
                "generationConfig: { temperature: 0, responseMimeType: 'application/json', "
                "thinkingConfig: { thinkingBudget: 0 } } }) }}")
    f.add("Gemini fallback: extract criteria", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": gem_body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": 7000}}}},
          (2640, 360), credentials=CRED_GEMINI,
          onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=15000)
    code_node(f, "Validate gemini output", "normalize_extraction.js", (2880, 360), __PROVIDER__="gemini")
    if_node(f, "Gemini output valid?", "={{ $json.valid === true }}", (3120, 360))
    f.add("Dropped: both LLMs failed", "n8n-nodes-base.noOp", 1, {}, (3360, 480))

    # --- Upsert: both valid branches converge here, once per item ---
    row = ("JSON.stringify({ source_site: $json.source_site, product_name: $json.product_name, "
           "interest_rate: $json.interest_rate, min_income: $json.min_income, "
           "min_credit_score: $json.min_credit_score, min_age: $json.min_age, max_age: $json.max_age, "
           "allowed_employment_types: $json.allowed_employment_types, "
           "eligibility_rules: $json.eligibility_rules, raw_criteria_text: $json.raw_criteria_text, "
           "qualitative_criteria_text: $json.qualitative_criteria_text })")
    upsert_sql = """INSERT INTO loan_products
  (source_site, product_name, interest_rate, min_income, min_credit_score, min_age, max_age,
   allowed_employment_types, eligibility_rules, raw_criteria_text, qualitative_criteria_text, last_crawled_at)
SELECT r->>'source_site', r->>'product_name', (r->>'interest_rate')::numeric,
       (r->>'min_income')::int, (r->>'min_credit_score')::int, (r->>'min_age')::int, (r->>'max_age')::int,
       CASE WHEN jsonb_typeof(r->'allowed_employment_types') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(r->'allowed_employment_types')) END,
       CASE WHEN jsonb_typeof(r->'eligibility_rules') = 'array' THEN r->'eligibility_rules' END,
       r->>'raw_criteria_text', r->>'qualitative_criteria_text', now()
FROM (SELECT $1::jsonb AS r) x
ON CONFLICT (source_site, product_name) DO UPDATE SET
  interest_rate = EXCLUDED.interest_rate, min_income = EXCLUDED.min_income,
  min_credit_score = EXCLUDED.min_credit_score, min_age = EXCLUDED.min_age, max_age = EXCLUDED.max_age,
  allowed_employment_types = EXCLUDED.allowed_employment_types, eligibility_rules = EXCLUDED.eligibility_rules,
  raw_criteria_text = EXCLUDED.raw_criteria_text, qualitative_criteria_text = EXCLUDED.qualitative_criteria_text,
  last_crawled_at = now()
RETURNING product_id, source_site, product_name, interest_rate, allowed_employment_types, last_crawled_at"""
    f.add("Upsert loan product", "n8n-nodes-base.postgres", 2.5, {
        "operation": "executeQuery", "query": upsert_sql,
        "options": {"queryReplacement": "={{ [ " + row + " ] }}"}},
          (3600, 200), credentials=CRED_PG)
    code_node(f, "Crawl summary", "crawl_summary.js", (3840, 200))

    for t in ("Daily schedule", "Manual trigger", "Crawl now (webhook)"):
        if not (fallback_test and t != "Crawl now (webhook)"):
            f.link(t, "Seed sources")
    chain = ["Seed sources", "Fetch list page", "Parse lender tables", "Fetch lender page",
             "Extract eligibility text", "Has eligibility text?"]
    if fallback_test:
        f.add("Limit to 3 lenders", "n8n-nodes-base.limit", 1, {"maxItems": 3}, (840, 160))
        chain.insert(3, "Limit to 3 lenders")
    for a, b in zip(chain, chain[1:]):
        f.link(a, b)
    f.link("Has eligibility text?", "Build LLM prompt", 0)
    f.link("Has eligibility text?", "Skipped: no eligibility text", 1)
    for a, b in [("Build LLM prompt", "Groq: extract criteria"), ("Groq: extract criteria", "Validate groq output"),
                 ("Validate groq output", "Groq output valid?")]:
        f.link(a, b)
    f.link("Groq output valid?", "Upsert loan product", 0)
    f.link("Groq output valid?", "Gemini fallback: extract criteria", 1)
    f.link("Gemini fallback: extract criteria", "Validate gemini output")
    f.link("Validate gemini output", "Gemini output valid?")
    f.link("Gemini output valid?", "Upsert loan product", 0)
    f.link("Gemini output valid?", "Dropped: both LLMs failed", 1)
    f.link("Upsert loan product", "Crawl summary")
    f.dump("TEST_fallback.json" if fallback_test else "A_loan_product_discovery.json")


# ----------------------------------------------------------------------------- Workflow B
SQL = ROOT / "n8n" / "sql"


def sql(name: str) -> str:
    """SQL file without comment lines (the comments document the file, not the node)."""
    lines = [l for l in (SQL / name).read_text().splitlines() if not l.strip().startswith("--")]
    return "\n".join(lines).strip()


def pg(f, name, sql_file, params, pos, always_output=False):
    opts = {"queryReplacement": "={{ " + params + " }}"} if params else {}
    extra = {"alwaysOutputData": True} if always_output else {}
    return f.add(name, "n8n-nodes-base.postgres", 2.5,
                 {"operation": "executeQuery", "query": sql(sql_file), "options": opts},
                 pos, credentials=CRED_PG, **extra)


def groq_node(f, name, pos, interval_ms):
    body = ("={{ JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0, reasoning_effort: 'low', "
            "max_completion_tokens: 600, response_format: { type: 'json_object' }, messages: ["
            "{ role: 'system', content: $json.system_prompt }, { role: 'user', content: $json.user_prompt }] }) }}")
    return f.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": "https://api.groq.com/openai/v1/chat/completions",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "User-Agent", "value": "n8n-loan-matcher/1.0"}]},
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": interval_ms}}}},
        pos, credentials=CRED_GROQ, onError="continueRegularOutput", retryOnFail=True,
        maxTries=3, waitBetweenTries=10000)


def gemini_node(f, name, pos, interval_ms):
    body = ("={{ JSON.stringify({ systemInstruction: { parts: [{ text: $json.system_prompt }] }, "
            "contents: [{ role: 'user', parts: [{ text: $json.user_prompt }] }], "
            "generationConfig: { temperature: 0, responseMimeType: 'application/json', "
            "thinkingConfig: { thinkingBudget: 0 } } }) }}")
    return f.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": interval_ms}}}},
        pos, credentials=CRED_GEMINI, onError="continueRegularOutput", retryOnFail=True,
        maxTries=3, waitBetweenTries=15000)


def build_workflow_b():
    f = Flow("workflowB0000001", "B - User-Loan Matching (multi-stage filter)")
    BATCH = "$('Validate payload').first().json.batch_id"

    f.add("Batch ready (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "batch-ready", "responseMode": "onReceived", "options": {}},
          (0, 300), webhookId="batch-ready-webhook")
    code_node(f, "Validate payload", "validate_payload.js", (240, 300))
    pg(f, "Mark batch matching", "mark_matching.sql", "[ $json.batch_id ]", (480, 300))
    pg(f, "Load fresh products", "load_fresh_products.sql", None, (720, 300))
    code_node(f, "Stage 0: reconcile lenders", "reconcile_products.js", (960, 300))
    code_node(f, "Collect canonical product ids", "collect_product_ids.js", (1200, 300))
    pg(f, "Reset candidates", "stage1_reset.sql", "[ " + BATCH + " ]", (1440, 300), always_output=True)
    pg(f, "Stage 1: SQL envelope pre-filter", "stage1_envelope.sql",
       "[ " + BATCH + ", JSON.stringify($('Collect canonical product ids').first().json.product_ids) ]", (1680, 300))
    pg(f, "Stage 2: exact per-type rules", "stage2_exact.sql", "[ " + BATCH + " ]", (1920, 300))
    pg(f, "Stage 3: find segments needing review", "stage3_segments.sql", "[ " + BATCH + " ]", (2160, 300),
       always_output=True)
    if_node(f, "Needs LLM review?", "={{ $json.product_id !== undefined }}", (2400, 300))
    f.add("No reviews needed", "n8n-nodes-base.noOp", 1, {}, (2640, 520))

    prompt = json.dumps((CODE / "prompt_review_system.txt").read_text().strip())
    code_node(f, "Build review prompt", "build_review_prompt.js", (2640, 160), __SYSTEM_PROMPT__=prompt)
    groq_node(f, "Groq: review segment", (2880, 160), 8000)
    code_node(f, "Validate groq review", "normalize_review.js", (3120, 160), __PROVIDER__="groq")
    if_node(f, "Groq review valid?", "={{ $json.valid === true }}", (3360, 160))
    gemini_node(f, "Gemini fallback: review segment", (3600, 300), 7000)
    code_node(f, "Validate gemini review", "normalize_review.js", (3840, 300), __PROVIDER__="gemini")
    f.add("Merge review results", "n8n-nodes-base.merge", 3, {"mode": "append"}, (4080, 200))
    row = ("JSON.stringify({ product_id: $json.product_id, employment_type: $json.employment_type, "
           "criteria_hash: $json.criteria_hash, verdict: $json.verdict, caveat: $json.caveat, "
           "provider: $json.extraction_status, valid: $json.valid === true })")
    pg(f, "Upsert review", "upsert_review.sql", "[ " + row + " ]", (4320, 200))
    code_node(f, "Stage 3 summary", "stage3_summary.js", (4560, 200))

    pg(f, "Stage 4: write matches", "stage4_write_matches.sql", "[ " + BATCH + " ]", (4800, 300))
    code_node(f, "Funnel report", "funnel_report.js", (5040, 300))
    pg(f, "Finish batch", "finish_batch.sql", "[ $json.batch_id, $json.stats_json ]", (5280, 300))
    pg(f, "Clean up candidates", "cleanup_candidates.sql", "[ " + BATCH + " ]", (5520, 300), always_output=True)
    f.add("Hand off to Workflow C (Phase 4)", "n8n-nodes-base.noOp", 1, {}, (5760, 300))

    for a, b in [("Batch ready (webhook)", "Validate payload"), ("Validate payload", "Mark batch matching"),
                 ("Mark batch matching", "Load fresh products"), ("Load fresh products", "Stage 0: reconcile lenders"),
                 ("Stage 0: reconcile lenders", "Collect canonical product ids"),
                 ("Collect canonical product ids", "Reset candidates"), ("Reset candidates", "Stage 1: SQL envelope pre-filter"),
                 ("Stage 1: SQL envelope pre-filter", "Stage 2: exact per-type rules"),
                 ("Stage 2: exact per-type rules", "Stage 3: find segments needing review"),
                 ("Stage 3: find segments needing review", "Needs LLM review?")]:
        f.link(a, b)
    f.link("Needs LLM review?", "Build review prompt", 0)
    f.link("Needs LLM review?", "No reviews needed", 1)
    for a, b in [("Build review prompt", "Groq: review segment"), ("Groq: review segment", "Validate groq review"),
                 ("Validate groq review", "Groq review valid?")]:
        f.link(a, b)
    f.link("Groq review valid?", "Merge review results", 0, target_input=0)
    f.link("Groq review valid?", "Gemini fallback: review segment", 1)
    f.link("Gemini fallback: review segment", "Validate gemini review")
    f.link("Validate gemini review", "Merge review results", 0, target_input=1)
    for a, b in [("Merge review results", "Upsert review"), ("Upsert review", "Stage 3 summary"),
                 ("Stage 3 summary", "Stage 4: write matches"), ("No reviews needed", "Stage 4: write matches"),
                 ("Stage 4: write matches", "Funnel report"), ("Funnel report", "Finish batch"),
                 ("Finish batch", "Clean up candidates"), ("Clean up candidates", "Hand off to Workflow C (Phase 4)")]:
        f.link(a, b)
    f.dump("B_user_loan_matching.json")


if __name__ == "__main__":
    import sys
    if "--fallback-test" in sys.argv:
        OUT = Path(sys.argv[sys.argv.index("--fallback-test") + 1])  # keep the throwaway out of the repo
        build_workflow_a(fallback_test=True)
    else:
        build_workflow_a()
        build_workflow_b()
