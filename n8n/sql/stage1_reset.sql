-- Idempotent re-runs. Clears this batch's staging rows, and its matches that have NOT been
-- emailed yet, so a re-run reflects the latest verdicts (a pair that is no longer eligible
-- disappears). Matches already notified are history and are left alone.
-- $1 = batch_id
WITH gone AS (
    DELETE FROM matches m
    USING users u
    WHERE u.batch_id = $1::uuid AND m.user_id = u.user_id AND m.notified_at IS NULL
    RETURNING 1
)
DELETE FROM match_candidates WHERE batch_id = $1::uuid
