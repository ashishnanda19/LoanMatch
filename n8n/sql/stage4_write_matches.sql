-- STAGE 4: persist matches. A pair is a match if it passed the exact rules and the LLM did
-- not rule its segment out. A missing review (both LLMs failed) is treated as 'conditional':
-- the numeric rules already passed, so we keep the match rather than silently dropping it.
-- match_method records HOW it was decided: 'llm' only when a qualitative review applied.
-- ON CONFLICT makes replays harmless (matches has UNIQUE (user_id, product_id)).
-- $1 = batch_id
WITH ins AS (
    INSERT INTO matches (user_id, product_id, match_method)
    SELECT mc.user_id, mc.product_id,
           CASE WHEN r.verdict IS NOT NULL THEN 'llm' ELSE 'numeric' END
    FROM match_candidates mc
    JOIN users u         ON u.user_id = mc.user_id
    JOIN loan_products p ON p.product_id = mc.product_id
    LEFT JOIN qualitative_reviews r
           ON r.product_id = mc.product_id
          AND r.employment_type = u.employment_status
          AND r.criteria_hash = md5('rv3|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, ''))
    WHERE mc.batch_id = $1::uuid
      AND mc.exact_ok
      AND COALESCE(r.verdict, 'conditional') <> 'ineligible'
    ON CONFLICT (user_id, product_id) DO NOTHING
    RETURNING 1
)
SELECT (SELECT count(*) FROM match_candidates WHERE batch_id = $1::uuid AND exact_ok) AS stage2_pairs,
       count(*)                                                                        AS matches_written,
       (SELECT count(*)
          FROM match_candidates mc
          JOIN users u ON u.user_id = mc.user_id
          JOIN loan_products p ON p.product_id = mc.product_id
          JOIN qualitative_reviews r ON r.product_id = mc.product_id
                                    AND r.employment_type = u.employment_status
                                    AND r.criteria_hash = md5('rv3|' || p.qualitative_criteria_text || E'\n' || COALESCE(p.raw_criteria_text, ''))
         WHERE mc.batch_id = $1::uuid AND mc.exact_ok AND r.verdict = 'ineligible')      AS dropped_by_llm,
       (SELECT count(*)
          FROM (SELECT DISTINCT mc.product_id, u.employment_status
                  FROM match_candidates mc
                  JOIN users u ON u.user_id = mc.user_id
                  JOIN loan_products p ON p.product_id = mc.product_id
                 WHERE mc.batch_id = $1::uuid AND mc.exact_ok
                   AND p.qualitative_criteria_text IS NOT NULL) seg)                     AS segments_total
FROM ins
