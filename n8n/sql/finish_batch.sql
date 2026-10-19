-- $1 = batch_id, $2 = funnel statistics JSON
UPDATE batches SET status = 'matched', matched_at = now(), match_stats = $2::jsonb
WHERE batch_id = $1::uuid
RETURNING batch_id, status, match_stats
