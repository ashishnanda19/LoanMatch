"""Unit tests for the web API (no database needed: queries are replaced by a fake).

Run from lambdas/api/:  python3 -m unittest -v test_api
"""
import decimal
import json
import os
import unittest
from unittest import mock

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-south-1")
import handler  # noqa: E402


def event(method, path, headers=None, body=None, qs=None):
    return {"requestContext": {"http": {"method": method}}, "rawPath": path, "headers": headers or {},
            "body": json.dumps(body) if body is not None else None, "queryStringParameters": qs}


class AuthTests(unittest.TestCase):
    def test_private_routes_need_the_key_and_fail_closed(self):
        with mock.patch.dict(os.environ, {"API_KEY": "k3y"}):
            self.assertEqual(handler.lambda_handler(event("GET", "/summary"), None)["statusCode"], 401)
            self.assertEqual(handler.lambda_handler(event("GET", "/summary", {"x-api-key": "nope"}), None)["statusCode"], 401)
        with mock.patch.dict(os.environ, {"API_KEY": ""}):
            self.assertEqual(handler.lambda_handler(event("GET", "/users/x", {"x-api-key": ""}), None)["statusCode"], 401,
                             "no key configured must close the routes, not open them")

    def test_public_routes_need_no_key(self):
        with mock.patch.dict(os.environ, {"API_KEY": "k3y"}), mock.patch.object(handler, "rows", return_value=[]):
            self.assertEqual(handler.lambda_handler(event("GET", "/lenders"), None)["statusCode"], 200)

    def test_header_names_are_case_insensitive(self):
        with mock.patch.dict(os.environ, {"API_KEY": "k3y"}), mock.patch.object(handler, "rows", return_value=[]):
            r = handler.lambda_handler(event("GET", "/users", {"X-Api-Key": "k3y"}, qs={"q": "ab"}), None)
            self.assertEqual(r["statusCode"], 200)


class MatchInputTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(handler.parse_match_input({"monthly_income": "61000", "credit_score": 655, "age": 50, "employment_status": "Salaried"}),
                         (61000, 655, 50, "Salaried"))

    def test_rejects_bad_values_with_a_clear_message(self):
        good = {"monthly_income": 50000, "credit_score": 700, "age": 30, "employment_status": "Business"}
        for field, bad in [("monthly_income", -1), ("credit_score", 299), ("credit_score", 901), ("age", 17), ("age", "abc"),
                           ("employment_status", "Student"), ("monthly_income", None)]:
            with self.assertRaises(ValueError, msg=f"{field}={bad}"):
                handler.parse_match_input({**good, field: bad})

    def test_match_route_returns_400_not_500(self):
        r = handler.lambda_handler(event("POST", "/match", body={"credit_score": 1}), None)
        self.assertEqual(r["statusCode"], 400)
        self.assertIn("error", json.loads(r["body"]))


class MatchResponseShapeTests(unittest.TestCase):
    def test_offers_use_the_field_names_the_ui_reads(self):
        sql_seen = []
        row = {"match_rank": 1, "product_name": "Axis Bank Personal Loan", "rate": decimal.Decimal("8.75"), "score_floor_own": None,
               "score_floor_any": None, "score_flag": False, "verdict": "eligible", "caveat": None}
        with mock.patch.object(handler, "rows", side_effect=lambda sql, **p: sql_seen.append(sql) or [row]):
            r = handler.lambda_handler(event("POST", "/match", body={"monthly_income": 61000, "credit_score": 655, "age": 50,
                                                                    "employment_status": "Salaried"}), None)
        offer = json.loads(r["body"])["offers"][0]
        self.assertEqual((offer["lender"], offer["rate"], offer["match_rank"]), ("Axis Bank", 8.75, 1))
        self.assertIn("interest_rate AS rate", sql_seen[0], "the SQL must alias the rate to the name the UI reads")


class PrivacyAndShapeTests(unittest.TestCase):
    def test_alias_masking_hides_the_address(self):
        self.assertEqual(handler.mask_alias("jane.doe+one@example.com"), "j***+one@example.com")
        self.assertEqual(handler.mask_alias("plain@example.com"), "p***@example.com")
        self.assertIsNone(handler.mask_alias(None))

    def test_user_detail_never_selects_email(self):
        seen = []
        with mock.patch.dict(os.environ, {"API_KEY": "k"}), mock.patch.object(handler, "rows", side_effect=lambda sql, **p: seen.append(sql) or []):
            handler.lambda_handler(event("GET", "/users/00000000-0000-0000-0000-000000000001", {"x-api-key": "k"}), None)
            handler.lambda_handler(event("GET", "/users", {"x-api-key": "k"}, qs={"q": "sa"}), None)
        self.assertTrue(seen)
        self.assertFalse(any("email" in s.replace("recipient_email", "") for s in seen),
                         "the CSV email column must never be queried by the API")

    def test_user_id_must_be_a_uuid_and_search_needs_two_chars(self):
        with mock.patch.dict(os.environ, {"API_KEY": "k"}):
            self.assertEqual(handler.lambda_handler(event("GET", "/users/not-a-uuid", {"x-api-key": "k"}), None)["statusCode"], 400)
            self.assertEqual(handler.lambda_handler(event("GET", "/users", {"x-api-key": "k"}, qs={"q": "a"}), None)["statusCode"], 400)

    def test_lender_name_is_tidied_and_decimals_serialise(self):
        row = {"product_name": "Axis Bank Personal Loan", "rate": decimal.Decimal("8.75")}
        with mock.patch.object(handler, "rows", return_value=[row]):
            body = json.loads(handler.lenders()["body"])
        self.assertEqual(body["lenders"][0]["lender"], "Axis Bank")
        self.assertEqual(body["lenders"][0]["rate"], 8.75)

    def test_unknown_route_and_internal_errors_do_not_leak(self):
        with mock.patch.dict(os.environ, {"API_KEY": "k"}):
            self.assertEqual(handler.lambda_handler(event("GET", "/nope", {"x-api-key": "k"}), None)["statusCode"], 404)
        with mock.patch.dict(os.environ, {"API_KEY": "k"}), mock.patch.object(handler, "rows", side_effect=RuntimeError("secret db detail")):
            r = handler.lambda_handler(event("GET", "/summary", {"x-api-key": "k"}), None)
        self.assertEqual(r["statusCode"], 500)
        self.assertNotIn("secret db detail", r["body"])


if __name__ == "__main__":
    unittest.main()
