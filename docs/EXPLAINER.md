# The system in one page

Read this before the video or a Q&A. Each block says what a part does, why it is built that way, and where to look.

## The flow

`browser → API Gateway → get-upload-url Lambda → (presigned POST) → S3 → parse-csv Lambda → RDS → webhook → n8n B → n8n R → n8n C → SES`

Workflow A (crawler) runs on a schedule and keeps `loan_products` fresh. Workflow E mails the owner if A, B, C or R fails.

## Ingestion (the "scalable, event-driven" requirement)

- **Why presigned upload.** A Lambda behind API Gateway cannot take a large file (10 MB request cap, 30 s timeout). The browser asks for a signed URL, then uploads straight to S3. S3 raises an event and `parse-csv` does the work. File size never touches Lambda or API Gateway. Look at `lambdas/get_upload_url/handler.py`.
- **Why `parse-csv` is safe to retry.** S3 can deliver an event twice. Inserts use `ON CONFLICT DO NOTHING`, and the final row count is recomputed from the table, so a second run reports the same numbers. Look at `lambdas/parse_csv/handler.py`.
- **Why `user_id` is the key, not email.** The CSV has 10,000 rows and only 2,632 distinct emails. An email key would silently drop most users.
- **Security.** The upload endpoint needs an `x-api-key`; n8n webhooks need `X-Webhook-Secret`; RDS and n8n accept only the Lambda and your IP.

## Workflow A: discovery

Schedule, manual or webhook → seed three sources → parse the lender table from the list page (rates, deterministic, no LLM) → fetch each lender's page → cut the page down to eligibility facts (`n8n/code/extract_eligibility.js`) → LLM turns the text into rules per employment type → validate → Gemini fallback if Groq's answer is invalid → upsert.

- **Why the cut-down matters.** An 800 KB page becomes about 1.2 KB of eligibility facts, which makes the LLM call cheap, fast and less likely to misread. The audit showed this step, not the model, decides accuracy.
- **Why guards after the LLM.** The LLM is not trusted blindly. `normalize_extraction.js` rejects out-of-range numbers, refuses extra employment types the page never mentions, and drops a credit-score floor that is only advice ("700+ gives higher chances").

## Workflow B: the Treasure Hunt

The naive way is 10,000 users × 45 lenders = 450,000 LLM calls. Instead:

1. **Stage 0** reconciles the same bank listed on several sites into one record (45 → 34 lenders, so 340,000 pairs) and keeps the lowest published rate.
2. **Stage 1** is a SQL "envelope": the loosest bounds of any of a lender's rules, with NULL meaning "no stated limit", so it can never drop someone who qualifies (252,563 pairs).
3. **Stage 2** applies the exact per-employment-type rules (242,095 pairs).
4. **Stage 3** ranks (unflagged first, then lowest rate, then widest score margin) and keeps the top 5 per user (50,000 matches).

The LLM makes **zero** calls here. Its only jobs are reading each lender once (A) and writing a short "good to know" note once per lender (R). Adding users adds no LLM cost. Be honest on camera: the numeric filters remove about 25% of the reconciled pairs; the real saving is keeping the LLM out of the per-user path and ranking to a short list.

## Workflow R: lender notes

Notes are cached by a hash of the lender's text, so a re-crawl re-reviews only lenders whose page changed (proved: 1 lender re-reviewed, 4.1 s instead of 448.7 s). The LLM may mark a lender `eligible` or `conditional` with a caveat but never removes a match; eligibility is decided only by exact SQL. A first version let the LLM veto and it flipped between runs.

## Workflow C: notifications

One email per user, built from the stored top 5. The recipient comes only from `test_recipients`, so CSV addresses are never mailed. `notified_at` is set only after SES accepts, so a failure retries and a second run sends nothing.

## Things you can say you verified

- All 10,000 top-5 lists re-derived independently in Python: 0 differences (`scripts/audit_matches.py`).
- The instant "Check offers" function matches the batch pipeline for 3,000 users: 0 differences (`scripts/verify_match_user.sh`).
- All 45 lender records were read against the live pages and the text the LLM saw; the audit and the fixes are in README section 6.

## Things to be honest about

- Lender data is public web text read by an LLM, so results are indicative, not an offer.
- The LLM can read an ambiguous page two ways on different days (Indian Bank).
- `serverless.yml` is validated but not deployed; Terraform is the path that was run.
- n8n is plain HTTP restricted to your IP; RDS is publicly addressable but only from your IP.
