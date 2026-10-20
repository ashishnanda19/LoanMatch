-- Which lenders still need an LLM note, and for which employment types? One row per LENDER, with
-- the stale employment types grouped, so one LLM call covers all of them.
--   scope 'used': only (lender, employment type) pairs that appear in this batch's matches
--   scope 'all' : every fresh lender
-- criteria_hash covers the qualitative text, the source text the model sees and a prompt-version
-- tag ('rv4'): unchanged crawl data returns ZERO rows => zero LLM calls.
-- $1 = scope, $2 = batch_id or ''
WITH used AS (
    SELECT DISTINCT m.product_id, u.employment_status AS employment_type
    FROM matches m
    JOIN users u ON u.user_id = m.user_id
    WHERE $1 = 'used' AND u.batch_id = NULLIF($2, '')::uuid
), segs AS (
    SELECT p.product_id, p.product_name, p.qualitative_criteria_text, p.raw_criteria_text, t.employment_type,
           md5('rv4|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, '')) AS criteria_hash
    FROM loan_products p
    CROSS JOIN LATERAL unnest(COALESCE(p.allowed_employment_types, ARRAY['Salaried', 'Self-Employed', 'Business'])) AS t(employment_type)
    WHERE p.last_crawled_at > now() - interval '7 days'
      AND p.qualitative_criteria_text IS NOT NULL
      AND ($1 <> 'used' OR EXISTS (SELECT 1 FROM used x WHERE x.product_id = p.product_id AND x.employment_type = t.employment_type))
)
SELECT s.product_id, s.product_name, s.qualitative_criteria_text, s.criteria_hash,
       left(COALESCE(s.raw_criteria_text, ''), 1500)        AS source_text,
       array_agg(s.employment_type ORDER BY s.employment_type) AS employment_types
FROM segs s
LEFT JOIN qualitative_reviews r ON r.product_id = s.product_id AND r.employment_type = s.employment_type
WHERE r.criteria_hash IS DISTINCT FROM s.criteria_hash
GROUP BY s.product_id, s.product_name, s.qualitative_criteria_text, s.raw_criteria_text, s.criteria_hash
ORDER BY s.product_id
