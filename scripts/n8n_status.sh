#!/usr/bin/env bash
# Live view of n8n workflow runs from the terminal: which workflow, status and how long it took.
# The same information is in the editor under each workflow's "Executions" tab.
#
#   ./scripts/n8n_status.sh              # latest 12 runs, refreshed every 5 s (Ctrl-C to stop)
#   ONCE=1 ./scripts/n8n_status.sh       # print once and exit
set -euo pipefail
cd "$(dirname "$0")/.."

IP="$(terraform -chdir=infra output -raw n8n_public_ip)"
KEY="loan-engine-n8n.pem"
QUERY="SELECT e.id, substr(coalesce(w.name, e.workflowId),1,40), e.status, substr(e.startedAt,12,8),
       CASE WHEN e.stoppedAt IS NULL THEN 'running...' ELSE
            printf('%.1fs', (julianday(e.stoppedAt)-julianday(e.startedAt))*86400) END
       FROM execution_entity e LEFT JOIN workflow_entity w ON w.id = e.workflowId
       ORDER BY e.id DESC LIMIT 12;"

show() {
  # the query goes in on stdin, so no shell quoting is needed on the remote side
  printf '%s\n' "$QUERY" | ssh -i "$KEY" -o LogLevel=ERROR -o ConnectTimeout=10 "ec2-user@$IP" \
    "sudo docker run --rm -i -v n8n_n8n_data:/data alpine sh -c 'apk add -q sqlite >/dev/null 2>&1; sqlite3 -separator \"|\" /data/database.sqlite'" |
    awk -F'|' 'BEGIN{printf "%-5s %-41s %-9s %-9s %s\n","ID","WORKFLOW","STATUS","STARTED","TOOK"} {printf "%-5s %-41s %-9s %-9s %s\n",$1,$2,$3,$4,$5}'
}

if [ "${ONCE:-0}" = "1" ]; then show; exit 0; fi
while true; do clear; date '+%H:%M:%S  (UTC times below)  n8n: http://'"$IP"':5678'; echo; show; sleep 5; done
