-- Credit-score transparency. A lender may publish a minimum score for some applicant types but state
-- none for others (e.g. Indian Bank: 700 for salaried, nothing extracted for self-employed). Treating
-- the silence as "no limit" would silently match a 670 applicant, so Stage 2 records both floors and
-- Stage 3 flags (and ranks behind) matches whose score is below a floor the lender states elsewhere.
BEGIN;
ALTER TABLE match_candidates ADD COLUMN IF NOT EXISTS score_floor_own INTEGER;  -- floor in the rule(s) that admit this user (NULL = unstated)
ALTER TABLE match_candidates ADD COLUMN IF NOT EXISTS score_floor_any INTEGER;  -- highest floor the lender states for ANY applicant type

ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_floor_own INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_floor_any INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_flag      BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
