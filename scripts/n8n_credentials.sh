#!/usr/bin/env bash
# Load credentials into the self-hosted n8n instance (they are encrypted at rest by n8n
# with N8N_ENCRYPTION_KEY). Secrets come from the environment / Terraform state and are
# never written into the repo; the temp file is deleted locally and on the host.
#
#   GROQ_API_KEY=... GEMINI_API_KEY=... ./scripts/n8n_credentials.sh
#
# Creates (fixed IDs so the exported workflow JSON can reference them):
#   credGroq000000001  "Groq API"      (HTTP header auth: Authorization: Bearer <key>)
#   credGemini0000001  "Gemini API"    (HTTP header auth: x-goog-api-key)
#   credPostgres00001  "Loan DB (RDS)" (Postgres)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GROQ_API_KEY:?set GROQ_API_KEY}"
: "${GEMINI_API_KEY:?set GEMINI_API_KEY}"

tf() { terraform -chdir=infra output -raw "$1"; }
IP="$(tf n8n_public_ip)"
KEY="loan-engine-n8n.pem"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

DB_HOST="$(tf db_host)" DB_NAME="$(tf db_name)" DB_USER="$(tf db_user)" DB_PASSWORD="$(tf db_password)" \
python3 -I - > "$TMP" <<'PY'
import json, os
e = os.environ
print(json.dumps([
  {"id": "credGroq000000001", "name": "Groq API", "type": "httpHeaderAuth",
   "data": {"name": "Authorization", "value": "Bearer " + e["GROQ_API_KEY"]}},
  {"id": "credGemini0000001", "name": "Gemini API", "type": "httpHeaderAuth",
   "data": {"name": "x-goog-api-key", "value": e["GEMINI_API_KEY"]}},
  {"id": "credPostgres00001", "name": "Loan DB (RDS)", "type": "postgres",
   "data": {"host": e["DB_HOST"], "port": 5432, "database": e["DB_NAME"],
            "user": e["DB_USER"], "password": e["DB_PASSWORD"],
            # RDS enforces TLS. n8n's Postgres credential cannot take a CA bundle, so we
            # encrypt but skip chain verification; traffic stays inside the VPC.
            "ssl": "require", "allowUnauthorizedCerts": True, "maxConnections": 10}},
]))
PY

SSH_OPTS=(-i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)
scp "${SSH_OPTS[@]}" "$TMP" "ec2-user@$IP:/tmp/n8n_creds.json"
ssh "${SSH_OPTS[@]}" "ec2-user@$IP" '
  sudo docker cp /tmp/n8n_creds.json n8n:/tmp/n8n_creds.json
  sudo docker exec n8n n8n import:credentials --input=/tmp/n8n_creds.json 2>&1 | grep -v "license SDK"
  sudo docker exec n8n rm -f /tmp/n8n_creds.json; shred -u /tmp/n8n_creds.json 2>/dev/null || rm -f /tmp/n8n_creds.json
'
echo "credentials imported."
