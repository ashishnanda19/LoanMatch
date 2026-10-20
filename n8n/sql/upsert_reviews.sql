-- Saves a whole batch of notes in one statement; returns exactly one row (saved = 0..n) so the
-- workflow continues even when nothing was valid.
-- $1 = JSON array of {product_id, employment_type, criteria_hash, verdict, caveat, provider}
WITH ins AS (
    INSERT INTO qualitative_reviews (product_id, employment_type, criteria_hash, verdict, caveat, provider)
    SELECT x.product_id, x.employment_type, x.criteria_hash, x.verdict, x.caveat, x.provider
    FROM jsonb_to_recordset($1::jsonb) AS x(product_id bigint, employment_type text, criteria_hash text,
                                            verdict text, caveat text, provider text)
    ON CONFLICT (product_id, employment_type) DO UPDATE SET
        criteria_hash = EXCLUDED.criteria_hash, verdict = EXCLUDED.verdict,
        caveat = EXCLUDED.caveat, provider = EXCLUDED.provider, reviewed_at = now()
    RETURNING 1
)
SELECT count(*) AS saved FROM ins
