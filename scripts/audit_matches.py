#!/usr/bin/env python3
"""Independent audit of the stored matches.

Re-derives every user's top 5 from scratch, in plain Python, from the lender rules and rates in the database and
compares it with the `matches` table. It shares no SQL with the pipeline, so a bug in Stage 1-3 cannot hide here.
Also checks that nobody is matched to a lender that does not accept their employment type.

    ./scripts/audit_matches.py          (needs Docker for psql, plus Node for the Stage 0 reconcile step)
"""
import collections
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def tf(name):
    return subprocess.check_output(["terraform", "-chdir=infra", "output", "-raw", name], cwd=ROOT, text=True).strip()


def query(sql):
    env = {"PGPASSWORD": tf("db_password"), "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"}
    conn = f"host={tf('db_host')} dbname={tf('db_name')} user={tf('db_user')} sslmode=require"
    out = subprocess.check_output(["docker", "run", "--rm", "-e", "PGPASSWORD", "postgres:16-alpine", "psql", conn, "-At", "-F", "\t", "-c", sql],
                                  cwd=ROOT, text=True, env=env)
    return [line.split("\t") for line in out.splitlines()]


def canonical_lenders():
    """Stage 0 (one record per bank, lowest published rate) using the same JS that runs inside n8n."""
    rows = query("select row_to_json(p) from (select product_id, source_site, product_name, interest_rate, min_income, min_credit_score, "
                 "min_age, max_age, allowed_employment_types, eligibility_rules from loan_products where last_crawled_at > now() - interval '7 days') p")
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "p.jsonl").write_text("\n".join(r[0] for r in rows))
        js = ("const fs=require('fs');const src=fs.readFileSync('n8n/code/reconcile_products.js','utf8');"
              f"const rows=fs.readFileSync('{d}/p.jsonl','utf8').trim().split('\\n').map(l=>({{json:JSON.parse(l)}}));"
              "const out=new Function('$input','console',src)({all:()=>rows},{log(){}}).map(r=>r.json);"
              "console.log(JSON.stringify(out.map(o=>({id:o.product_id,name:o.product_name,rate:o.effective_rate,rules:o.eligibility_rules}))))")
        return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT, text=True))


def evaluate(rules, etype, income, score, age):
    ok, margin, floors, own_unstated = False, None, [], False
    for r in rules:
        if (etype in r["employment_types"] and income >= (r["min_income"] or 0) and score >= (r["min_credit_score"] or 0)
                and (r["min_age"] or 0) <= age <= (r["max_age"] if r["max_age"] is not None else 200)):
            ok = True
            if r["min_credit_score"] is None:
                own_unstated = True
            else:
                floors.append(r["min_credit_score"])
                margin = max(margin if margin is not None else -10**9, score - r["min_credit_score"])
    any_floor = [r["min_credit_score"] for r in rules if r["min_credit_score"] is not None]
    own = None if (own_unstated or not floors) else min(floors)
    return ok, margin, own, (max(any_floor) if any_floor else None)


def main():
    lenders = canonical_lenders()
    users = query("select user_id, employment_status, monthly_income, credit_score, age from users")
    stored = collections.defaultdict(dict)
    for uid, rank, pid in query("select user_id, match_rank, product_id from matches"):
        stored[uid][int(rank)] = int(pid)
    accepts = {l["id"]: {t for r in l["rules"] for t in r["employment_types"]} for l in lenders}
    mismatches = wrong_type = 0
    for uid, etype, inc, scr, age in users:
        inc, scr, age = int(inc), int(scr), int(age)
        cand = []
        for l in lenders:
            ok, margin, own, anyf = evaluate(l["rules"], etype, inc, scr, age)
            if ok:
                flagged = own is None and anyf is not None and anyf > scr
                cand.append((flagged, l["rate"] if l["rate"] is not None else 1e9, -(margin if margin is not None else -10**9), l["id"]))
        cand.sort()
        if [stored[uid].get(i) for i in range(1, 6)] != [c[3] for c in cand[:5]]:
            mismatches += 1
        wrong_type += sum(1 for p in stored[uid].values() if etype not in accepts[p])
    print(f"users audited: {len(users)}")
    print(f"top-5 list or order differs from the independent recompute: {mismatches}")
    print(f"matches to a lender that does not accept the user's employment type: {wrong_type}")
    sys.exit(1 if mismatches or wrong_type else 0)


if __name__ == "__main__":
    main()
