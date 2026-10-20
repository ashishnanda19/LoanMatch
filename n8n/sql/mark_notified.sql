-- Run only after SES accepted the email. Re-running Workflow C then finds nothing to send.
-- $1 = JSON array of match_ids that were in the email
UPDATE matches SET notified_at = now()
WHERE match_id IN (SELECT jsonb_array_elements_text($1::jsonb)::bigint)
  AND notified_at IS NULL
RETURNING match_id, user_id
