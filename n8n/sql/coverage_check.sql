-- After the run: how many segments in scope have a CURRENT note, and how many are still missing
-- (a missing note never blocks an email - it just shows the generic line - but we want to know).
-- $1 = scope, $2 = batch_id or ''
WITH used AS (
    SELECT DISTINCT m.product_id, u.employment_status AS employment_type
    FROM matches m
    JOIN users u ON u.user_id = m.user_id
    WHERE $1 = 'used' AND u.batch_id = NULLIF($2, '')::uuid
), segs AS (
    SELECT p.product_id, p.product_name, p.qualitative_criteria_text, p.raw_criteria_text, t.employment_type,
           md5('rv5|' || COALESCE(p.raw_criteria_text, '')) AS criteria_hash
    FROM loan_products p
    CROSS JOIN LATERAL unnest(COALESCE(p.allowed_employment_types, ARRAY['Salaried', 'Self-Employed', 'Business'])) AS t(employment_type)
    WHERE p.last_crawled_at > now() - interval '7 days'
      AND p.qualitative_criteria_text IS NOT NULL
      AND ($1 <> 'used' OR EXISTS (SELECT 1 FROM used x WHERE x.product_id = p.product_id AND x.employment_type = t.employment_type))
)
SELECT count(*)                                                    AS segments_in_scope,
       count(*) FILTER (WHERE r.criteria_hash = s.criteria_hash)   AS with_current_note,
       count(*) FILTER (WHERE r.criteria_hash IS DISTINCT FROM s.criteria_hash) AS missing
FROM segs s
LEFT JOIN qualitative_reviews r ON r.product_id = s.product_id AND r.employment_type = s.employment_type
