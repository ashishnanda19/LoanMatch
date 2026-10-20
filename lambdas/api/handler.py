"""web-api Lambda: the read side of the web UI, behind the same HTTP API as get-upload-url.

    GET  /summary         latest batch, pipeline progress, funnel numbers, notes coverage      (access key)
    GET  /lenders         the canonical lenders matching used, with lowest published rates       (public)
    GET  /users?q=        find a person by name or id (no email is ever returned)                (access key)
    GET  /users/{id}      one person's profile, their stored top-5 offers and email status       (access key)
    POST /match           "what would I get?": top 5 lenders for an income/score/age/type        (public)

Public routes expose only lender data that is already public on the web. Everything that can reveal a person
needs the shared access key (x-api-key), compared in constant time; with no key configured those routes are
closed, never open. The Lambda runs in the VPC and reads RDS over TLS verified against AWS's CA bundle.
Ranking in POST /match is the SQL function match_user(), which mirrors the batch Stage 2 + Stage 3 SQL.
"""
import datetime
import decimal
import hmac
import json
import logging
import os
import re
import ssl
import uuid

import pg8000.native

logger = logging.getLogger()
logger.setLevel(logging.INFO)

EMPLOYMENT_TYPES = ("Salaried", "Self-Employed", "Business")
PUBLIC_ROUTES = {("GET", "/lenders"), ("POST", "/match")}
_conn = None


# ---------------------------------------------------------------------- db
def _connect():
    bundle = os.path.join(os.path.dirname(__file__), "rds-global-bundle.pem")
    return pg8000.native.Connection(
        user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")), database=os.environ["DB_NAME"],
        ssl_context=ssl.create_default_context(cafile=bundle), timeout=10)


def rows(sql, **params):
    """Run a query and return a list of dicts. Reconnects once if the warm connection went stale."""
    global _conn
    for attempt in (1, 2):
        try:
            if _conn is None:
                _conn = _connect()
            data = _conn.run(sql, **params)
            cols = [c["name"] for c in (_conn.columns or [])]
            return [dict(zip(cols, r)) for r in (data or [])]
        except (pg8000.exceptions.InterfaceError, OSError) as exc:
            logger.warning("db connection problem (%s), reconnecting", exc)
            _conn = None
            if attempt == 2:
                raise


# ---------------------------------------------------------------------- helpers
def _json_default(o):
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (datetime.datetime, datetime.date)):
        return o.isoformat()
    if isinstance(o, uuid.UUID):
        return str(o)
    raise TypeError(type(o))


def respond(status, body):
    # CORS headers are added by API Gateway.
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(body, default=_json_default)}


def authorized(headers):
    key = os.environ.get("API_KEY")
    supplied = (headers or {}).get("x-api-key", "")
    return bool(key) and hmac.compare_digest(supplied.encode(), key.encode())


def mask_alias(email):
    """a***+one@gmail.com : enough to recognise a test inbox, not enough to reuse the address."""
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    base, plus, tag = local.partition("+")
    return f"{base[:1]}***{plus}{tag}@{domain}"


def parse_match_input(payload):
    """Returns (income, score, age, type) or raises ValueError with a message for the user."""
    def num(name, lo, hi):
        try:
            v = int(payload.get(name))
        except (TypeError, ValueError):
            raise ValueError(f"{name} must be a whole number")
        if not lo <= v <= hi:
            raise ValueError(f"{name} must be between {lo} and {hi}")
        return v
    income = num("monthly_income", 0, 10_000_000)
    score = num("credit_score", 300, 900)
    age = num("age", 18, 100)
    etype = payload.get("employment_status")
    if etype not in EMPLOYMENT_TYPES:
        raise ValueError("employment_status must be one of: " + ", ".join(EMPLOYMENT_TYPES))
    return income, score, age, etype


def tidy_offer(r):
    r = dict(r)
    r["lender"] = re.sub(r"\s*personal loan\s*$", "", r.get("product_name") or "", flags=re.I).strip()
    return r


# ---------------------------------------------------------------------- routes
def summary():
    batches = rows("SELECT batch_id, status, row_count, skipped_rows, duplicate_rows, uploaded_at, matched_at, match_stats "
                   "FROM batches ORDER BY uploaded_at DESC LIMIT 5")
    latest = batches[0] if batches else None
    emails = 0
    if latest:
        emails = rows("SELECT count(*) AS n FROM matches m JOIN users u USING (user_id) "
                      "WHERE u.batch_id = CAST(:b AS uuid) AND m.notified_at IS NOT NULL", b=str(latest["batch_id"]))[0]["n"]
    totals = rows("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM matches) AS matches, "
                  "(SELECT count(*) FROM lender_offers) AS lenders, (SELECT max(last_crawled_at) FROM loan_products) AS last_crawl")[0]
    notes = rows("SELECT count(*) FILTER (WHERE r.criteria_hash = md5('rv5|' || COALESCE(p.raw_criteria_text, ''))) AS current, "
                 "count(*) AS total FROM qualitative_reviews r JOIN loan_products p USING (product_id)")[0]
    return respond(200, {"latest_batch": latest, "emails_sent_for_batch": emails, "recent_batches": batches,
                         "totals": totals, "notes": notes})


