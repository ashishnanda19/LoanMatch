-- Backend for the web UI.
--  * lender_offers: the canonical lenders (one per bank, lowest published rate) that Workflow B's Stage 0
--    decided on. B saves them on every run; the API reads them so the UI sees exactly what matching used.
--  * match_user(): the same Stage 2 + Stage 3 rules as the set-based SQL in n8n/sql/stage2_exact.sql and
--    stage3_rank_top.sql, for ONE person, so the UI can answer "what would I get?" instantly.
--    scripts/verify_match_user.sh proves it returns the same top 5 as the stored matches.
BEGIN;

CREATE TABLE IF NOT EXISTS lender_offers (
    product_id      BIGINT       PRIMARY KEY REFERENCES loan_products (product_id) ON DELETE CASCADE,
    effective_rate  NUMERIC(5,2),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION match_user(p_income integer, p_score integer, p_age integer, p_type text, p_top integer DEFAULT 5)
RETURNS TABLE (match_rank integer, product_id bigint, product_name text, interest_rate numeric,
               score_floor_own integer, score_floor_any integer, score_flag boolean,
               verdict text, caveat text)
LANGUAGE sql STABLE AS $$
WITH cand AS (
    SELECT p.product_id, p.product_name, lo.effective_rate AS rate, x.margin, x.floor_own, x.floor_any,
           (x.floor_own IS NULL AND x.floor_any IS NOT NULL AND x.floor_any > p_score) AS score_flag,
           p.raw_criteria_text
    FROM lender_offers lo
    JOIN loan_products p ON p.product_id = lo.product_id
    CROSS JOIN LATERAL (
        SELECT count(*) AS passing,
               max(p_score - (r ->> 'min_credit_score')::int) AS margin,
               CASE WHEN bool_or((r ->> 'min_credit_score') IS NULL) THEN NULL
                    ELSE min((r ->> 'min_credit_score')::int) END AS floor_own,
               (SELECT max((r2 ->> 'min_credit_score')::int) FROM jsonb_array_elements(p.eligibility_rules) AS r2) AS floor_any
        FROM jsonb_array_elements(p.eligibility_rules) AS r
        WHERE p_type IN (SELECT jsonb_array_elements_text(r -> 'employment_types'))
          AND p_income >= COALESCE((r ->> 'min_income')::int, 0)
          AND p_score  >= COALESCE((r ->> 'min_credit_score')::int, 0)
          AND p_age BETWEEN COALESCE((r ->> 'min_age')::int, 0) AND COALESCE((r ->> 'max_age')::int, 200)
    ) x
    WHERE p.eligibility_rules IS NULL OR x.passing > 0
), ranked AS (
    SELECT c.*, row_number() OVER (ORDER BY c.score_flag, c.rate ASC NULLS LAST, c.margin DESC NULLS LAST, c.product_id) AS rn
    FROM cand c
)
SELECT rk.rn::integer, rk.product_id, rk.product_name, rk.rate, rk.floor_own, rk.floor_any, rk.score_flag, r.verdict, r.caveat
FROM ranked rk
LEFT JOIN qualitative_reviews r
       ON r.product_id = rk.product_id AND r.employment_type = p_type
      AND r.criteria_hash = md5('rv5|' || COALESCE(rk.raw_criteria_text, ''))
WHERE rk.rn <= p_top
ORDER BY rk.rn
$$;
COMMIT;
