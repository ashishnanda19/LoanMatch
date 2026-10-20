-- Workflow C input: ONE row per user with all of their un-notified matches, best first.
-- Grouping by user_id (not email: emails repeat across users) means each person gets exactly
-- one email. The recipient comes from test_recipients only; users.email is never selected, so
-- real CSV addresses cannot be mailed. Users without a test_recipients row are skipped.
-- The qualitative caveat is attached only when it was written for the CURRENT page text (same key as R).
-- $1 = batch_id, or '' for every pending match
SELECT u.user_id,
       u.name,
       u.credit_score,
       tr.recipient_email,
       (SELECT value FROM app_settings WHERE key = 'ses_sender_email') AS sender_email,
       jsonb_agg(jsonb_build_object(
           'match_id', m.match_id,
           'rank',     m.match_rank,
           'product',  p.product_name,
           'rate',     COALESCE(m.interest_rate, p.interest_rate),
           'floor_own', m.score_floor_own,
           'floor_any', m.score_floor_any,
           'score_flag', m.score_flag,
           'verdict',  r.verdict,
           'caveat',   r.caveat
       ) ORDER BY m.match_rank, m.match_id) AS products
FROM matches m
JOIN users u            ON u.user_id = m.user_id
JOIN test_recipients tr ON tr.user_id = m.user_id
JOIN loan_products p    ON p.product_id = m.product_id
LEFT JOIN qualitative_reviews r
       ON r.product_id = m.product_id
      AND r.employment_type = u.employment_status
      AND r.criteria_hash = md5('rv5|' || COALESCE(p.raw_criteria_text, ''))
WHERE m.notified_at IS NULL
  AND (NULLIF($1, '') IS NULL OR u.batch_id = NULLIF($1, '')::uuid)
GROUP BY u.user_id, u.name, u.credit_score, tr.recipient_email
ORDER BY u.user_id
