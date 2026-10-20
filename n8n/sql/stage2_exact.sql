-- STAGE 2: exact per-employment-type rules, applied only to Stage 1 survivors.
-- A user passes if ANY rule of the product matches their employment type AND all of that
-- rule's numeric limits (an unstated limit is no limit). Also records, for the credit-score check:
--   credit_margin   how far the user's score is above the most generous passing rule's floor
--   score_floor_own the floor of the rule(s) that admit the user (NULL = the lender states none for them)
--   score_floor_any the highest floor the lender states for ANY applicant type
-- $1 = batch_id
WITH upd AS (
    UPDATE match_candidates mc
    SET exact_ok = TRUE, credit_margin = x.margin,
        score_floor_own = x.floor_own, score_floor_any = x.floor_any
    FROM users u, loan_products p,
    LATERAL (
        SELECT count(*) AS passing,
               max(u.credit_score - (r ->> 'min_credit_score')::int) AS margin,
               CASE WHEN bool_or((r ->> 'min_credit_score') IS NULL) THEN NULL
                    ELSE min((r ->> 'min_credit_score')::int) END AS floor_own,
               (SELECT max((r2 ->> 'min_credit_score')::int)
                  FROM jsonb_array_elements(p.eligibility_rules) AS r2) AS floor_any
        FROM jsonb_array_elements(p.eligibility_rules) AS r
        WHERE u.employment_status IN (SELECT jsonb_array_elements_text(r -> 'employment_types'))
          AND u.monthly_income >= COALESCE((r ->> 'min_income')::int, 0)
          AND u.credit_score   >= COALESCE((r ->> 'min_credit_score')::int, 0)
          AND u.age BETWEEN COALESCE((r ->> 'min_age')::int, 0) AND COALESCE((r ->> 'max_age')::int, 200)
    ) x
    WHERE mc.batch_id = $1::uuid
      AND u.user_id = mc.user_id
      AND p.product_id = mc.product_id
      AND (p.eligibility_rules IS NULL OR x.passing > 0)
    RETURNING 1
)
SELECT count(*) AS stage2_pairs FROM upd
