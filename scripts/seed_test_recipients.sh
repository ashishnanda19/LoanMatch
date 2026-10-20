#!/usr/bin/env bash
# Map a few real user_ids to the test inboxes from terraform.tfvars. Only these users are ever
# emailed, and they are emailed at the test alias, never at the address in the CSV.
# Picks one user per employment type (stable: lowest user_id) so the emails show different
# matches. Also stores the SES sender address from terraform.tfvars. Safe to re-run.
#
#   ./scripts/seed_test_recipients.sh            # uses infra/terraform.tfvars
set -euo pipefail
cd "$(dirname "$0")/.."

SQL="$(python3 -I - <<'PY'
import re
t = open("infra/terraform.tfvars").read()
m = re.search(r"test_recipient_emails\s*=\s*\[(.*?)\]", t, re.S)
aliases = re.findall(r'"([^"]+)"', m.group(1))
sender = re.search(r'ses_sender_email\s*=\s*"([^"]+)"', t).group(1)
assert re.fullmatch(r"[^'\s]+@[^'\s]+", sender), sender
print(f"INSERT INTO app_settings (key, value) VALUES ('ses_sender_email', '{sender}') "
      f"ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;")
types = ["Salaried", "Self-Employed", "Business"]
for i, a in enumerate(aliases):
    assert re.fullmatch(r"[^'\s]+@[^'\s]+", a), a
    ty = types[i % 3]
    print(f"INSERT INTO test_recipients (user_id, recipient_email, label) "
          f"SELECT user_id, '{a}', '{ty} test user' FROM users WHERE employment_status = '{ty}' "
          f"ORDER BY user_id LIMIT 1 "
          f"ON CONFLICT (user_id) DO UPDATE SET recipient_email = EXCLUDED.recipient_email, label = EXCLUDED.label;")
PY
)"

DB_HOST="$(terraform -chdir=infra output -raw db_host)"
DB_NAME="$(terraform -chdir=infra output -raw db_name)"
DB_USER="$(terraform -chdir=infra output -raw db_user)"
export PGPASSWORD="$(terraform -chdir=infra output -raw db_password)"
{ echo "$SQL"; echo "SELECT t.recipient_email, t.label, u.name, u.employment_status FROM test_recipients t LEFT JOIN users u USING (user_id) ORDER BY 1;"; } |
  docker run --rm -i -e PGPASSWORD postgres:16-alpine psql "host=$DB_HOST dbname=$DB_NAME user=$DB_USER sslmode=require" -v ON_ERROR_STOP=1 -q
