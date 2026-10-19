-- Loan Eligibility Engine: initial schema
-- Idempotent where practical (IF NOT EXISTS) so it is safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- batches: one row per CSV upload.
-- Every user row is tagged with the batch that brought it in, so Workflow B can
-- process exactly "the newly added users" instead of re-scanning the whole table,
-- and so partial/failed ingests are observable (status, skipped_rows).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batches (
    batch_id      UUID        PRIMARY KEY,
    s3_key        TEXT,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_count     INTEGER     NOT NULL DEFAULT 0,   -- rows inserted
    skipped_rows  INTEGER     NOT NULL DEFAULT 0,   -- rows rejected by validation
    status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'processed', 'failed'))
);

-- ---------------------------------------------------------------------------
-- users: email is intentionally NOT unique (sample data has ~2.6k distinct
-- emails across 10k rows). user_id is the only key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id            UUID        PRIMARY KEY,
    name               TEXT        NOT NULL,
    email              TEXT        NOT NULL,
    monthly_income     INTEGER     NOT NULL CHECK (monthly_income >= 0),
    credit_score       INTEGER     NOT NULL CHECK (credit_score BETWEEN 300 AND 900),
    employment_status  TEXT        NOT NULL
                       CHECK (employment_status IN ('Salaried', 'Self-Employed', 'Business')),
    age                INTEGER     NOT NULL CHECK (age BETWEEN 18 AND 100),
    batch_id           UUID        NOT NULL REFERENCES batches (batch_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_batch_id ON users (batch_id);

-- ---------------------------------------------------------------------------
-- loan_products: populated by Workflow A (crawler).
-- (source_site, product_name) is the natural key so daily re-crawls UPSERT
-- instead of duplicating.
-- NULL in a min_/max_ column means "no such constraint stated" and must be
-- treated as unrestricted by the Stage 1 SQL pre-filter.
-- qualitative_criteria_text holds only the fuzzy, non-numeric criteria
-- ("stable employment history preferred"); NULL means the product is fully
-- decidable from the numeric columns and never needs an LLM call (Stage 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_products (
    product_id                 BIGSERIAL    PRIMARY KEY,
    source_site                TEXT         NOT NULL,
    product_name               TEXT         NOT NULL,
    interest_rate              NUMERIC(5,2),             -- annual %, lowest advertised
    min_income                 INTEGER,
    min_credit_score           INTEGER,
    min_age                    INTEGER,
    max_age                    INTEGER,
    allowed_employment_types   TEXT[],                   -- NULL = any
    raw_criteria_text          TEXT,
    qualitative_criteria_text  TEXT,
    last_crawled_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (source_site, product_name)
);

-- ---------------------------------------------------------------------------
-- matches: result of Workflow B, consumed by Workflow C.
-- UNIQUE (user_id, product_id) makes matching idempotent: re-running a batch
-- (webhook retry, manual re-run) uses ON CONFLICT DO NOTHING and cannot create
-- duplicate matches, which would otherwise mean duplicate lines in emails.
-- notified_at NULL = not yet emailed; Workflow C selects on that and stamps it
-- after a successful send so re-runs never re-email.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
    match_id      BIGSERIAL    PRIMARY KEY,
    user_id       UUID         NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    product_id    BIGINT       NOT NULL REFERENCES loan_products (product_id) ON DELETE CASCADE,
    match_method  TEXT         NOT NULL DEFAULT 'numeric'
                  CHECK (match_method IN ('numeric', 'llm')),
    matched_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    notified_at   TIMESTAMPTZ,
    CONSTRAINT uq_matches_user_product UNIQUE (user_id, product_id)
);

-- Workflow C's hot query: "unnotified matches".
CREATE INDEX IF NOT EXISTS idx_matches_unnotified ON matches (user_id) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matches_product_id ON matches (product_id);

COMMIT;
