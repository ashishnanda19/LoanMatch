-- Safety rail for Workflow C: the ONLY addresses it can ever email.
-- The notification query INNER JOINs this table and takes the recipient from here, never from
-- users.email, so a CSV address cannot receive mail even if a query is edited carelessly.
-- user_id is deliberately not a foreign key: the mapping must survive re-loading a CSV.
BEGIN;
CREATE TABLE IF NOT EXISTS test_recipients (
    user_id          UUID PRIMARY KEY,
    recipient_email  TEXT NOT NULL,
    label            TEXT
);

-- Small key/value config read by workflows (keeps the sender address out of the repo).
CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
COMMIT;
