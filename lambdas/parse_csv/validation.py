"""Row validation for the users CSV.

Pure functions with no AWS/DB imports so they can be unit-tested in isolation.
The rules deliberately mirror the CHECK constraints in db/migrations/001_init.sql:
a row that would violate a constraint is skipped here (and counted) instead of
failing the whole batch insert.
"""
import uuid
from typing import Optional

REQUIRED_COLUMNS = (
    "user_id",
    "name",
    "email",
    "monthly_income",
    "credit_score",
    "employment_status",
    "age",
)
EMPLOYMENT_TYPES = {"Salaried", "Self-Employed", "Business"}


class RowError(ValueError):
    """Raised with a short human-readable reason when a row is invalid."""


def _int(value: str, field: str) -> int:
    try:
        return int(value.strip())
    except (ValueError, AttributeError):
        raise RowError(f"{field} is not an integer: {value!r}")


def validate_row(row: dict) -> tuple:
    """Return a clean tuple (user_id, name, email, income, score, status, age).

    Raises RowError if the row is invalid.
    """
    try:
        user_id = str(uuid.UUID((row.get("user_id") or "").strip()))
    except ValueError:
        raise RowError(f"user_id is not a UUID: {row.get('user_id')!r}")

    name = (row.get("name") or "").strip()
    if not name:
        raise RowError("name is empty")

    email = (row.get("email") or "").strip()
    if "@" not in email:
        raise RowError(f"email looks invalid: {email!r}")

    income = _int(row.get("monthly_income"), "monthly_income")
    if income < 0:
        raise RowError("monthly_income is negative")

    score = _int(row.get("credit_score"), "credit_score")
    if not 300 <= score <= 900:
        raise RowError(f"credit_score out of range: {score}")

    status = (row.get("employment_status") or "").strip()
    if status not in EMPLOYMENT_TYPES:
        raise RowError(f"employment_status not recognised: {status!r}")

    age = _int(row.get("age"), "age")
    if not 18 <= age <= 100:
        raise RowError(f"age out of range: {age}")

    return (user_id, name, email, income, score, status, age)


def check_header(fieldnames: Optional[list]) -> None:
    """Fail fast (whole file) if required columns are missing."""
    missing = [c for c in REQUIRED_COLUMNS if c not in (fieldnames or [])]
    if missing:
        raise RowError(f"CSV is missing required columns: {', '.join(missing)}")
