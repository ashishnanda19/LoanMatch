"""Integration tests for the CSV loader.

Needs a Postgres with db/migrations/001_init.sql applied. Point at it with
TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME
(defaults match: docker run -p 55432:5432 -e POSTGRES_PASSWORD=x postgres:16-alpine).

Run from lambdas/parse_csv/:  python3 -m unittest -v test_parse_csv
"""
import io
import os
import unittest
import uuid

import pg8000.native

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-south-1")
import handler  # noqa: E402
from validation import RowError, check_header, validate_row  # noqa: E402

HEADER = "user_id,name,email,monthly_income,credit_score,employment_status,age\n"


def _row(uid=None, **over):
    r = dict(user_id=uid or str(uuid.uuid4()), name="Asha", email="a@example.com",
             monthly_income="50000", credit_score="700", employment_status="Salaried", age="30")
    r.update(over)
    return ",".join(r[c] for c in ("user_id", "name", "email", "monthly_income",
                                   "credit_score", "employment_status", "age")) + "\n"


class ValidationTests(unittest.TestCase):
    def test_valid_row(self):
        uid = str(uuid.uuid4())
        out = validate_row(dict(user_id=uid, name="A", email="a@b.c", monthly_income="1",
                                credit_score="650", employment_status="Business", age="22"))
        self.assertEqual(out[0], uid)

    def test_rejects(self):
        base = dict(user_id=str(uuid.uuid4()), name="A", email="a@b.c", monthly_income="1",
                    credit_score="650", employment_status="Business", age="22")
        for field, bad in [("user_id", "nope"), ("name", " "), ("email", "x"),
                           ("monthly_income", "abc"), ("monthly_income", "-5"),
                           ("credit_score", "950"), ("employment_status", "Retired"),
                           ("age", "17")]:
            with self.assertRaises(RowError, msg=f"{field}={bad}"):
                validate_row({**base, field: bad})

    def test_header(self):
        with self.assertRaises(RowError):
            check_header(["user_id", "name"])


class LoaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.update(
            DB_HOST=os.environ.get("TEST_DB_HOST", "localhost"),
            DB_PORT=os.environ.get("TEST_DB_PORT", "55432"),
            DB_USER=os.environ.get("TEST_DB_USER", "postgres"),
            DB_PASSWORD=os.environ.get("TEST_DB_PASSWORD", "x"),
            DB_NAME=os.environ.get("TEST_DB_NAME", "postgres"),
            DB_SSL="false",
        )

    def setUp(self):
        self.conn = handler.connect()
        self.conn.run("TRUNCATE matches, users, batches RESTART IDENTITY CASCADE")
        self.batch = str(uuid.uuid4())

    def tearDown(self):
        self.conn.close()

    def _load(self, text, batch=None):
        return handler.process_csv(self.conn, batch or self.batch, "k", io.StringIO(text))

    def test_bad_rows_skipped_not_fatal(self):
        text = HEADER + _row() + _row(credit_score="9999") + _row(email="nope") + _row()
        res = self._load(text)
        self.assertEqual((res["row_count"], res["skipped"], res["duplicates"]), (2, 2, 0))

    def test_duplicates_and_shared_email(self):
        uid = str(uuid.uuid4())
        # same user_id twice -> one row; same email on different ids -> both kept
        text = HEADER + _row(uid) + _row(uid) + _row() + _row()
        res = self._load(text)
        self.assertEqual((res["row_count"], res["duplicates"]), (3, 1))

    def test_retry_is_idempotent(self):
        text = HEADER + "".join(_row() for _ in range(2500))  # spans 3 chunks
        first = self._load(text)
        again = self._load(text)
        self.assertEqual(first, {"row_count": 2500, "skipped": 0, "duplicates": 0})
        self.assertEqual(again["row_count"], 2500)  # not 0: recomputed from the table
        status = self.conn.run("SELECT status, row_count FROM batches WHERE batch_id=CAST(:b AS uuid)",
                               b=self.batch)[0]
        self.assertEqual(status, ["processed", 2500])

    def test_existing_user_in_new_batch_counts_as_duplicate(self):
        uid = str(uuid.uuid4())
        self._load(HEADER + _row(uid))
        res = self._load(HEADER + _row(uid) + _row(), batch=str(uuid.uuid4()))
        self.assertEqual((res["row_count"], res["duplicates"]), (1, 1))

    def test_missing_columns_rejects_file(self):
        with self.assertRaises(RowError):
            self._load("user_id,name\n1,2\n")

    def test_bom_and_empty_body(self):
        res = self._load(HEADER)
        self.assertEqual(res["row_count"], 0)

    def test_batch_id_from_key(self):
        b = str(uuid.uuid4())
        self.assertEqual(handler._batch_id_from_key(f"uploads/{b}/f.csv"), b)
        self.assertIsNone(handler._batch_id_from_key("uploads/not-a-uuid/f.csv"))
        self.assertIsNone(handler._batch_id_from_key("other/x.csv"))


if __name__ == "__main__":
    unittest.main()
