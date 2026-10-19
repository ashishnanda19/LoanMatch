-- Always returns exactly one row per input item (saved = 0 or 1), so the workflow continues
-- even when every LLM call failed. $1 = JSON {product_id, employment_type, criteria_hash,
-- verdict, caveat, provider, valid}
WITH ins AS (
    INSERT INTO qualitative_reviews (product_id, employment_type, criteria_hash, verdict, caveat, provider)
    SELECT (r->>'product_id')::bigint, r->>'employment_type', r->>'criteria_hash',
           r->>'verdict', r->>'caveat', r->>'provider'
    FROM (SELECT $1::jsonb AS r) x
    WHERE (r->>'valid')::boolean
    ON CONFLICT (product_id, employment_type) DO UPDATE SET
        criteria_hash = EXCLUDED.criteria_hash, verdict = EXCLUDED.verdict,
        caveat = EXCLUDED.caveat, provider = EXCLUDED.provider, reviewed_at = now()
    RETURNING 1
)
SELECT (SELECT count(*) FROM ins) AS saved
