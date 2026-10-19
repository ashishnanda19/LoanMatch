#!/usr/bin/env bash
# Assemble deployable Lambda directories under build/ (source + pure-Python deps).
# Terraform zips these directories. Run before `terraform plan/apply`.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build && mkdir -p build/get_upload_url build/parse_csv

# get-upload-url: boto3 is provided by the Lambda runtime, no deps to bundle.
cp lambdas/get_upload_url/handler.py build/get_upload_url/

# parse-csv: pg8000 is pure Python, so the build is identical on macOS and Linux
# (no native wheels, no Docker needed).
cp lambdas/parse_csv/*.py lambdas/parse_csv/rds-global-bundle.pem build/parse_csv/
rm -f build/parse_csv/test_*.py
python3 -m pip install --quiet --no-compile --target build/parse_csv -r lambdas/parse_csv/requirements.txt

echo "Built:"; du -sh build/get_upload_url build/parse_csv
