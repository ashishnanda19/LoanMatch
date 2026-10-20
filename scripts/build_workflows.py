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
TOP_N = 5  # lenders kept per user (the most relevant ones: lowest rate first)
CODE = ROOT / "n8n" / "code"
OUT = ROOT / "n8n" / "workflows"

CRED_GROQ = {"httpHeaderAuth": {"id": "credGroq000000001", "name": "Groq API"}}
CRED_GEMINI = {"httpHeaderAuth": {"id": "credGemini0000001", "name": "Gemini API"}}
CRED_AWS = {"aws": {"id": "credAwsSes0000001", "name": "AWS SES (send-only)"}}
CRED_WEBHOOK = {"httpHeaderAuth": {"id": "credWebhook000001", "name": "Webhook secret"}}
ERROR_WORKFLOW_ID = "workflowE0000001"
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
    def __init__(self, wf_id: str, name: str, error_workflow: str = None):
        self.id, self.name, self.error_workflow = wf_id, name, error_workflow
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
        if self.error_workflow:  # failures of this workflow start the alert workflow (E)
            wf["settings"]["errorWorkflow"] = self.error_workflow
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
             "TEST - Gemini fallback" if fallback_test else "A - Loan Product Discovery (crawler)",
             error_workflow=None if fallback_test else ERROR_WORKFLOW_ID)

    if not fallback_test:
        f.add("Daily schedule", "n8n-nodes-base.scheduleTrigger", 1.2,
              {"rule": {"interval": [{"field": "days", "daysInterval": 1, "triggerAtHour": 2}]}}, (0, 160))
        f.add("Manual trigger", "n8n-nodes-base.manualTrigger", 1, {}, (0, 360))
    # On-demand run: curl -X POST http://<n8n>:5678/webhook/crawl-now  (replies immediately)
    f.add("Crawl now (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "crawl-fallback-test" if fallback_test else "crawl-now",
           "authentication": "headerAuth", "responseMode": "onReceived", "options": {}},
          (0, 560), credentials=CRED_WEBHOOK,
          webhookId="crawl-fallback-test-wh" if fallback_test else "crawl-now-webhook")
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

    # --- Gemini (fallback): only for items Groq failed on. Fails fast (2 tries, 5 s apart) so one
    #     exhausted free-tier quota cannot stall the whole crawl for half an hour. ---
    gemini_node(f, "Gemini fallback: extract criteria", (2640, 360), 5000, tries=2, wait_ms=5000)
    code_node(f, "Validate gemini output", "normalize_extraction.js", (2880, 360), __PROVIDER__="gemini")
    if_node(f, "Gemini output valid?", "={{ $json.valid === true }}", (3120, 360))
    f.add("Dropped: both LLMs failed", "n8n-nodes-base.noOp", 1, {}, (3360, 480))
    # n8n runs the Groq branch to the end and then the Gemini branch; without this Merge the save,
    # the summary and the hand-off to R would each run twice (once per branch).
    f.add("Merge extraction results", "n8n-nodes-base.merge", 3, {"mode": "append", "numberInputs": 2}, (3360, 260))

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

    if not fallback_test:
        # The qualitative notes are produced by Workflow R (cached, batched). After a crawl, ask it to
        # fill in every fresh lender; fire and forget so the crawl does not wait on the LLM.
        f.add("Start Workflow R (lender notes)", "n8n-nodes-base.executeWorkflow", 1.2,
              {"source": "database", "workflowId": {"__rl": True, "value": "workflowR0000001", "mode": "id"},
               "mode": "once", "options": {"waitForSubWorkflow": False}}, (4080, 200))

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
    f.link("Groq output valid?", "Merge extraction results", 0, target_input=0)
    f.link("Groq output valid?", "Gemini fallback: extract criteria", 1)
    f.link("Gemini fallback: extract criteria", "Validate gemini output")
    f.link("Validate gemini output", "Gemini output valid?")
    f.link("Gemini output valid?", "Merge extraction results", 0, target_input=1)
    f.link("Merge extraction results", "Upsert loan product")
    f.link("Gemini output valid?", "Dropped: both LLMs failed", 1)
    f.link("Upsert loan product", "Crawl summary")
    if not fallback_test:
        f.link("Crawl summary", "Start Workflow R (lender notes)")
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


