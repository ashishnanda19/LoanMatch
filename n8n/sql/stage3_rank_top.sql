-- STAGE 3: rank each user's qualifying lenders and keep only the best few.
-- A match is FLAGGED when the lender states no credit-score minimum for the user's applicant type but
-- states a higher one for another type (Indian Bank: 700 salaried, nothing for self-employed) and the
-- user's score is below it. Silence is not proof of "no limit", so flagged matches rank behind clean
-- ones: unflagged first, then lowest interest rate (the lowest published across sources, from
-- Stage 0), then the widest credit-score margin, then product_id for a stable order. Lenders with no
-- published rate sort last. One window function in Postgres; no per-user work happens in n8n.
-- The LLM plays no part in matching: its qualitative notes are attached when the email is built.
-- ON CONFLICT makes replays harmless (matches has UNIQUE (user_id, product_id)).
-- $1 = batch_id, $2 = how many lenders to keep per user, $3 = JSON {product_id: effective rate}
WITH base AS (
    SELECT mc.user_id, mc.product_id, mc.credit_margin, mc.score_floor_own, mc.score_floor_any,
           (mc.score_floor_own IS NULL AND mc.score_floor_any IS NOT NULL
            AND mc.score_floor_any > u.credit_score) AS score_flag,
           COALESCE(($3::jsonb ->> mc.product_id::text)::numeric, p.interest_rate) AS rate
    FROM match_candidates mc
    JOIN users u         ON u.user_id = mc.user_id
    JOIN loan_products p ON p.product_id = mc.product_id
    WHERE mc.batch_id = $1::uuid AND mc.exact_ok
), ranked AS (
    SELECT base.*,
           row_number() OVER (
               PARTITION BY user_id
               ORDER BY score_flag ASC, rate ASC NULLS LAST, credit_margin DESC NULLS LAST, product_id
           ) AS rn
    FROM base
), ins AS (
    INSERT INTO matches (user_id, product_id, match_method, match_rank, credit_margin, interest_rate,
                         score_floor_own, score_floor_any, score_flag)
    SELECT user_id, product_id, 'numeric', rn, credit_margin, rate, score_floor_own, score_floor_any, score_flag
    FROM ranked
    WHERE rn <= $2::int
    ON CONFLICT (user_id, product_id) DO UPDATE
        SET match_rank = EXCLUDED.match_rank, credit_margin = EXCLUDED.credit_margin,
            interest_rate = EXCLUDED.interest_rate, score_floor_own = EXCLUDED.score_floor_own,
            score_floor_any = EXCLUDED.score_floor_any, score_flag = EXCLUDED.score_flag
        WHERE matches.notified_at IS NULL
    RETURNING user_id, score_flag
)
SELECT (SELECT count(*) FROM match_candidates WHERE batch_id = $1::uuid AND exact_ok) AS stage2_pairs,
       (SELECT count(DISTINCT user_id) FROM match_candidates WHERE batch_id = $1::uuid AND exact_ok) AS users_with_a_match,
       count(*)                  AS matches_written,
       count(DISTINCT user_id)   AS users_matched,
       count(*) FILTER (WHERE score_flag) AS matches_flagged_score
FROM ins
