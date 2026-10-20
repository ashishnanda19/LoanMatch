-- Persist Stage 0's decision (which lender records are canonical, at which lowest published rate) so the web
-- API and match_user() use exactly the lenders and rates this batch was matched with.
-- $1 = JSON {product_id: effective_rate}
WITH incoming AS (
    SELECT key::bigint AS product_id, value::numeric AS rate FROM jsonb_each_text($1::jsonb)
), gone AS (
    DELETE FROM lender_offers WHERE product_id NOT IN (SELECT product_id FROM incoming)
), up AS (
    INSERT INTO lender_offers (product_id, effective_rate, updated_at)
    SELECT product_id, rate, now() FROM incoming
    ON CONFLICT (product_id) DO UPDATE SET effective_rate = EXCLUDED.effective_rate, updated_at = now()
    RETURNING 1
)
SELECT count(*) AS offers_saved FROM up
