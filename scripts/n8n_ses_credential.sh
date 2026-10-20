#!/usr/bin/env bash
# Load the send-only SES IAM user's access key into n8n as the "AWS SES (send-only)" credential
# (fixed id credAwsSes0000001, referenced by Workflow C). The key comes from Terraform state,
# is encrypted by n8n at rest and is never written into the repo.
#
#   ./scripts/n8n_ses_credential.sh
set -euo pipefail
cd "$(dirname "$0")/.."

tf() { terraform -chdir=infra output -raw "$1"; }
IP="$(tf n8n_public_ip)"
KEY="loan-engine-n8n.pem"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

AWS_REGION_NAME="$(grep -E '^\s*aws_region' infra/terraform.tfvars | sed -E 's/.*"([^"]+)".*/\1/')"
SES_KEY_ID="$(tf ses_access_key_id)" SES_SECRET="$(tf ses_secret_access_key)" SES_REGION="${AWS_REGION_NAME:-ap-south-1}" \
python3 -I - > "$TMP" <<'PY'
import json, os
e = os.environ
print(json.dumps([{"id": "credAwsSes0000001", "name": "AWS SES (send-only)", "type": "aws",
                   "data": {"region": e["SES_REGION"], "accessKeyId": e["SES_KEY_ID"],
                            "secretAccessKey": e["SES_SECRET"], "temporaryCredentials": False}}]))
PY

SSH_OPTS=(-i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)
scp "${SSH_OPTS[@]}" "$TMP" "ec2-user@$IP:/tmp/n8n_ses_cred.json"
ssh "${SSH_OPTS[@]}" "ec2-user@$IP" '
  sudo docker cp /tmp/n8n_ses_cred.json n8n:/tmp/n8n_ses_cred.json
  sudo docker exec n8n n8n import:credentials --input=/tmp/n8n_ses_cred.json 2>&1 | grep -v "license SDK"
  sudo docker exec n8n rm -f /tmp/n8n_ses_cred.json; shred -u /tmp/n8n_ses_cred.json 2>/dev/null || rm -f /tmp/n8n_ses_cred.json
'
echo "SES credential imported."
