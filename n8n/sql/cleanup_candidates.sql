-- Staging rows are only needed while the batch is being matched.
-- $1 = batch_id
DELETE FROM match_candidates WHERE batch_id = $1::uuid