def lenders():
    data = rows("SELECT p.product_id, p.product_name, p.source_site, lo.effective_rate AS rate, p.allowed_employment_types AS types, "
                "p.min_income, p.min_credit_score, p.min_age, p.max_age, p.last_crawled_at "
                "FROM lender_offers lo JOIN loan_products p USING (product_id) "
                "ORDER BY lo.effective_rate NULLS LAST, p.product_name")
    return respond(200, {"lenders": [tidy_offer(r) for r in data]})


def find_users(query):
    q = (query or "").strip()
    if len(q) < 2:
        return respond(400, {"error": "type at least 2 characters"})
    if re.fullmatch(r"[0-9a-fA-F-]{36}", q):
        data = rows("SELECT user_id, name, employment_status, monthly_income, credit_score, age FROM users WHERE user_id = CAST(:q AS uuid)", q=q)
    else:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        data = rows("SELECT user_id, name, employment_status, monthly_income, credit_score, age FROM users WHERE name ILIKE :q "
                    "ORDER BY name, monthly_income LIMIT 12", q=like)
    return respond(200, {"users": data})


def user_detail(user_id):
    try:
        uid = str(uuid.UUID(user_id))
    except ValueError:
        return respond(400, {"error": "invalid user id"})
    u = rows("SELECT user_id, name, employment_status, monthly_income, credit_score, age FROM users WHERE user_id = CAST(:i AS uuid)", i=uid)
    if not u:
        return respond(404, {"error": "no such user"})
    offers = rows(
        "SELECT m.match_rank, p.product_name, m.interest_rate AS rate, m.score_floor_own, m.score_floor_any, m.score_flag, "
        "r.verdict, r.caveat, m.notified_at FROM matches m JOIN loan_products p USING (product_id) "
        "JOIN users x ON x.user_id = m.user_id "
        "LEFT JOIN qualitative_reviews r ON r.product_id = m.product_id AND r.employment_type = x.employment_status "
        "AND r.criteria_hash = md5('rv5|' || COALESCE(p.raw_criteria_text, '')) "
        "WHERE m.user_id = CAST(:i AS uuid) ORDER BY m.match_rank", i=uid)
    rec = rows("SELECT recipient_email FROM test_recipients WHERE user_id = CAST(:i AS uuid)", i=uid)
    return respond(200, {"user": u[0], "offers": [tidy_offer(o) for o in offers],
                         "test_inbox": mask_alias(rec[0]["recipient_email"]) if rec else None})


def match(payload):
    try:
        income, score, age, etype = parse_match_input(payload)
    except ValueError as exc:
        return respond(400, {"error": str(exc)})
    data = rows("SELECT match_rank, product_id, product_name, interest_rate AS rate, score_floor_own, score_floor_any, "
                "score_flag, verdict, caveat FROM match_user(:i, :s, :a, :t, 5)", i=income, s=score, a=age, t=etype)
    return respond(200, {"input": {"monthly_income": income, "credit_score": score, "age": age, "employment_status": etype},
                         "offers": [tidy_offer(r) for r in data]})


# ---------------------------------------------------------------------- handler
def lambda_handler(event, _context):
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", ""), (event.get("rawPath") or "/").rstrip("/") or "/"
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if (method, path) not in PUBLIC_ROUTES and not authorized(headers):
        return respond(401, {"error": "missing or wrong access key"})
    try:
        qs = event.get("queryStringParameters") or {}
        if (method, path) == ("GET", "/summary"):
            return summary()
        if (method, path) == ("GET", "/lenders"):
            return lenders()
        if (method, path) == ("GET", "/users"):
            return find_users(qs.get("q"))
        if method == "GET" and path.startswith("/users/"):
            return user_detail(path[len("/users/"):])
        if (method, path) == ("POST", "/match"):
            try:
                payload = json.loads(event.get("body") or "{}")
            except json.JSONDecodeError:
                return respond(400, {"error": "body must be JSON"})
            return match(payload if isinstance(payload, dict) else {})
        return respond(404, {"error": "not found"})
    except Exception:  # never leak internals to the browser
        logger.exception("request failed: %s %s", method, path)
        return respond(500, {"error": "something went wrong"})
