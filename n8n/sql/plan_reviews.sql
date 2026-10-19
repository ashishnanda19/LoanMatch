-- Which (product x employment type) segments need an LLM qualitative note? Run by the crawler
-- after products are saved, so uploads never wait on an LLM. criteria_hash covers the
-- qualitative text, the source text the model sees and a prompt-version tag ('rv4'):
-- unchanged crawl data returns ZERO rows => zero LLM calls.
SELECT p.product_id,
       p.product_name,
       t.employment_type,
       p.qualitative_criteria_text,
       md5('rv4|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, '')) AS criteria_hash,
       left(COALESCE(p.raw_criteria_text, ''), 1500)     AS source_text
FROM loan_products p
CROSS JOIN LATERAL unnest(COALESCE(p.allowed_employment_types, ARRAY['Salaried', 'Self-Employed', 'Business'])) AS t(employment_type)
LEFT JOIN qualitative_reviews r
       ON r.product_id = p.product_id AND r.employment_type = t.employment_type
WHERE p.last_crawled_at > now() - interval '7 days'
  AND p.qualitative_criteria_text IS NOT NULL
  AND r.criteria_hash IS DISTINCT FROM md5('rv4|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, ''))
ORDER BY p.product_id, t.employment_type
