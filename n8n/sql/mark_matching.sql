-- $1 = batch_id. Returns no row (and so stops the workflow) if the batch does not exist.
UPDATE batches SET status = 'matching' WHERE batch_id = $1::uuid
RETURNING batch_id, row_count, status
