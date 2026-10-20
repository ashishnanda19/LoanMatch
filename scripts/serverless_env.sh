#!/usr/bin/env bash
# Prints `export TF_...=...` lines for infra/serverless.yml, read from Terraform's outputs, so the
# Serverless Framework deploys on top of the resources Terraform already created.
#
#   eval "$(./scripts/serverless_env.sh)"
#
# It prints secrets (DB password, API key, webhook secret) to the shell that evals it, never to a file.
set -euo pipefail
cd "$(dirname "$0")/.."
tf() { terraform -chdir=infra output -raw "$1"; }
tfj() { terraform -chdir=infra output -json "$1"; }

echo "export TF_UPLOAD_BUCKET='$(tf upload_bucket)'"
echo "export TF_DB_HOST='$(tf db_host)'"
echo "export TF_DB_NAME='$(tf db_name)'"
echo "export TF_DB_USER='$(tf db_user)'"
echo "export TF_DB_PASSWORD='$(tf db_password)'"
echo "export TF_N8N_WEBHOOK_URL='$(tf n8n_webhook_url_for_lambda)'"
echo "export TF_WEBHOOK_SECRET='$(tf webhook_secret)'"
echo "export TF_API_KEY='$(tf api_key)'"
echo "export TF_LAMBDA_SG_ID='$(tf lambda_security_group_id)'"
echo "export TF_SUBNET_IDS='$(tfj lambda_subnet_ids | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)))')'"
echo "export TF_GET_UPLOAD_URL_ROLE_ARN='$(tfj lambda_role_arns | python3 -c 'import json,sys; print(json.load(sys.stdin)["get_upload_url"])')'"
echo "export TF_PARSE_CSV_ROLE_ARN='$(tfj lambda_role_arns | python3 -c 'import json,sys; print(json.load(sys.stdin)["parse_csv"])')'"
echo "export TF_API_ROLE_ARN='$(tfj lambda_role_arns | python3 -c 'import json,sys; print(json.load(sys.stdin)["api"])')'"
