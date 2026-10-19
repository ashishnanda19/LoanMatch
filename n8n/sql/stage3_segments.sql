-- STAGE 3 input: which (product x employment-type) segments still need an LLM review?
-- Only Stage 2 survivors, only products with fuzzy criteria text, and only segments whose
-- cached verdict is missing or was made for different inputs. criteria_hash covers the
-- qualitative text AND the source text the model is shown, plus a prompt-version tag ('rv3'),
-- so changing any of them re-reviews automatically.
-- On a re-run with unchanged crawl data this returns ZERO rows => zero LLM calls.
-- $1 = batch_id
SELECT p.product_id,
       p.product_name,
       p.qualitative_criteria_text,
       md5('rv3|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, '')) AS criteria_hash,
       left(COALESCE(p.raw_criteria_text, ''), 1500)                     AS source_text,
       array_to_string(p.allowed_employment_types, ', ')                 AS accepted_types,
       u.employment_status                                               AS employment_type,
       count(*)                                                          AS candidates,
       min(u.monthly_income)                                             AS income_min,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY u.monthly_income))::int AS income_median,
       max(u.monthly_income)                                             AS income_max,
       min(u.credit_score)                                               AS score_min,
       max(u.credit_score)                                               AS score_max,
       min(u.age)                                                        AS age_min,
       max(u.age)                                                        AS age_max
FROM match_candidates mc
JOIN users u          ON u.user_id = mc.user_id
JOIN loan_products p  ON p.product_id = mc.product_id
LEFT JOIN qualitative_reviews r
       ON r.product_id = p.product_id AND r.employment_type = u.employment_status
WHERE mc.batch_id = $1::uuid
  AND mc.exact_ok
  AND p.qualitative_criteria_text IS NOT NULL
  AND r.criteria_hash IS DISTINCT FROM md5('rv3|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, ''))
GROUP BY p.product_id, p.product_name, p.qualitative_criteria_text, p.raw_criteria_text,
         p.allowed_employment_types, u.employment_status
ORDER BY p.product_id, u.employment_status