def groq_node(f, name, pos, interval_ms, max_tokens=600):
    body = ("={{ JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0, reasoning_effort: 'low', "
            "max_completion_tokens: " + str(max_tokens) + ", response_format: { type: 'json_object' }, messages: ["
            "{ role: 'system', content: $json.system_prompt }, { role: 'user', content: $json.user_prompt }] }) }}")
    return f.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": "https://api.groq.com/openai/v1/chat/completions",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "User-Agent", "value": "n8n-loan-matcher/1.0"}]},
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": interval_ms}}}},
        pos, credentials=CRED_GROQ, onError="continueRegularOutput", retryOnFail=True,
        maxTries=3, waitBetweenTries=10000)


def gemini_node(f, name, pos, interval_ms, model="gemini-flash-lite-latest", tries=3, wait_ms=15000):
    # Free-tier Gemini quotas are per MODEL and small (about 20 requests/day each): gemini-2.5-flash and
    # gemini-2.5-flash-lite were both exhausted by earlier runs. The review is a light annotation task, so
    # it uses the rolling flash-lite alias; if one model runs dry, point this at another model name.
    body = ("={{ JSON.stringify({ systemInstruction: { parts: [{ text: $json.system_prompt }] }, "
            "contents: [{ role: 'user', parts: [{ text: $json.user_prompt }] }], "
            "generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) }}")
    return f.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST",
        "url": f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": body,
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 1, "batchInterval": interval_ms}}}},
        pos, credentials=CRED_GEMINI, onError="continueRegularOutput", retryOnFail=True,
        maxTries=tries, waitBetweenTries=wait_ms)


def build_workflow_b():
    f = Flow("workflowB0000001", "B - User-Loan Matching (multi-stage filter)", error_workflow=ERROR_WORKFLOW_ID)
    BATCH = "$('Validate payload').first().json.batch_id"

    f.add("Batch ready (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "batch-ready", "authentication": "headerAuth",
           "responseMode": "onReceived", "options": {}},
          (0, 300), credentials=CRED_WEBHOOK, webhookId="batch-ready-webhook")
    code_node(f, "Validate payload", "validate_payload.js", (240, 300))
    pg(f, "Mark batch matching", "mark_matching.sql", "[ $json.batch_id ]", (480, 300))
    pg(f, "Load fresh products", "load_fresh_products.sql", None, (720, 300))
    code_node(f, "Stage 0: reconcile lenders", "reconcile_products.js", (960, 300))
    code_node(f, "Collect canonical product ids", "collect_product_ids.js", (1200, 300))
    pg(f, "Save lender offers", "save_offers.sql",
       "[ JSON.stringify($('Collect canonical product ids').first().json.product_rates) ]", (1320, 300))
    pg(f, "Reset candidates", "stage1_reset.sql", "[ " + BATCH + " ]", (1440, 300), always_output=True)
    pg(f, "Stage 1: SQL envelope pre-filter", "stage1_envelope.sql",
       "[ " + BATCH + ", JSON.stringify($('Collect canonical product ids').first().json.product_ids) ]", (1680, 300))
    pg(f, "Stage 2: exact per-type rules", "stage2_exact.sql", "[ " + BATCH + " ]", (1920, 300))
    pg(f, "Stage 3: rank and keep top lenders", "stage3_rank_top.sql", "[ " + BATCH + ", " + str(TOP_N) + ", JSON.stringify($('Collect canonical product ids').first().json.product_rates) ]",
       (2160, 300))
    code_node(f, "Funnel report", "funnel_report.js", (2400, 300), __TOP_N__=str(TOP_N))
    pg(f, "Finish batch", "finish_batch.sql", "[ $json.batch_id, $json.stats_json ]", (2640, 300))
    pg(f, "Clean up candidates", "cleanup_candidates.sql", "[ " + BATCH + " ]", (2880, 300), always_output=True)
    # Notes for the lenders THIS batch actually matched are written before any email goes out, so an
    # outlier lender can never reach a customer without its note. If R fails, emails still go out
    # (the note column then just shows the generic line).
    code_node(f, "Prepare review request", "prepare_review_request.js", (3120, 300))
    f.add("Start Workflow R (notes for matched lenders)", "n8n-nodes-base.executeWorkflow", 1.2,
          {"source": "database", "workflowId": {"__rl": True, "value": "workflowR0000001", "mode": "id"},
           "mode": "once", "options": {"waitForSubWorkflow": True}}, (3360, 300),
          onError="continueRegularOutput")
    code_node(f, "Prepare hand-off", "prepare_handoff.js", (3600, 300))
    f.add("Start Workflow C (notifications)", "n8n-nodes-base.executeWorkflow", 1.2,
          {"source": "database", "workflowId": {"__rl": True, "value": "workflowC0000001", "mode": "id"},
           "mode": "once", "options": {"waitForSubWorkflow": False}}, (3840, 300))

    for a, b in [("Batch ready (webhook)", "Validate payload"), ("Validate payload", "Mark batch matching"),
                 ("Mark batch matching", "Load fresh products"), ("Load fresh products", "Stage 0: reconcile lenders"),
                 ("Stage 0: reconcile lenders", "Collect canonical product ids"),
                 ("Collect canonical product ids", "Save lender offers"), ("Save lender offers", "Reset candidates"),
                 ("Reset candidates", "Stage 1: SQL envelope pre-filter"),
                 ("Stage 1: SQL envelope pre-filter", "Stage 2: exact per-type rules"),
                 ("Stage 2: exact per-type rules", "Stage 3: rank and keep top lenders"),
                 ("Stage 3: rank and keep top lenders", "Funnel report"), ("Funnel report", "Finish batch"),
                 ("Finish batch", "Clean up candidates"), ("Clean up candidates", "Prepare review request"),
                 ("Prepare review request", "Start Workflow R (notes for matched lenders)"),
                 ("Start Workflow R (notes for matched lenders)", "Prepare hand-off"),
                 ("Prepare hand-off", "Start Workflow C (notifications)")]:
        f.link(a, b)
    f.dump("B_user_loan_matching.json")


