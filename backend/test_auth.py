import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import psycopg


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
        self.addCleanup(self.client.close)
        self.addCleanup(self.directory.cleanup)

    def register(self, username="marketpilot", password="MarketPilot!42", confirm_password=None):
        return self.client.post("/api/auth/signup", json={
            "username": username,
            "password": password,
            "confirm_password": confirm_password or password,
        })

    def test_registration_hashes_password_and_login_works_without_email(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"], "Account created. You can now log in.")
        self.assertFalse(response.cookies.get("trademind_session"))
        with main._auth_connection() as connection:
            user = main._execute(
                connection,
                "SELECT id, username, email, email_verified, password_hash FROM users WHERE username = ?",
                ("marketpilot",),
            ).fetchone()
        self.assertEqual(user["email"], None)
        self.assertFalse(user["email_verified"])
        self.assertNotEqual(user["password_hash"], b"MarketPilot!42")
        self.assertIsInstance(user["password_hash"], bytes)

        login = self.client.post("/api/auth/login", json={
            "username": "marketpilot",
            "password": "MarketPilot!42",
        })
        self.assertEqual(login.status_code, 200)
        self.assertIn("httponly", login.headers["set-cookie"].lower())
        self.assertEqual(self.client.get("/api/auth/me").json(), {"username": "marketpilot"})

    def test_duplicate_username_is_rejected_case_insensitively(self):
        self.assertEqual(self.register().status_code, 201)
        duplicate = self.register(username="MarketPilot")
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"], "This username is already taken. Please choose another username.")
        with main._auth_connection() as connection:
            count = main._execute(connection, "SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        self.assertEqual(int(count), 1)

    def test_password_mismatch_does_not_create_user(self):
        response = self.register(confirm_password="DifferentPassword!87")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Passwords do not match.")
        with main._auth_connection() as connection:
            count = main._execute(connection, "SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        self.assertEqual(int(count), 0)

    def test_incorrect_password_is_rejected_without_session(self):
        self.assertEqual(self.register().status_code, 201)
        response = self.client.post("/api/auth/login", json={
            "username": "marketpilot",
            "password": "IncorrectPassword!42",
        })
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Username or password is incorrect.")
        self.assertFalse(self.client.cookies.get("trademind_session"))

    def test_session_persists_across_client_instances(self):
        self.assertEqual(self.register().status_code, 201)
        self.client.post("/api/auth/login", json={
            "username": "marketpilot",
            "password": "MarketPilot!42",
        })
        second_client = TestClient(main.app, cookies=dict(self.client.cookies))
        try:
            response = second_client.get("/api/auth/me")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["username"], "marketpilot")
        finally:
            second_client.close()

    def test_logout_revokes_persistent_session(self):
        self.assertEqual(self.register().status_code, 201)
        self.client.post("/api/auth/login", json={
            "username": "marketpilot",
            "password": "MarketPilot!42",
        })
        session_token = self.client.cookies.get("trademind_session")
        self.assertTrue(session_token)
        logout = self.client.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        revoked = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {session_token}"})
        self.assertEqual(revoked.status_code, 401)

    def test_legacy_user_and_email_data_are_preserved_but_do_not_gate_login(self):
        legacy_path = Path(self.directory.name) / "legacy.sqlite3"
        salt = b"0123456789abcdef"
        connection = sqlite3.connect(legacy_path)
        try:
            connection.execute("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    email TEXT,
                    email_verified INTEGER NOT NULL DEFAULT 0,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    password_updated_at TEXT
                )
            """)
            connection.execute(
                "INSERT INTO users (username, email, email_verified, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("oldaccount", "old@example.com", 0, salt, main._hash_password("OldAccount!42", salt), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        finally:
            connection.close()
        main.AUTH_DB = legacy_path
        main._initialize_auth_db()
        login = self.client.post("/api/auth/login", json={
            "username": "oldaccount",
            "password": "OldAccount!42",
        })
        self.assertEqual(login.status_code, 200)
        with main._auth_connection() as connection:
            user = main._execute(connection, "SELECT id, email, email_verified FROM users WHERE username = ?", ("oldaccount",)).fetchone()
        self.assertEqual(int(user["id"]), 1)
        self.assertEqual(user["email"], "old@example.com")
        self.assertEqual(user["email_verified"], 0)

    def test_email_auth_routes_are_not_registered(self):
        routes = {route.path for route in main.app.routes}
        self.assertFalse(any(path.startswith("/api/auth/verify-") for path in routes))
        self.assertFalse(any("password" in path or "username" in path and "auth" in path for path in routes if path != "/api/auth/login"))

    def test_protected_legacy_callers_return_json_unauthorized(self):
        telegram = self.client.post("/api/telegram/send", json={
            "bot_token": "123456:example-token",
            "chat_id": "123",
            "message": "test",
        })
        options = self.client.get("/api/options/signal/NIFTY")
        self.assertEqual(telegram.status_code, 401)
        self.assertEqual(telegram.headers.get("content-type", "").split(";")[0], "application/json")
        self.assertEqual(options.status_code, 401)
        self.assertEqual(options.headers.get("content-type", "").split(";")[0], "application/json")

    def test_database_failures_return_safe_json(self):
        with self.assertLogs("trademind.auth", level="ERROR"):
            with patch.object(main, "_auth_connection", side_effect=psycopg.OperationalError("private connection detail")):
                response = self.client.post("/api/auth/signup", json={
                    "username": "marketpilot",
                    "password": "MarketPilot!42",
                    "confirm_password": "MarketPilot!42",
                })
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers.get("content-type", "").split(";")[0], "application/json")
        self.assertNotIn("private connection detail", response.text)


if __name__ == "__main__":
    unittest.main()
