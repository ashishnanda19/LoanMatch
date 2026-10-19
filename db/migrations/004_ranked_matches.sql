-- Ranked matches: each user keeps only their best few lenders, not every lender they qualify for.
BEGIN;

-- Stage 2 records how far above the lender's credit-score floor the user is (NULL = no floor
-- stated). It is the tie-breaker when two lenders charge the same rate.
ALTER TABLE match_candidates ADD COLUMN IF NOT EXISTS credit_margin INTEGER;

-- match_rank 1 = best offer for this user (lowest interest rate, then biggest margin).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_rank    SMALLINT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS credit_margin INTEGER;
CREATE INDEX IF NOT EXISTS idx_matches_user_rank ON matches (user_id, match_rank);

COMMIT;