# ----------------------------------------------------------------------------- Workflow C
def build_workflow_c():
    f = Flow("workflowC0000001", "C - Match Notifications (SES)", error_workflow=ERROR_WORKFLOW_ID)
    f.add("Executed by Workflow B", "n8n-nodes-base.executeWorkflowTrigger", 1.1,
          {"inputSource": "passthrough"}, (0, 160))
    f.add("Manual trigger", "n8n-nodes-base.manualTrigger", 1, {}, (0, 360))
    # On-demand: curl -X POST http://<n8n>:5678/webhook/notify-now  [-d '{"batch_id": "..."}']
    f.add("Notify now (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "notify-now", "authentication": "headerAuth",
           "responseMode": "onReceived", "options": {}},
          (0, 560), credentials=CRED_WEBHOOK, webhookId="notify-now-webhook")
    code_node(f, "Read batch id", "normalize_trigger.js", (240, 360))
    pg(f, "Load pending notifications", "pending_notifications.sql", "[ $json.batch_id ]", (480, 360),
       always_output=True)
    if_node(f, "Anyone to email?", "={{ $json.user_id !== undefined }}", (720, 360))
    f.add("Nothing to send", "n8n-nodes-base.noOp", 1, {}, (960, 520))
    code_node(f, "Build email", "build_email.js", (960, 280))
    f.add("Send via SES", "n8n-nodes-base.awsSes", 1, {
        "resource": "email", "operation": "send", "fromEmail": "={{ $json.from }}",
        "toAddresses": "={{ [ $json.to ] }}", "subject": "={{ $json.subject }}",
        "body": "={{ $json.html }}", "isBodyHtml": True, "additionalFields": {}},
        (1200, 280), credentials=CRED_AWS, onError="continueRegularOutput", retryOnFail=True,
        maxTries=2, waitBetweenTries=2000)
    code_node(f, "Record send outcome", "record_outcome.js", (1440, 280))
    if_node(f, "Email accepted by SES?", "={{ $json.sent === true }}", (1680, 280))
    pg(f, "Mark matches notified", "mark_notified.sql", "[ $json.match_ids_json ]", (1920, 200))
    f.add("Left un-notified (will retry)", "n8n-nodes-base.noOp", 1, {}, (1920, 400))
    f.add("Merge outcomes", "n8n-nodes-base.merge", 3, {"mode": "append"}, (2160, 300))
    code_node(f, "Notification summary", "notify_summary.js", (2400, 300))

    for t in ("Executed by Workflow B", "Manual trigger", "Notify now (webhook)"):
        f.link(t, "Read batch id")
    for a, b in [("Read batch id", "Load pending notifications"), ("Load pending notifications", "Anyone to email?")]:
        f.link(a, b)
    f.link("Anyone to email?", "Build email", 0)
    f.link("Anyone to email?", "Nothing to send", 1)
    for a, b in [("Build email", "Send via SES"), ("Send via SES", "Record send outcome"),
                 ("Record send outcome", "Email accepted by SES?")]:
        f.link(a, b)
    f.link("Email accepted by SES?", "Mark matches notified", 0)
    f.link("Email accepted by SES?", "Left un-notified (will retry)", 1)
    f.link("Mark matches notified", "Merge outcomes", 0, target_input=0)
    f.link("Left un-notified (will retry)", "Merge outcomes", 0, target_input=1)
    f.link("Merge outcomes", "Notification summary")
    f.dump("C_match_notifications.json")


