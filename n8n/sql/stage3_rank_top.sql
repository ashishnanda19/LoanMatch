-- STAGE 3: rank each user's qualifying lenders and keep only the best few.
-- Most relevant = lowest interest rate; ties go to the lender the user clears by the widest
-- credit-score margin (more likely to be approved), then product_id for a stable order.
-- Lenders with no published rate sort last. Done with one window function in Postgres, so
-- no per-user work happens in n8n. The LLM plays no part in matching: its qualitative notes
-- are attached later, when the email is built.
-- ON CONFLICT makes replays harmless (matches has UNIQUE (user_id, product_id)).
-- $1 = batch_id, $2 = how many lenders to keep per user
WITH ranked AS (
    SELECT mc.user_id, mc.product_id, mc.credit_margin,
           row_number() OVER (
               PARTITION BY mc.user_id
               ORDER BY p.interest_rate ASC NULLS LAST, mc.credit_margin DESC NULLS LAST, mc.product_id
           ) AS rn
    FROM match_candidates mc
    JOIN loan_products p ON p.product_id = mc.product_id
    WHERE mc.batch_id = $1::uuid AND mc.exact_ok
), ins AS (
    INSERT INTO matches (user_id, product_id, match_method, match_rank, credit_margin)
    SELECT user_id, product_id, 'numeric', rn, credit_margin
    FROM ranked
    WHERE rn <= $2::int
    ON CONFLICT (user_id, product_id) DO UPDATE
        SET match_rank = EXCLUDED.match_rank, credit_margin = EXCLUDED.credit_margin
        WHERE matches.notified_at IS NULL
    RETURNING user_id
)
SELECT (SELECT count(*) FROM match_candidates WHERE batch_id = $1::uuid AND exact_ok) AS stage2_pairs,
       (SELECT count(DISTINCT user_id) FROM match_candidates WHERE batch_id = $1::uuid AND exact_ok) AS users_with_a_match,
       count(*)                  AS matches_written,
       count(DISTINCT user_id)   AS users_matched
FROM ins
