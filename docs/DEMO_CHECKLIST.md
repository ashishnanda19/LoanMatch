# Demo video checklist (target 8-9 minutes, hard limit 10)

## A. The day before / one hour before recording

- [ ] **Your IP.** `curl https://checkip.amazonaws.com` must equal `my_ip_cidr` in `infra/terraform.tfvars`. If it changed: edit the file, `terraform -chdir=infra apply`.
- [ ] **n8n is up:** open `http://<n8n-ip>:5678` (`terraform -chdir=infra output n8n_url`). All five workflows (A, B, C, R, E) show **Published**.
- [ ] **Green board:** `./scripts/n8n_status.sh` shows recent runs as `success`.
- [ ] **Lender data is fresh** (matching only uses lenders crawled in the last 7 days): run `curl -X POST -H "X-Webhook-Secret: $(terraform -chdir=infra output -raw webhook_secret)" http://<n8n-ip>:5678/webhook/crawl-now`, wait for run A to finish (~6 min), then `./scripts/watch_reviews.sh` until every lender has a note (the counter stops increasing and reaches its total).
- [ ] **Free-tier quotas:** Groq and Gemini reset daily. If a crawl or review run shows red nodes with HTTP 429, wait and retry; never record on a throttled day.
- [ ] **Clean slate for the live run:** `./scripts/reset_demo_data.sh` (keeps lenders, notes and the test-recipient mapping).
- [ ] **SES:** both aliases verified (`aws ses get-identity-verification-attributes --region ap-south-1 --identities <sender> <alias1> <alias2>`). Open Gmail → **Spam** and mark the old emails *Not spam* so new ones land in the inbox.
- [ ] **Screen hygiene:** close tabs with API keys, the AWS secrets page, and any terminal showing `terraform output -raw db_password`. Do not open `infra/terraform.tfvars` or `loan-engine-n8n.pem` on camera.
- [ ] Tabs ready: README (diagram), n8n editor, upload page (`./scripts/write_ui_config.sh`, then `python3 -m http.server 8000 --directory ui`), Gmail, a terminal.
- [ ] Rehearse once end to end with a stopwatch.

## B. Recording script (node by node)

| Time | Show | Say |
|---|---|---|
| 0:00-0:45 | README architecture diagram | The problem (users × lenders), the five workflows and the two rules that shape the design: **the LLM reads lender pages once, never per user**, and **all per-user work is SQL**. |
| 0:45-1:45 | AWS console + `infra/` | Browser → API Gateway → Lambda issues a presigned URL → CSV goes straight to S3 → S3 event → parse-csv Lambda → RDS. Security groups: RDS and n8n are reachable only from the Lambda and my IP. Terraform provisions everything; `serverless.yml` defines the same three Lambdas, the HTTP API and the S3 trigger for the Serverless Framework (validated, not deployed). |
| 1:45-3:15 | **Workflow A** (open it, go left to right) | Triggers (schedule, manual, webhook) → *Seed sources* (3 sites) → *Parse lender tables* (deterministic, no LLM for the rate table) → *Fetch lender page* → *Extract eligibility text* (2.5 KB instead of 800 KB) → *Groq extract* → *Validate* → if invalid, *Gemini fallback* → *Upsert loan product* → hand-off to R. Mention per-employment-type rules (ICICI example). |
| 3:15-5:15 | **Workflow B** (the Treasure Hunt) | Open each stage and show the SQL: reconcile lenders (45 → 34) → Stage 1 envelope (SQL, staging table) → Stage 2 exact rules → Stage 3 rank, keep top 5 → *Funnel report*. Read the real numbers: **450,000 → 340,000 → 255,951 → 246,591 → 50,000, 0 LLM calls, ~18 s**. Be honest: numeric filters remove ~25%; the win is keeping the LLM out and ranking to a top 5. |
| 5:15-6:15 | **Workflow R** | Cache check by content hash → one call per lender → Groq/Gemini lanes → saved every 6 lenders. Users growing never adds LLM calls; only a changed lender text does. |
| 6:15-6:45 | **Workflow C** and **E** | Recipient comes from `test_recipients` only (CSV emails can never be mailed), one email per user, `notified_at` set only after SES accepts. Mention **E**: any failed run in A, B, C or R emails the owner. |
| 6:45-8:30 | **LIVE RUN** | `reset_demo_data.sh` already done. Open the web UI (`./scripts/write_ui_config.sh`, then `python3 -m http.server 8000 --directory ui`), go to **Console → Upload** and drop `users.csv`; the pipeline stepper advances on its own. Switch to B's **Executions** tab and refresh: **B (≈17 s) → R (<1 s) → C (<1 s)**. Open the received email in Gmail: real lenders, "From X%" rates, credit-score column, conditions. In a terminal run `./scripts/seed_test_recipients.sh` first time only, then `curl -X POST -H "X-Webhook-Secret: ..." .../webhook/notify-now`. Show `notified_at` set, then run **notify-now again: 0 emails** (idempotent). |
| 8:15-8:45 | **Check offers** page | Enter Fatima's profile (150000 / 670 / 41 / Self-Employed): the same five lenders as her email, instantly. Open **Customers** to show her stored offers. |
| 8:30-9:15 | README "Accuracy and known limitations" | Matching is exact and was audited for all 10,000 users; the data is public web text read by an LLM, so results are indicative. The score-flag example (Indian Bank 700). |

## C. Likely panel questions

- **Why not ask the LLM about every user?** 450,000 calls. The LLM reads each lender once; users are matched in SQL.
- **Why five workflows, not one?** Different triggers and lifecycles; R is reused by A and B; a crawl failure cannot stop matching; and the slow LLM work stays out of the upload path (23 s upload → email).
- **What if Groq is down or rate limited?** Gemini fallback; matching does not depend on the LLM at all; failed notes retry next run.
- **Why does the matching use SQL when the brief says "logic within n8n"?** n8n owns every stage: it triggers them, passes data between them, records the funnel and handles failures. The set-based filtering runs in Postgres because 450,000 pairs take about a second there and would take minutes in a Code node.
- **Is it accurate?** Matching logic: yes (independent recompute, 0 differences). Inputs: indicative, from public pages; flagged cases are shown to the user.
- **What if I upload 1,000,000 users?** Matching is set-based SQL and scales with Postgres, not n8n memory; LLM calls stay at ~36 per full lender pass.
- **How do you stop real customers being emailed?** The query joins `test_recipients` and never selects `users.email`; SES sandbox also only delivers to verified addresses.
- **Why Terraform and a `serverless.yml`?** Terraform owns the whole stack (VPC, RDS, S3, IAM, SES, EC2). `serverless.yml` is the Serverless Framework definition of the Lambda layer, reusing Terraform's roles and secrets via `scripts/serverless_env.sh`. It is validated with `serverless print` but not deployed, because both would own the bucket's notification. One deploy path per environment.
- **Security trade-offs you made?** Plain-HTTP n8n locked to one IP, RDS publicly addressable but only from my IP (for laptop `psql` and audits), DB password in an environment variable, n8n's Postgres credential not chain-verified. All documented in the README with the production alternative.

## D. After the demo

- [ ] Make sure the repo is **private** and the four collaborators are invited.
- [ ] Rotate the Groq and Gemini API keys.
- [ ] `terraform -chdir=infra destroy` to stop AWS charges (RDS, EC2 and the Elastic IP bill by the hour).
- [ ] Delete the stray `TEST - Gemini fallback`, `DIAG - LLM probe` and `TEST - forced failure` workflows from the n8n editor if the instance is kept.
