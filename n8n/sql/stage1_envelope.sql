-- STAGE 1: cheap SQL pre-filter on the permissive "envelope" columns.
-- The envelope is a SUPERSET of every per-type rule (a NULL means "no floor/ceiling stated"),
-- so this can only remove users who qualify under no rule at all. Set-based, in Postgres, and
-- the surviving pairs stay in the staging table instead of flowing through n8n.
-- $1 = batch_id, $2 = JSON array of canonical product_ids (from Stage 0)
WITH ids AS (
    SELECT (jsonb_array_elements_text($2::jsonb))::bigint AS product_id
), ins AS (
    INSERT INTO match_candidates (batch_id, user_id, product_id)
    SELECT $1::uuid, u.user_id, p.product_id
    FROM users u
    JOIN loan_products p ON p.product_id IN (SELECT product_id FROM ids)
    WHERE u.batch_id = $1::uuid
      AND u.monthly_income >= COALESCE(p.min_income, 0)
      AND u.credit_score   >= COALESCE(p.min_credit_score, 0)
      AND u.age BETWEEN COALESCE(p.min_age, 0) AND COALESCE(p.max_age, 200)
      AND (p.allowed_employment_types IS NULL OR u.employment_status = ANY (p.allowed_employment_types))
    RETURNING 1
)
SELECT (SELECT count(*) FROM users WHERE batch_id = $1::uuid) AS users_in_batch,
       (SELECT count(*) FROM ids)                             AS products,
       count(*)                                               AS stage1_pairs
FROM ins