# ----------------------------------------------------------------------------- Workflow R
def build_workflow_r():
    f = Flow("workflowR0000001", "R - Lender Notes (LLM reviews)", error_workflow=ERROR_WORKFLOW_ID)
    f.add("Executed by another workflow", "n8n-nodes-base.executeWorkflowTrigger", 1.1,
          {"inputSource": "passthrough"}, (0, 100))
    f.add("Manual trigger", "n8n-nodes-base.manualTrigger", 1, {}, (0, 280))
    # On demand: curl -X POST http://<n8n>:5678/webhook/review-now  [-d '{"scope":"used","batch_id":"..."}']
    f.add("Review now (webhook)", "n8n-nodes-base.webhook", 2,
          {"httpMethod": "POST", "path": "review-now", "authentication": "headerAuth",
           "responseMode": "onReceived", "options": {}},
          (0, 460), credentials=CRED_WEBHOOK, webhookId="review-now-webhook")
    code_node(f, "Read review request", "read_review_request.js", (240, 280))
    pg(f, "Plan reviews (cache check)", "plan_reviews.sql", "[ $json.scope, $json.batch_id ]", (480, 280),
       always_output=True)
    if_node(f, "Needs LLM review?", "={{ $json.product_id !== undefined }}", (720, 280))
    f.add("No reviews needed", "n8n-nodes-base.noOp", 1, {}, (960, 460))
    code_node(f, "Assign provider", "assign_provider.js", (960, 200))
    # Work through the lenders in small batches and save after EACH batch, so a restart or a
    # rate-limit stall loses at most one batch instead of the whole queue.
    f.add("Loop over lenders", "n8n-nodes-base.splitInBatches", 3, {"batchSize": 6, "options": {}}, (1200, 200))
    prompt = json.dumps((CODE / "prompt_review_system.txt").read_text().strip())
    code_node(f, "Build review prompt", "build_review_prompt.js", (1440, 100), __SYSTEM_PROMPT__=prompt)
    if_node(f, "Groq lane?", "={{ $json.provider === 'groq' }}", (1680, 100))

    # Groq lane (one lender in ~15 s: the free tier is token-limited); failures fall back to Gemini
    groq_node(f, "Groq: review lender", (1920, 0), 15000, max_tokens=900)
    code_node(f, "Validate groq review", "normalize_review.js", (2160, 0), __PROVIDER__="groq")
    if_node(f, "Groq answer complete?", "={{ $json.all_valid === true }}", (2400, 0))
    gemini_node(f, "Gemini fallback: review lender", (2640, 100), 5000)
    code_node(f, "Validate gemini fallback review", "normalize_review.js", (2880, 100), __PROVIDER__="gemini")
    # Gemini lane (flash-lite allows ~15 requests/min)
    gemini_node(f, "Gemini: review lender", (1920, 300), 5000)
    code_node(f, "Validate gemini review", "normalize_review.js", (2160, 300), __PROVIDER__="gemini")

    f.add("Merge review results", "n8n-nodes-base.merge", 3, {"mode": "append", "numberInputs": 3}, (3120, 200))
    code_node(f, "Collect rows to save", "collect_review_rows.js", (3360, 200))
    pg(f, "Upsert reviews", "upsert_reviews.sql", "[ $json.rows_json ]", (3600, 200))
    code_node(f, "Total saved", "sum_saved.js", (1440, 400))
    pg(f, "Coverage check", "coverage_check.sql",
       "[ $('Read review request').first().json.scope, $('Read review request').first().json.batch_id ]", (1680, 400))
    code_node(f, "Review summary", "review_summary.js", (1920, 400))

    for t in ("Executed by another workflow", "Manual trigger", "Review now (webhook)"):
        f.link(t, "Read review request")
    for a, b in [("Read review request", "Plan reviews (cache check)"), ("Plan reviews (cache check)", "Needs LLM review?")]:
        f.link(a, b)
    f.link("Needs LLM review?", "Assign provider", 0)
    f.link("Needs LLM review?", "No reviews needed", 1)
    f.link("Assign provider", "Loop over lenders")
    f.link("Loop over lenders", "Total saved", 0)               # output 0 = done (every batch saved)
    f.link("Loop over lenders", "Build review prompt", 1)       # output 1 = next batch
    f.link("Build review prompt", "Groq lane?")
    f.link("Groq lane?", "Groq: review lender", 0)
    f.link("Groq lane?", "Gemini: review lender", 1)
    for a, b in [("Groq: review lender", "Validate groq review"), ("Validate groq review", "Groq answer complete?")]:
        f.link(a, b)
    f.link("Groq answer complete?", "Merge review results", 0, target_input=0)
    f.link("Groq answer complete?", "Gemini fallback: review lender", 1)
    f.link("Gemini fallback: review lender", "Validate gemini fallback review")
    f.link("Validate gemini fallback review", "Merge review results", 0, target_input=1)
    f.link("Gemini: review lender", "Validate gemini review")
    f.link("Validate gemini review", "Merge review results", 0, target_input=2)
    for a, b in [("Merge review results", "Collect rows to save"), ("Collect rows to save", "Upsert reviews"),
                 ("Upsert reviews", "Loop over lenders"),
                 ("Total saved", "Coverage check"), ("Coverage check", "Review summary")]:
        f.link(a, b)
    f.dump("R_lender_notes.json")


