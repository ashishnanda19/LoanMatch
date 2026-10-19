-- Per-employment-type eligibility rules extracted by Workflow A.
--
-- eligibility_rules: JSON array, e.g.
--   [{"employment_types":["Salaried"],"min_income":30000,"min_credit_score":null,"min_age":20,"max_age":58},
--    {"employment_types":["Self-Employed","Business"],"min_income":null,"min_credit_score":null,"min_age":23,"max_age":65}]
-- The flat min_income / min_credit_score / min_age / max_age / allowed_employment_types
-- columns hold the *envelope* of these rules (lowest minimums, widest age range, union of
-- types). Stage 1 of the matching pipeline filters on the envelope, so it can never drop a
-- user who would qualify under any rule; Stage 2 then applies the exact per-type rules.
BEGIN;
ALTER TABLE loan_products ADD COLUMN IF NOT EXISTS eligibility_rules JSONB;
COMMIT;
