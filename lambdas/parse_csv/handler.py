"""parse-csv Lambda.

Triggered by S3 ObjectCreated on uploads/<batch_id>/<file>.csv.

Flow:
  1. Register the batch (status=processing).
  2. Stream the CSV from S3 (never load it whole), validate each row, and bulk
     insert in chunks with ON CONFLICT (user_id) DO NOTHING.
  3. Record final counts + status on the batch.
  4. POST {batch_id, row_count} to the n8n webhook (Workflow B).

Idempotency: S3 invokes Lambda asynchronously and may retry or deliver an event
twice. Every step is safe to repeat: the batch row is upserted, inserts skip
existing user_ids, and the final counts are *recomputed from the table* rather
than accumulated, so a re-run yields the same numbers.
"""
import codecs
import csv
import json
import logging
import os
import ssl
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import unquote_plus

import boto3
import pg8000.native

from validation import RowError, check_header, validate_row

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CHUNK_SIZE = 1000          # rows per INSERT; keeps each statement small and fast
MAX_LOGGED_BAD_ROWS = 20   # avoid flooding CloudWatch on a badly broken file
WEBHOOK_ATTEMPTS = 3

_s3 = boto3.client("s3")

_INSERT_SQL = """
    INSERT INTO users (user_id, name, email, monthly_income, credit_score,
                       employment_status, age, batch_id)
    SELECT t.u, t.n, t.e, t.i, t.c, t.s, t.a, CAST(:batch_id AS uuid)
    FROM unnest(
        CAST(:ids AS uuid[]), CAST(:names AS text[]), CAST(:emails AS text[]),
        CAST(:incomes AS integer[]), CAST(:scores AS integer[]),
        CAST(:statuses AS text[]), CAST(:ages AS integer[])
    ) AS t(u, n, e, i, c, s, a)
    ON CONFLICT (user_id) DO NOTHING
"""


# --------------------------------------------------------------------------- db
def connect() -> pg8000.native.Connection:
    """Open a TLS connection to RDS, verifying the server cert against AWS's CA bundle."""
    ssl_context = None
    if os.environ.get("DB_SSL", "true").lower() != "false":
        bundle = os.path.join(os.path.dirname(__file__), "rds-global-bundle.pem")
        ssl_context = ssl.create_default_context(cafile=bundle)
    return pg8000.native.Connection(
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        database=os.environ["DB_NAME"],
        ssl_context=ssl_context,
        timeout=30,
    )


def _flush(conn, batch_id: str, chunk: list) -> None:
    """Insert one chunk of validated rows as a single statement."""
    ids, names, emails, incomes, scores, statuses, ages = (list(col) for col in zip(*chunk))
    conn.run(
        _INSERT_SQL,
        batch_id=batch_id, ids=ids, names=names, emails=emails,
        incomes=incomes, scores=scores, statuses=statuses, ages=ages,
    )


def process_csv(conn, batch_id: str, s3_key: str, stream) -> dict:
    """Validate + load a CSV stream into `users`. Returns the final counts.

    `stream` is any file-like object yielding bytes-decoded text lines.
    """
    conn.run(
        """INSERT INTO batches (batch_id, s3_key, status) VALUES (CAST(:b AS uuid), :k, 'processing')
           ON CONFLICT (batch_id) DO UPDATE SET status = 'processing', s3_key = EXCLUDED.s3_key""",
        b=batch_id, k=s3_key,
    )

    reader = csv.DictReader(stream)
    check_header(reader.fieldnames)  # RowError here => whole file rejected

    valid = skipped = 0
    chunk: list = []
    for row in reader:
        try:
            chunk.append(validate_row(row))
        except RowError as exc:
            skipped += 1
            if skipped <= MAX_LOGGED_BAD_ROWS:
                logger.warning("skipping line %d: %s", reader.line_num, exc)
            continue
        valid += 1
        if len(chunk) >= CHUNK_SIZE:
            _flush(conn, batch_id, chunk)
            chunk = []
    if chunk:
        _flush(conn, batch_id, chunk)

    # Recompute from the table so retries report identical numbers (see module docstring).
    row_count = conn.run(
        "SELECT count(*) FROM users WHERE batch_id = CAST(:b AS uuid)", b=batch_id
    )[0][0]
    duplicates = max(valid - row_count, 0)
    conn.run(
        """UPDATE batches SET row_count = :rc, skipped_rows = :sk, duplicate_rows = :dp,
                              status = 'processed' WHERE batch_id = CAST(:b AS uuid)""",
        rc=row_count, sk=skipped, dp=duplicates, b=batch_id,
    )
    logger.info("batch %s: %d rows loaded, %d skipped (invalid), %d duplicates",
                batch_id, row_count, skipped, duplicates)
    return {"row_count": row_count, "skipped": skipped, "duplicates": duplicates}


# ---------------------------------------------------------------------- webhook
def notify_n8n(batch_id: str, row_count: int) -> bool:
    """POST to the n8n Workflow B webhook with retries. Returns True on a 2xx."""
    url = os.environ.get("N8N_WEBHOOK_URL")
    if not url:
        logger.error("N8N_WEBHOOK_URL not set; cannot notify n8n")
        return False
    body = json.dumps({"batch_id": batch_id, "row_count": row_count}).encode()
    for attempt in range(1, WEBHOOK_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if 200 <= resp.status < 300:
                    logger.info("n8n webhook accepted batch %s (HTTP %d)", batch_id, resp.status)
                    return True
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            logger.warning("webhook attempt %d/%d failed: %s", attempt, WEBHOOK_ATTEMPTS, exc)
        time.sleep(2 ** (attempt - 1))
    return False


# ---------------------------------------------------------------------- handler
def _batch_id_from_key(key: str):
    """uploads/<batch_id>/<file>.csv -> batch_id, or None if the key doesn't match."""
    parts = key.split("/")
    if len(parts) == 3 and parts[0] == "uploads":
        try:
            return str(uuid.UUID(parts[1]))
        except ValueError:
            return None
    return None


def lambda_handler(event, _context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        batch_id = _batch_id_from_key(key)
        if not batch_id:
            logger.error("ignoring object with unexpected key: %s", key)
            continue

        conn = connect()
        try:
            body = _s3.get_object(Bucket=bucket, Key=key)["Body"]
            stream = codecs.getreader("utf-8-sig")(body)  # streams; strips any BOM
            try:
                result = process_csv(conn, batch_id, key, stream)
            except RowError as exc:
                # Permanent problem with the file itself: record it, don't retry.
                logger.error("batch %s rejected: %s", batch_id, exc)
                conn.run("UPDATE batches SET status = 'failed' WHERE batch_id = CAST(:b AS uuid)",
                         b=batch_id)
                continue
            except Exception:
                # Possibly transient (DB/S3). Mark failed, then re-raise so the
                # async invocation retries; the retry is safe because it's idempotent.
                conn.run("UPDATE batches SET status = 'failed' WHERE batch_id = CAST(:b AS uuid)",
                         b=batch_id)
                raise

            if not notify_n8n(batch_id, result["row_count"]):
                logger.error("batch %s loaded but n8n was not notified", batch_id)
                conn.run("UPDATE batches SET status = 'webhook_failed' WHERE batch_id = CAST(:b AS uuid)",
                         b=batch_id)
        finally:
            conn.close()
    return {"ok": True}
