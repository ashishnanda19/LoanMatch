-- The rate shown to a user is the lowest published across lender sources (decided in Stage 0),
-- so it is stored with the match instead of being re-read from one source's product row.
BEGIN;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(5,2);
COMMIT;
