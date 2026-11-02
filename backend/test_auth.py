import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import psycopg
import pandas as pd


_original_environment = {}
for _key in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "VERCEL"):
    _original_environment[_key] = os.environ.pop(_key, None)
_startup_directory = tempfile.TemporaryDirectory()
os.environ["TRADEMIND_AUTH_DB"] = str(Path(_startup_directory.name) / "startup.sqlite3")
import main
import promote_admin
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
        self.assertEqual(self.client.get("/api/auth/me").json(), {"user_id": 1, "username": "marketpilot", "role": "USER"})

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

    def risk_settings(self, **overrides):
        settings = {
            "accountEquity": "10000",
            "riskPerTradePct": "1",
            "dailyLossMode": "amount",
            "dailyLossValue": "500",
            "maxDrawdownPct": "10",
            "maxOpenRiskPct": "3",
            "maxTradesPerDay": "5",
            "tradingTimezone": "UTC",
            "tradingDayStart": "00:00",
            "capitalBox": "10000",
            "riskPerTrade": "1",
        }
        settings.update(overrides)
        return settings

    def login_user(self, username="marketpilot"):
        self.register(username=username)
        return self.client.post("/api/auth/login", json={
            "username": username,
            "password": "MarketPilot!42",
        })

    def test_risk_endpoints_require_login(self):
        self.assertEqual(self.client.get("/api/risk/status").status_code, 401)
        self.assertEqual(self.client.get("/api/risk/positions").status_code, 401)
        response = self.client.post("/api/risk/positions", json={
            "instrument": "Example spot",
            "instrument_type": "spot",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "quantity": 1,
            "contract_multiplier": 1,
            "quantity_step": 1,
        })
        self.assertEqual(response.status_code, 401)

    def test_settings_and_manual_positions_persist_per_user(self):
        self.login_user()
        saved = self.client.put("/api/risk/settings", json={"settings": self.risk_settings(
            accountEquity="10000.25", capitalBox="10000.25", riskPerTradePct="0.5",
            riskPerTrade="0.5", dailyLossValue="500.50", dailyLoss="500.50",
        )})
        self.assertEqual(saved.status_code, 200)
        position = self.client.post("/api/risk/positions", json={
            "instrument": "Example spot",
            "instrument_type": "spot",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "quantity": 25,
            "contract_multiplier": 1,
            "quantity_step": 1,
            "fee_bps": 0,
            "slippage_per_unit": 0,
        })
        self.assertEqual(position.status_code, 201)
        self.assertEqual(position.json()["risk_amount"], 50)
        self.assertEqual(len(self.client.get("/api/risk/positions").json()), 1)
        self.assertEqual(self.client.get("/api/risk/settings").json()["accountEquity"], "10000.25")
        self.assertEqual(self.client.get("/api/risk/status").json()["current_open_risk"], 50)

        second_client = TestClient(main.app)
        try:
            second_client.post("/api/auth/signup", json={
                "username": "secondpilot",
                "password": "MarketPilot!42",
                "confirm_password": "MarketPilot!42",
            })
            second_client.post("/api/auth/login", json={
                "username": "secondpilot",
                "password": "MarketPilot!42",
            })
            self.assertEqual(second_client.get("/api/risk/positions").json(), [])
        finally:
            second_client.close()

    def test_server_blocks_trade_above_per_trade_budget(self):
        self.login_user()
        self.client.put("/api/risk/settings", json={"settings": self.risk_settings()})
        response = self.client.post("/api/risk/positions", json={
            "instrument": "Example spot",
            "instrument_type": "spot",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "quantity": 60,
            "contract_multiplier": 1,
            "quantity_step": 1,
        })
        self.assertEqual(response.status_code, 409)
        self.assertIn("per-trade risk limit", response.json()["detail"]["reasons"][0])
        self.assertEqual(self.client.get("/api/risk/positions").json(), [])

    def test_server_blocks_position_above_available_capital(self):
        self.login_user()
        self.client.put("/api/risk/settings", json={"settings": self.risk_settings(
            accountEquity="1000",
            capitalBox="1000",
            riskPerTradePct="100",
            riskPerTrade="100",
            dailyLossValue="5000",
            maxDrawdownPct="100",
            maxOpenRiskPct="100",
        )})
        response = self.client.post("/api/risk/positions", json={
            "instrument": "Example spot",
            "instrument_type": "spot",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "quantity": 11,
            "contract_multiplier": 1,
            "quantity_step": 1,
        })
        self.assertEqual(response.status_code, 409)
        self.assertIn("available capital", response.json()["detail"]["message"])

    def test_cash_index_cannot_be_recorded_as_a_position(self):
        self.login_user()
        response = self.client.post("/api/risk/positions", json={
            "instrument": "NIFTY 50",
            "instrument_type": "nifty_index",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "quantity": 1,
            "contract_multiplier": 1,
            "quantity_step": 1,
        })
        self.assertEqual(response.status_code, 422)
        self.assertIn("not directly tradable", response.json()["detail"])

    def test_normal_users_are_denied_from_all_admin_apis(self):
        self.login_user()
        paths = [
            "/api/admin/overview", "/api/admin/users", "/api/admin/strategies",
            "/api/admin/signals", "/api/admin/backtests", "/api/admin/feedback",
            "/api/admin/settings", "/api/admin/activity",
        ]
        self.assertTrue(all(self.client.get(path).status_code == 403 for path in paths))
        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/admin/overview").status_code, 401)

    def test_first_admin_bootstrap_and_admin_pages_use_database_records(self):
        self.login_user()
        self.assertEqual(promote_admin.promote_first_admin("marketpilot"), "marketpilot")
        overview = self.client.get("/api/admin/overview")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.json()["admin_id"], 1)
        self.assertEqual(overview.json()["users"]["total"], 1)
        self.assertEqual(overview.json()["signals"]["total"], 0)
        self.assertEqual(self.client.get("/api/admin/backtests").json(), [])
        self.assertEqual(self.client.get("/api/admin/users").json()[0]["role"], "ADMIN")
        self.assertEqual(self.client.get("/api/admin/settings").json()["admin_profile"]["username"], "marketpilot")
        self.assertEqual(self.client.get("/api/admin/activity").json()[0]["action"], "ADMIN_BOOTSTRAPPED")
        self.assertEqual(self.client.put("/api/admin/users/1", json={"role": "USER"}).status_code, 409)
        with self.assertRaisesRegex(RuntimeError, "administrator already exists"):
            promote_admin.promote_first_admin("marketpilot")

    def test_admin_strategy_publication_user_status_feedback_and_audit(self):
        self.login_user()
        promote_admin.promote_first_admin("marketpilot")
        strategy_payload = {
            "name": "Managed Trend Rule",
            "description": "Admin-managed test rule.",
            "category": "Trend",
            "symbol": "NIFTY 50",
            "timeframe": "15m",
            "direction": "Long",
            "entry": {"logic": "AND", "conditions": [{"left": {"indicator": "CLOSE"}, "operator": "gt", "right": {"indicator": "EMA", "period": 20}}]},
            "exit": {"logic": "OR", "conditions": [{"left": {"indicator": "CLOSE"}, "operator": "lt", "right": {"indicator": "EMA", "period": 20}}]},
            "risk_settings": {"stop_loss_pct": 1.5, "target_r": 2},
            "active": True,
            "published": True,
        }
        created = self.client.post("/api/admin/strategies", json=strategy_payload)
        self.assertEqual(created.status_code, 201, created.text)
        strategy_id = created.json()["id"]

        second_client = TestClient(main.app)
        try:
            second_client.post("/api/auth/signup", json={
                "username": "secondpilot",
                "password": "MarketPilot!42",
                "confirm_password": "MarketPilot!42",
            })
            second_client.post("/api/auth/login", json={"username": "secondpilot", "password": "MarketPilot!42"})
            self.assertEqual(second_client.get("/api/strategies").json()[0]["published"], True)
            self.assertEqual(second_client.get("/api/admin/overview").status_code, 403)
            sample_frame = pd.DataFrame({"time": pd.date_range(pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=12), periods=2, freq="6h")})
            with patch.object(main, "market_frame", return_value=(sample_frame, True)), patch.object(main, "generate_signal", return_value={"signal": "BUY"}), patch.object(main, "run_backtest", return_value={"pnl": 0}):
                signal_response = second_client.get("/api/signal/NIFTY 50", params={"strategy_id": strategy_id})
                backtest_response = second_client.post("/api/backtest", params={"strategy_id": strategy_id, "timeframe": "1d", "duration": 1})
            self.assertEqual(signal_response.status_code, 200, signal_response.text)
            self.assertEqual(signal_response.json()["strategy"], "Managed Trend Rule")
            self.assertEqual(backtest_response.status_code, 200, backtest_response.text)
            feedback = second_client.post("/api/feedback", json={
                "category": "Bug", "subject": "Strategy display", "message": "The published rule should show its description.",
            })
            self.assertEqual(feedback.status_code, 201)

            update = self.client.put(f"/api/admin/strategies/{strategy_id}", json={**strategy_payload, "published": False})
            self.assertEqual(update.status_code, 200)
            self.assertFalse(update.json()["published"])
            self.assertEqual(second_client.get("/api/strategies").json(), [])

            users = self.client.get("/api/admin/users?query=secondpilot").json()
            target = users[0]
            role_change = self.client.put(f"/api/admin/users/{target['id']}", json={"role": "ADMIN"})
            self.assertEqual(role_change.status_code, 200)
            suspension = self.client.put(f"/api/admin/users/{target['id']}", json={"account_status": "SUSPENDED"})
            self.assertEqual(suspension.status_code, 200)
            self.assertEqual(second_client.get("/api/auth/me").status_code, 403)

            inbox = self.client.get("/api/admin/feedback").json()
            self.assertEqual(inbox[0]["subject"], "Strategy display")
            updated_feedback = self.client.put(f"/api/admin/feedback/{feedback.json()['id']}", json={"status": "RESOLVED"})
            self.assertEqual(updated_feedback.json()["status"], "RESOLVED")
            self.assertGreaterEqual(len(self.client.get("/api/admin/activity").json()), 5)
        finally:
            second_client.close()

        deleted = self.client.delete(f"/api/admin/strategies/{strategy_id}")
        self.assertEqual(deleted.status_code, 204)

    def test_admin_settings_persist_and_signal_page_does_not_invent_live_data(self):
        self.login_user()
        promote_admin.promote_first_admin("marketpilot")
        updated = self.client.put("/api/admin/settings", json={"settings": {
            "risk_per_trade_pct": 0.5,
            "daily_loss_pct": 2.5,
            "max_drawdown_pct": 8,
            "max_open_risk_pct": 3,
            "supported_instruments": ["NIFTY 50", "BTC/USDT", "GOLD"],
            "supported_timeframes": ["1m", "3m", "5m", "15m", "1h", "4h"],
        }})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(self.client.get("/api/admin/settings").json()["settings"]["risk_per_trade_pct"], 0.5)
        with patch.object(main, "market_frame", return_value=(None, False)):
            signals = self.client.get("/api/admin/signals")
        self.assertEqual(signals.status_code, 200)
        self.assertEqual([item["signal"] for item in signals.json()["current"]], ["NO DATA"] * 3)
        self.assertEqual(signals.json()["history"], [])

    def test_backtest_api_accepts_decimal_financial_parameters(self):
        timestamps = pd.date_range(pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=12), periods=2, freq="6h")
        frame = pd.DataFrame({"time": timestamps})
        with patch.object(main, "market_frame", return_value=(frame, True)), patch.object(main, "run_backtest", return_value={"pnl": 0}):
            response = self.client.post("/api/backtest", params={
                "symbol": "NIFTY 50",
                "initial_capital": "10000.01",
                "timeframe": "1d",
                "duration": "1",
                "duration_unit": "days",
                "strategy": "Price Action Break & Retest",
                "position_size": "5000.01",
                "stop_loss_pct": "0.01",
                "take_profit_rr": "0.5",
                "fee_bps": "0.01",
            })
        self.assertEqual(response.status_code, 200, response.text)


if __name__ == "__main__":
    unittest.main()
