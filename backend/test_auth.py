import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient


_original_environment = {}
for _key in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "VERCEL"):
    _original_environment[_key] = os.environ.pop(_key, None)
_startup_directory = tempfile.TemporaryDirectory()
os.environ["TRADEMIND_AUTH_DB"] = str(Path(_startup_directory.name) / "startup.sqlite3")
import main
os.environ.pop("TRADEMIND_AUTH_DB", None)
for _key, _value in _original_environment.items():
    if _value is not None:
        os.environ[_key] = _value
_startup_directory.cleanup()
main.DATABASE_URL = None


class AuthenticationFlowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        main.AUTH_DB = Path(self.directory.name) / "auth.sqlite3"
        main._initialize_auth_db()
        self.client = TestClient(main.app)
        self.verify_email = patch.object(main, "_send_verification_email").start()
        self.reset_email = patch.object(main, "_send_password_reset_email").start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.client.close)
        self.addCleanup(self.directory.cleanup)

    def register(self, username="marketpilot", email="pilot@example.com", password="MarketPilot!42", confirm_password=None):
        return self.client.post("/api/auth/signup", json={
            "username": username,
            "email": email,
            "password": password,
            "confirm_password": confirm_password or password,
        })

    def verification_token(self):
        return self.verify_email.call_args.args[1]

    def test_registration_requires_verification_and_accepts_email_login(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("access_token", response.json())
        self.assertFalse(response.cookies.get("trademind_session"))
        with main._auth_connection() as connection:
            user = main._execute(connection, "SELECT password_hash FROM users WHERE username = ?", ("marketpilot",)).fetchone()
        self.assertNotEqual(user["password_hash"], b"MarketPilot!42")
        self.assertIsInstance(user["password_hash"], bytes)
        self.assertEqual(self.client.post("/api/auth/login", json={
            "username_or_email": "marketpilot",
            "password": "MarketPilot!42",
        }).status_code, 401)

        verified = self.client.post("/api/auth/verify-email", json={"token": self.verification_token()})
        self.assertEqual(verified.status_code, 200)
        login = self.client.post("/api/auth/login", json={
            "username_or_email": "pilot@example.com",
            "password": "MarketPilot!42",
        })
        self.assertEqual(login.status_code, 200)
        self.assertIn("httponly", login.headers["set-cookie"].lower())
        self.assertNotIn("access_token", login.json())

    def test_duplicate_username_email_and_invalid_email_are_rejected(self):
        self.assertEqual(self.register().status_code, 201)
        duplicate_username = self.register(username="MarketPilot", email="another@example.com")
        self.assertEqual(duplicate_username.status_code, 409)
        self.assertIn("username", duplicate_username.json()["detail"].lower())
        duplicate_email = self.register(username="anotherpilot", email="PILOT@example.com")
        self.assertEqual(duplicate_email.status_code, 409)
        self.assertIn("email", duplicate_email.json()["detail"].lower())
        invalid_email = self.register(username="thirdpilot", email="not-an-email")
        self.assertEqual(invalid_email.status_code, 422)

    def test_password_mismatch_is_rejected_by_server(self):
        signup = self.register(confirm_password="DifferentPassword!87")
        self.assertEqual(signup.status_code, 422)
        self.assertIn("do not match", signup.json()["detail"])

    def test_verification_can_be_resent_and_old_link_is_invalidated(self):
        self.assertEqual(self.register().status_code, 201)
        first_token = self.verification_token()
        resent = self.client.post("/api/auth/resend-verification", json={"email": "pilot@example.com"})
        self.assertEqual(resent.status_code, 200)
        second_token = self.verification_token()
        self.assertNotEqual(first_token, second_token)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={"token": first_token}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={"token": second_token}).status_code, 200)

    def test_reset_is_single_use_and_invalidates_sessions_and_old_password(self):
        self.assertEqual(self.register().status_code, 201)
        self.client.post("/api/auth/verify-email", json={"token": self.verification_token()})
        self.assertEqual(self.client.post("/api/auth/login", json={
            "username_or_email": "marketpilot",
            "password": "MarketPilot!42",
        }).status_code, 200)
        previous_session = self.client.cookies.get("trademind_session")

        requested = self.client.post("/api/auth/forgot-password", json={"email": "pilot@example.com"})
        self.assertEqual(requested.status_code, 202)
        reset_token = self.reset_email.call_args.args[1]
        mismatch = self.client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": "NewMarketPilot!87",
            "confirm_password": "DifferentMarketPilot!88",
        })
        self.assertEqual(mismatch.status_code, 422)
        reset = self.client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": "NewMarketPilot!87",
            "confirm_password": "NewMarketPilot!87",
        })
        self.assertEqual(reset.status_code, 200)
        self.assertIn("trademind_session", reset.headers.get("set-cookie", ""))
        invalidated_session = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {previous_session}"})
        self.assertEqual(invalidated_session.status_code, 401)
        self.assertEqual(self.client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": "AnotherMarketPilot!98",
            "confirm_password": "AnotherMarketPilot!98",
        }).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", json={
            "username_or_email": "marketpilot",
            "password": "MarketPilot!42",
        }).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={
            "username_or_email": "marketpilot",
            "password": "NewMarketPilot!87",
        }).status_code, 200)

    def test_expired_reset_token_is_rejected(self):
        self.assertEqual(self.register().status_code, 201)
        self.client.post("/api/auth/verify-email", json={"token": self.verification_token()})
        self.client.post("/api/auth/forgot-password", json={"email": "pilot@example.com"})
        reset_token = self.reset_email.call_args.args[1]
        token_hash = main.hashlib.sha256(reset_token.encode("utf-8")).hexdigest()
        expired_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        with main._auth_connection() as connection:
            main._execute(connection, "UPDATE auth_tokens SET expires_at = ? WHERE token_hash = ?", (expired_at, token_hash))
        response = self.client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "password": "NewMarketPilot!87",
            "confirm_password": "NewMarketPilot!87",
        })
        self.assertEqual(response.status_code, 400)

    def test_legacy_account_is_preserved_and_can_upgrade_email(self):
        legacy_path = Path(self.directory.name) / "legacy.sqlite3"
        salt = b"0123456789abcdef"
        connection = sqlite3.connect(legacy_path)
        try:
            connection.execute("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            connection.execute(
                "INSERT INTO users (username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?)",
                ("oldaccount", salt, main._hash_password("OldAccount!42", salt), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        finally:
            connection.close()
        main.AUTH_DB = legacy_path
        main._initialize_auth_db()
        login = self.client.post("/api/auth/login", json={
            "username_or_email": "oldaccount",
            "password": "OldAccount!42",
        })
        self.assertEqual(login.status_code, 200)
        self.assertTrue(self.client.get("/api/auth/me").json()["requires_email_upgrade"])
        upgraded = self.client.post("/api/auth/upgrade-email", json={"email": "legacy@example.com"})
        self.assertEqual(upgraded.status_code, 200)
        self.assertEqual(self.verify_email.call_args.args[0], "legacy@example.com")
        verified = self.client.post("/api/auth/verify-email", json={"token": self.verification_token()})
        self.assertEqual(verified.status_code, 200)
        self.assertFalse(self.client.get("/api/auth/me").json()["requires_email_upgrade"])
        with main._auth_connection() as connection:
            user = main._execute(connection, "SELECT id, email_verified FROM users WHERE username = ?", ("oldaccount",)).fetchone()
        self.assertEqual(int(user["id"]), 1)
        self.assertTrue(user["email_verified"])

    def test_forgot_password_is_neutral_for_unknown_email_and_rate_limited(self):
        first = self.client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
        self.assertEqual(first.status_code, 202)
        self.assertIn("If an account exists", first.json()["message"])
        self.assertFalse(self.reset_email.called)
        for attempt in range(4):
            response = self.client.post(
                "/api/auth/forgot-password",
                json={"email": "nobody@example.com"},
                headers={"X-Forwarded-For": f"198.51.100.{attempt + 1}"},
            )
            self.assertEqual(response.status_code, 202)
        limited = self.client.post(
            "/api/auth/forgot-password",
            json={"email": "nobody@example.com"},
            headers={"X-Forwarded-For": "198.51.100.5"},
        )
        self.assertEqual(limited.status_code, 429)

    def test_email_provider_failure_is_reported(self):
        self.verify_email.side_effect = HTTPException(status_code=502, detail="TradeMind could not deliver the email.")
        response = self.register()
        self.assertEqual(response.status_code, 502)
        with main._auth_connection() as connection:
            user = main._execute(connection, "SELECT id FROM users WHERE username = ?", ("marketpilot",)).fetchone()
        self.assertIsNotNone(user)


if __name__ == "__main__":
    unittest.main()
