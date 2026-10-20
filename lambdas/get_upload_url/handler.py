"""get-upload-url Lambda.

Returns a presigned S3 POST so the browser uploads the CSV *directly to S3*.
The file never passes through API Gateway / Lambda, so API Gateway's 10 MB payload
limit and the Lambda timeout do not apply to the upload itself.

The batch_id is generated here and embedded in the object key
(uploads/<batch_id>/<filename>). The parse-csv Lambda recovers it from the key,
which means this function needs no database access (and no VPC).
"""
import hmac
import json
import os
import re
import uuid

import boto3
from botocore.config import Config

BUCKET = os.environ["UPLOAD_BUCKET"]
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
EXPIRES_SECONDS = 900

# Regional endpoint + SigV4: avoids the global-endpoint redirect that breaks
# browser POSTs to freshly-created buckets.
_s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION"),
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)


def _response(status: int, body: dict) -> dict:
    # CORS headers are added by API Gateway; this only sets the content type.
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _safe_filename(name: str) -> str:
    """Keep the key predictable: no path separators or odd characters."""
    name = os.path.basename(name or "")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name[:100]


def _authorized(event):
    """Uploads start the whole pipeline, so when an access key is configured the caller must send it."""
    key = os.environ.get("API_KEY")
    if not key:
        return True   # local / test use without a key
    supplied = {k.lower(): v for k, v in (event.get("headers") or {}).items()}.get("x-api-key", "")
    return hmac.compare_digest(supplied.encode(), key.encode())


def lambda_handler(event, _context):
    if not _authorized(event):
        return _response(401, {"error": "missing or wrong access key"})
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be JSON"})

    filename = _safe_filename(payload.get("filename", ""))
    if not filename.lower().endswith(".csv"):
        return _response(400, {"error": "filename must end with .csv"})

    batch_id = str(uuid.uuid4())
    key = f"uploads/{batch_id}/{filename}"

    # Conditions are enforced by S3: wrong size or key => the POST is rejected.
    post = _s3.generate_presigned_post(
        Bucket=BUCKET,
        Key=key,
        Fields={"Content-Type": "text/csv"},
        Conditions=[
            {"Content-Type": "text/csv"},
            ["content-length-range", 1, MAX_BYTES],
        ],
        ExpiresIn=EXPIRES_SECONDS,
    )

    return _response(
        200,
        {
            "batch_id": batch_id,
            "key": key,
            "upload_url": post["url"],
            "fields": post["fields"],
            "max_bytes": MAX_BYTES,
            "expires_in": EXPIRES_SECONDS,
        },
    )
