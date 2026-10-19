-- Workflow B (matching) support.
BEGIN;

-- Batch lifecycle gains matching/matched, plus the numbers that prove the optimisation.
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_status_check;
ALTER TABLE batches ADD CONSTRAINT batches_status_check
    CHECK (status IN ('pending', 'processing', 'processed', 'matching', 'matched',
                      'webhook_failed', 'failed'));
ALTER TABLE batches ADD COLUMN IF NOT EXISTS match_stats JSONB;   -- funnel counts per stage
ALTER TABLE batches ADD COLUMN IF NOT EXISTS matched_at  TIMESTAMPTZ;

-- Staging table for the multi-stage filter. Candidate pairs live in Postgres, never in
-- n8n's memory: 10k users x ~40 products is hundreds of thousands of pairs.
--   Stage 1 inserts every pair that passes the permissive envelope;
--   Stage 2 flips exact_ok for pairs that satisfy the exact per-employment-type rules.
CREATE TABLE IF NOT EXISTS match_candidates (
    batch_id    UUID    NOT NULL REFERENCES batches (batch_id) ON DELETE CASCADE,
    user_id     UUID    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    product_id  BIGINT  NOT NULL REFERENCES loan_products (product_id) ON DELETE CASCADE,
    exact_ok    BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (batch_id, user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_match_candidates_product ON match_candidates (batch_id, product_id);

-- Stage 3 cache. The LLM reviews a product's qualitative criteria once per applicant
-- segment (employment type), not once per user, and the verdict is reused until the
-- criteria text changes (criteria_hash = md5 of qualitative_criteria_text).
--   eligible    : the qualitative criteria place no extra conditions on this segment
--   conditional : may qualify, subject to facts we do not hold (caveat says which)
--   ineligible  : reserved. The workflow never writes it: LLM vetoes were unreliable on real
--                 data, so the reviewer can only annotate, never remove a user (see README).
CREATE TABLE IF NOT EXISTS qualitative_reviews (
    product_id       BIGINT      NOT NULL REFERENCES loan_products (product_id) ON DELETE CASCADE,
    employment_type  TEXT        NOT NULL
                     CHECK (employment_type IN ('Salaried', 'Self-Employed', 'Business')),
    criteria_hash    TEXT        NOT NULL,
    verdict          TEXT        NOT NULL CHECK (verdict IN ('eligible', 'conditional', 'ineligible')),
    caveat           TEXT,
    provider         TEXT,
    reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, employment_type)
);

COMMIT;