# ----------------------------------------------------------------------------- Workflow E
def build_workflow_e():
    """Failure alerts. n8n starts this workflow whenever A, B, C or R fails (their settings point here),
    so a failed run is never silent. It mails the owner's own verified SES address."""
    f = Flow(ERROR_WORKFLOW_ID, "E - Failure Alerts")   # no error_workflow here: an alert about alerts would loop
    f.add("Error Trigger", "n8n-nodes-base.errorTrigger", 1, {}, (0, 160))
    pg(f, "Load alert address", "alert_address.sql", None, (240, 160), always_output=True)
    code_node(f, "Build alert", "build_alert.js", (480, 160))
    f.add("Send alert via SES", "n8n-nodes-base.awsSes", 1, {
        "resource": "email", "operation": "send", "fromEmail": "={{ $json.from }}",
        "toAddresses": "={{ [ $json.to ] }}", "subject": "={{ $json.subject }}",
        "body": "={{ $json.html }}", "isBodyHtml": True, "additionalFields": {}},
        (720, 160), credentials=CRED_AWS, onError="continueRegularOutput")
    for a, b in [("Error Trigger", "Load alert address"), ("Load alert address", "Build alert"),
                 ("Build alert", "Send alert via SES")]:
        f.link(a, b)
    f.dump("E_failure_alerts.json")


if __name__ == "__main__":
    import sys
    if "--fallback-test" in sys.argv:
        OUT = Path(sys.argv[sys.argv.index("--fallback-test") + 1])  # keep the throwaway out of the repo
        build_workflow_a(fallback_test=True)
    else:
        build_workflow_a()
        build_workflow_b()
        build_workflow_c()
        build_workflow_r()
        build_workflow_e()
