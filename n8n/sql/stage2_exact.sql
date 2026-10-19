-- STAGE 2: exact per-employment-type rules, applied only to Stage 1 survivors.
-- A user passes if ANY rule of the product matches their employment type AND all of that
-- rule's numeric limits (an unstated limit is no limit).
-- $1 = batch_id
WITH upd AS (
    UPDATE match_candidates mc
    SET exact_ok = TRUE
    FROM users u, loan_products p
    WHERE mc.batch_id = $1::uuid
      AND u.user_id = mc.user_id
      AND p.product_id = mc.product_id
      AND (
          p.eligibility_rules IS NULL
          OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(p.eligibility_rules) AS r
              WHERE u.employment_status IN (SELECT jsonb_array_elements_text(r -> 'employment_types'))
                AND u.monthly_income >= COALESCE((r ->> 'min_income')::int, 0)
                AND u.credit_score   >= COALESCE((r ->> 'min_credit_score')::int, 0)
                AND u.age BETWEEN COALESCE((r ->> 'min_age')::int, 0) AND COALESCE((r ->> 'max_age')::int, 200)
          )
      )
    RETURNING 1
)
SELECT count(*) AS stage2_pairs FROM upd
