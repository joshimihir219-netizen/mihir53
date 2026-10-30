from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from ml_engine import generate_signal
from backtest import custom_strategy_mask, run_backtest
from backtest import STRATEGIES
from market_data import TIMEFRAME_HISTORY, market_frame, _duration_offset, _max_duration
from angel_options import get_live_option_signal

app = FastAPI(title="AI Trading Dashboard API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

SYMBOLS = [
    "NIFTY 50", "BANK NIFTY", "SENSEX",
    "RELIANCE", "TCS", "INFOSYS", "HDFC BANK", "ICICI BANK", "SBIN", "ITC", "BHARTI AIRTEL",
    "BTC/USDT", "ETH/USDT",
]
DEFAULT_AUTH_DB = Path(__file__).with_name("trademind-auth.sqlite3")
AUTH_DB = Path(os.environ.get("TRADEMIND_AUTH_DB", DEFAULT_AUTH_DB))
DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL")
    or os.environ.get("POSTGRES_URL_NON_POOLING")
)
PASSWORD_ITERATIONS = 310_000
SESSION_LIFETIME = timedelta(days=30)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class TelegramMessage(BaseModel):
    bot_token: str = Field(min_length=1, max_length=128)
    chat_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=4096)


class StrategyPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=1000)
    category: str = Field(default="Custom", max_length=60)
    symbol: str = Field(default="NIFTY 50", max_length=40)
    timeframe: str = Field(default="15m", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$")
    direction: str = Field(default="Long", pattern="^(Long|Short|Both)$")
    entry: dict
    exit: dict
    risk_settings: dict = Field(default_factory=dict)
    active: bool = True


class RiskSettingsPayload(BaseModel):
    settings: dict


@contextmanager
def _auth_connection():
    if DATABASE_URL:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5) as connection:
            yield connection
        return
    if os.environ.get("VERCEL"):
        raise HTTPException(
            status_code=503,
            detail="Persistent account storage is not configured. Set DATABASE_URL in the Vercel project environment.",
        )

    AUTH_DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _execute(connection, query, parameters=()):
    if DATABASE_URL:
        query = query.replace("?", "%s")
    return connection.execute(query, parameters)


def _initialize_auth_db():
    if os.environ.get("VERCEL") and not DATABASE_URL:
        return
    with _auth_connection() as connection:
        if DATABASE_URL:
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    username TEXT NOT NULL,
                    password_salt BYTEA NOT NULL,
                    password_hash BYTEA NOT NULL,
                    created_at TEXT NOT NULL
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                )
                """,
            )
        else:
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                )
                """,
            )
        _execute(
            connection,
            "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))",
        )
        if DATABASE_URL:
            strategy_id = "BIGSERIAL PRIMARY KEY"
            user_id_type = "BIGINT"
        else:
            strategy_id = "INTEGER PRIMARY KEY AUTOINCREMENT"
            user_id_type = "INTEGER"
        _execute(connection, f"""
            CREATE TABLE IF NOT EXISTS strategies (
                id {strategy_id},
                user_id {user_id_type} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                direction TEXT NOT NULL,
                definition TEXT NOT NULL,
                version INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        _execute(connection, f"""
            CREATE TABLE IF NOT EXISTS strategy_versions (
                id {"BIGSERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"},
                strategy_id {"BIGINT" if DATABASE_URL else "INTEGER"} NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                definition TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(strategy_id, version)
            )
        """)
        _execute(connection, f"""
            CREATE TABLE IF NOT EXISTS user_risk_settings (
                user_id {user_id_type} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                settings TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        _execute(connection, f"""
            CREATE TABLE IF NOT EXISTS backtest_runs (
                id {"BIGSERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"},
                user_id {user_id_type} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                strategy_id {"BIGINT" if DATABASE_URL else "INTEGER"},
                strategy_name TEXT NOT NULL,
                strategy_version INTEGER NOT NULL,
                strategy_snapshot TEXT NOT NULL,
                result TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


_initialize_auth_db()


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)


def _new_session(connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(timezone.utc) + SESSION_LIFETIME).isoformat()
    _execute(
        connection,
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at),
    )
    return token


def _session_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    return authorization[7:].strip()


@app.post("/api/auth/signup", status_code=201)
def signup(credentials: Credentials):
    username = credentials.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required.")
    salt = secrets.token_bytes(16)
    password_hash = _hash_password(credentials.password, salt)
    try:
        with _auth_connection() as connection:
            if DATABASE_URL:
                cursor = _execute(
                    connection,
                    "INSERT INTO users (username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id",
                    (username, salt, password_hash, datetime.now(timezone.utc).isoformat()),
                )
                user_id = int(cursor.fetchone()["id"])
            else:
                cursor = _execute(
                    connection,
                    "INSERT INTO users (username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (username, salt, password_hash, datetime.now(timezone.utc).isoformat()),
                )
                user_id = int(cursor.lastrowid)
            token = _new_session(connection, user_id)
    except (sqlite3.IntegrityError, psycopg.IntegrityError) as error:
        raise HTTPException(status_code=409, detail="An account with that username already exists. Log in instead.") from error
    return {"access_token": token, "token_type": "bearer", "username": username}


@app.post("/api/auth/login")
def login(credentials: Credentials):
    with _auth_connection() as connection:
        user = _execute(
            connection,
            "SELECT id, username, password_salt, password_hash FROM users WHERE LOWER(username) = LOWER(?)",
            (credentials.username.strip(),),
        ).fetchone()
        if user is None or not hmac.compare_digest(
            _hash_password(credentials.password, user["password_salt"]),
            user["password_hash"],
        ):
            raise HTTPException(status_code=401, detail="Account not found or password incorrect. Sign up if you don't have an account.")
        token = _new_session(connection, int(user["id"]))
    return {"access_token": token, "token_type": "bearer", "username": user["username"]}


@app.get("/api/auth/me")
def current_user(authorization: str | None = Header(default=None)):
    token = _session_token(authorization)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with _auth_connection() as connection:
        user = _execute(
            connection,
            """
            SELECT users.username, auth_sessions.expires_at
            FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if user is None or user["expires_at"] <= now:
            _execute(connection, "DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    return {"username": user["username"]}


def _authenticated_user_id(authorization: str | None) -> int:
    username = current_user(authorization)["username"]
    with _auth_connection() as connection:
        user = _execute(connection, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Account is no longer available.")
    return int(user["id"])


def _strategy_record(row):
    payload = json.loads(row["definition"])
    return {
        "id": int(row["id"]),
        **payload,
        "version": int(row["version"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "rule": "custom",
    }


def _validate_strategy_payload(payload: StrategyPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Strategy name cannot be blank.")
    if payload.direction != "Long":
        raise HTTPException(status_code=422, detail="The current strategy simulator supports long-only custom rules.")
    sample = pd.DataFrame({
        "open": [100.0] * 600,
        "high": [101.0] * 600,
        "low": [99.0] * 600,
        "close": [100.0] * 600,
        "volume": [1000.0] * 600,
    })
    try:
        custom_strategy_mask(sample, {"entry": payload.entry, "exit": payload.exit})
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=f"Invalid strategy conditions: {error}") from error


@app.get("/api/strategies")
def list_strategies(authorization: str | None = Header(default=None)):
    user_id = _authenticated_user_id(authorization)
    with _auth_connection() as connection:
        rows = _execute(connection, "SELECT * FROM strategies WHERE user_id = ? ORDER BY updated_at DESC", (user_id,)).fetchall()
        run_rows = _execute(connection, "SELECT strategy_id, strategy_name, result, created_at FROM backtest_runs WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    latest_by_id = {}
    counts_by_id = {}
    for run in run_rows:
        if run["strategy_id"] is None:
            continue
        strategy_id = int(run["strategy_id"])
        counts_by_id[strategy_id] = counts_by_id.get(strategy_id, 0) + 1
        latest_by_id.setdefault(strategy_id, {"created_at": run["created_at"], "result": json.loads(run["result"])})
    result = []
    for row in rows:
        strategy = _strategy_record(row)
        strategy["backtest_count"] = counts_by_id.get(strategy["id"], 0)
        strategy["latest_backtest"] = latest_by_id.get(strategy["id"])
        result.append(strategy)
    return result


@app.post("/api/strategies", status_code=201)
def create_strategy(payload: StrategyPayload, authorization: str | None = Header(default=None)):
    _validate_strategy_payload(payload)
    user_id = _authenticated_user_id(authorization)
    definition = payload.model_dump()
    now = datetime.now(timezone.utc).isoformat()
    with _auth_connection() as connection:
        if DATABASE_URL:
            row = _execute(connection, """
                INSERT INTO strategies (user_id, name, description, category, symbol, timeframe, direction, definition, version, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id
            """, (user_id, payload.name.strip(), payload.description, payload.category, payload.symbol,
                   payload.timeframe, payload.direction, json.dumps(definition), int(payload.active), now, now)).fetchone()
            strategy_id = int(row["id"])
        else:
            cursor = _execute(connection, """
                INSERT INTO strategies (user_id, name, description, category, symbol, timeframe, direction, definition, version, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, (user_id, payload.name.strip(), payload.description, payload.category, payload.symbol,
                   payload.timeframe, payload.direction, json.dumps(definition), int(payload.active), now, now))
            strategy_id = int(cursor.lastrowid)
        _execute(connection, "INSERT INTO strategy_versions (strategy_id, version, definition, created_at) VALUES (?, 1, ?, ?)",
                 (strategy_id, json.dumps(definition), now))
        row = _execute(connection, "SELECT * FROM strategies WHERE id = ? AND user_id = ?", (strategy_id, user_id)).fetchone()
    return _strategy_record(row)


@app.put("/api/strategies/{strategy_id}")
def update_strategy(strategy_id: int, payload: StrategyPayload, authorization: str | None = Header(default=None)):
    _validate_strategy_payload(payload)
    user_id = _authenticated_user_id(authorization)
    definition = payload.model_dump()
    now = datetime.now(timezone.utc).isoformat()
    with _auth_connection() as connection:
        row = _execute(connection, "SELECT version FROM strategies WHERE id = ? AND user_id = ?", (strategy_id, user_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Strategy not found.")
        version = int(row["version"]) + 1
        _execute(connection, """
            UPDATE strategies SET name = ?, description = ?, category = ?, symbol = ?, timeframe = ?, direction = ?,
                definition = ?, version = ?, active = ?, updated_at = ? WHERE id = ? AND user_id = ?
        """, (payload.name.strip(), payload.description, payload.category, payload.symbol, payload.timeframe,
              payload.direction, json.dumps(definition), version, int(payload.active), now, strategy_id, user_id))
        _execute(connection, "INSERT INTO strategy_versions (strategy_id, version, definition, created_at) VALUES (?, ?, ?, ?)",
                 (strategy_id, version, json.dumps(definition), now))
        updated = _execute(connection, "SELECT * FROM strategies WHERE id = ? AND user_id = ?", (strategy_id, user_id)).fetchone()
    return _strategy_record(updated)


@app.delete("/api/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: int, authorization: str | None = Header(default=None)):
    user_id = _authenticated_user_id(authorization)
    with _auth_connection() as connection:
        cursor = _execute(connection, "DELETE FROM strategies WHERE id = ? AND user_id = ?", (strategy_id, user_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Strategy not found.")
    return None


@app.get("/api/risk/settings")
def get_risk_settings(authorization: str | None = Header(default=None)):
    user_id = _authenticated_user_id(authorization)
    with _auth_connection() as connection:
        row = _execute(connection, "SELECT settings FROM user_risk_settings WHERE user_id = ?", (user_id,)).fetchone()
    return json.loads(row["settings"]) if row else {}


@app.put("/api/risk/settings")
def save_risk_settings(payload: RiskSettingsPayload, authorization: str | None = Header(default=None)):
    user_id = _authenticated_user_id(authorization)
    now = datetime.now(timezone.utc).isoformat()
    settings = json.dumps(payload.settings)
    with _auth_connection() as connection:
        exists = _execute(connection, "SELECT user_id FROM user_risk_settings WHERE user_id = ?", (user_id,)).fetchone()
        if exists:
            _execute(connection, "UPDATE user_risk_settings SET settings = ?, updated_at = ? WHERE user_id = ?", (settings, now, user_id))
        else:
            _execute(connection, "INSERT INTO user_risk_settings (user_id, settings, updated_at) VALUES (?, ?, ?)", (user_id, settings, now))
    return payload.settings


@app.get("/api/backtests")
def list_backtests(authorization: str | None = Header(default=None)):
    user_id = _authenticated_user_id(authorization)
    with _auth_connection() as connection:
        rows = _execute(connection, "SELECT * FROM backtest_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", (user_id,)).fetchall()
    return [{
        "id": int(row["id"]),
        "strategy_id": row["strategy_id"],
        "strategy_name": row["strategy_name"],
        "strategy_version": int(row["strategy_version"]),
        "strategy_snapshot": json.loads(row["strategy_snapshot"]),
        "result": json.loads(row["result"]),
        "created_at": row["created_at"],
    } for row in rows]


@app.post("/api/auth/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    token = _session_token(authorization)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _auth_connection() as connection:
        _execute(connection, "DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
    return None


@app.post("/api/telegram/send")
def send_telegram_message(
    telegram_message: TelegramMessage,
    authorization: str | None = Header(default=None),
):
    current_user(authorization)
    bot_token = telegram_message.bot_token.strip()
    chat_id = telegram_message.chat_id.strip()
    message = telegram_message.message.strip()
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", bot_token):
        raise HTTPException(status_code=422, detail="Telegram bot token format is invalid.")
    if not chat_id or not message:
        raise HTTPException(status_code=422, detail="Telegram chat ID and message are required.")

    payload = json.dumps({"chat_id": chat_id, "text": message}).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
            detail = result.get("description", "Telegram rejected the message.")
        except (UnicodeDecodeError, json.JSONDecodeError):
            detail = "Telegram rejected the message. Check the bot token and chat ID."
        raise HTTPException(status_code=502, detail=detail) from error
    except (URLError, OSError) as error:
        raise HTTPException(status_code=502, detail="Could not connect to Telegram. Check the server's internet connection.") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail="Telegram returned an invalid response.") from error

    if not isinstance(result, dict) or not result.get("ok"):
        if not isinstance(result, dict):
            raise HTTPException(status_code=502, detail="Telegram returned an invalid response.")
        raise HTTPException(status_code=502, detail=result.get("description", "Telegram could not deliver the message."))
    message_result = result.get("result")
    message_id = message_result.get("message_id") if isinstance(message_result, dict) else None
    return {"ok": True, "message_id": message_id}


@app.get("/")
def root():
    return {"name": "AI Trading Dashboard API", "status": "online", "market_data": "live when provider is available"}


@app.get("/api/health")
def health():
    if os.environ.get("VERCEL") and not DATABASE_URL:
        return {
            "status": "ok",
            "service": "backend",
            "database": "not_configured",
            "persistent_storage": False,
        }
    database_status = "postgresql" if DATABASE_URL else "sqlite"
    try:
        with _auth_connection() as connection:
            _execute(connection, "SELECT 1")
    except psycopg.Error as error:
        if not DATABASE_URL:
            raise
        raise HTTPException(
            status_code=503,
            detail="The configured PostgreSQL database is unavailable.",
        ) from error
    return {
        "status": "ok",
        "service": "backend",
        "database": database_status,
        "persistent_storage": bool(DATABASE_URL) or not os.environ.get("VERCEL"),
    }


@app.get("/api/markets")
def markets():
    result = []
    for symbol in SYMBOLS:
        df, live = market_frame(symbol, 80, live=True)
        price = float(df.close.iloc[-1])
        prev = float(df.close.iloc[-2]) if len(df) > 1 else price
        result.append({"symbol": symbol, "price": round(price, 4), "change": round((price / prev - 1) * 100, 2), "live": live})
    return result

@app.get("/api/market/{symbol:path}")
def market(
    symbol: str,
    interval: str = Query("5m", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
):
    df, live = market_frame(symbol, 500, live=True, interval=interval)
    price = float(df.close.iloc[-1])
    prev = float(df.close.iloc[-2]) if len(df) > 1 else price
    return {
        "symbol": symbol,
        "timeframe": interval,
        "price": price,
        "change": (price / prev - 1) * 100,
        "live": live,
        "data_source": "Yahoo Finance chart history" if live else "Synthetic demo data",
        "delay_note": "Yahoo Finance data can be delayed and is not an exchange-grade real-time feed." if live else "Live provider unavailable; these values are synthetic demo data, not market quotes.",
        "updated_at": pd.Timestamp(df.time.iloc[-1]).isoformat(),
        "series": [{"time": pd.Timestamp(x).strftime("%d %b %H:%M"), "timestamp": pd.Timestamp(x).isoformat(), "open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": float(v), "sma20": float(sma) if pd.notna(sma) else None} for x,o,h,l,c,v,sma in zip(df.time,df.open,df.high,df.low,df.close,df.volume,df.sma20)],
        "indicators": {"rsi": round(float(df.rsi.iloc[-1]), 2), "macd": round(float(df.macd.iloc[-1]), 4), "sma20": round(float(df.sma20.iloc[-1]), 2)},
    }

@app.get("/api/signal/{symbol:path}")
def signal(
    symbol: str,
    strategy: str = Query("EMA Trend Pullback"),
    strategy_id: int | None = Query(default=None, ge=1),
    interval: str = Query("5m", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
    authorization: str | None = Header(default=None),
):
    strategy_definition = None
    if strategy_id is not None:
        user_id = _authenticated_user_id(authorization)
        with _auth_connection() as connection:
            saved_strategy = _execute(connection, "SELECT * FROM strategies WHERE id = ? AND user_id = ? AND active = 1", (strategy_id, user_id)).fetchone()
        if saved_strategy is None:
            raise HTTPException(status_code=404, detail="Active custom strategy not found.")
        strategy = saved_strategy["name"]
        strategy_definition = json.loads(saved_strategy["definition"])
        if strategy_definition.get("direction", "Long") != "Long":
            raise HTTPException(status_code=422, detail="Custom signals currently support long-only strategies.")
        strategy = "custom"
    if strategy not in STRATEGIES and strategy not in STRATEGIES.values() and strategy != "custom":
        raise HTTPException(status_code=422, detail=f"Unsupported strategy. Choose one of: {', '.join(STRATEGIES)}.")
    df, live = market_frame(symbol, 200, live=True, interval=interval)
    if not live:
        return {
            "symbol": symbol,
            "timeframe": interval,
            "live": False,
            "data_source": "Synthetic demo data",
            "signal": "HOLD",
            "setup_status": "NO_LIVE_DATA",
            "reference_price": None,
            "entry_price": None,
            "stop_loss": None,
            "target_price": None,
            "risk_reward": None,
            "atr_14": None,
            "strategy": saved_strategy["name"] if strategy_id is not None else strategy,
            "rule": STRATEGIES.get(strategy, strategy),
            "rule_triggered": "No signal generated because live historical data is unavailable.",
            "note": "Synthetic demo candles are for chart display only and are never used to generate signals.",
        }
    result = generate_signal(df, strategy, strategy_definition)
    if strategy_id is not None:
        result["strategy"] = saved_strategy["name"]
    return {"symbol": symbol, "timeframe": interval, "live": live, "data_source": "Yahoo Finance chart history" if live else "Synthetic demo data", **result}

@app.get("/api/options/signal/{underlying}")
def options_signal(
    underlying: str,
    trade_type: str = Query("INTRADAY", pattern="^(INTRADAY|BTST|STBT)$"),
    authorization: str | None = Header(default=None),
):
    current_user(authorization)
    return get_live_option_signal(underlying.upper(), trade_type)

@app.post("/api/backtest")
def backtest(
    symbol: str = Query("NIFTY 50"),
    initial_capital: float = Query(100000, gt=0),
    timeframe: str = Query("15m", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
    duration: int = Query(5, ge=1, le=3650),
    duration_unit: str = Query("days", pattern="^(days|months|years)$"),
    strategy: str = Query("Price Action Break & Retest"),
    strategy_id: int | None = Query(default=None, ge=1),
    position_size: float = Query(1000, gt=0),
    stop_loss_pct: float = Query(1.5, ge=0, le=100),
    take_profit_rr: float | None = Query(default=None, gt=0, le=100),
    fee_bps: float = Query(10, ge=0, le=1000),
    authorization: str | None = Header(default=None),
):
    strategy_definition = None
    strategy_name = strategy
    if strategy_id is not None:
        user_id = _authenticated_user_id(authorization)
        with _auth_connection() as connection:
            saved_strategy = _execute(connection, "SELECT * FROM strategies WHERE id = ? AND user_id = ?", (strategy_id, user_id)).fetchone()
        if saved_strategy is None:
            raise HTTPException(status_code=404, detail="Custom strategy not found.")
        strategy_name = saved_strategy["name"]
        strategy_definition = json.loads(saved_strategy["definition"])
        if strategy_definition.get("direction", "Long") != "Long":
            raise HTTPException(status_code=422, detail="Custom backtests currently support long-only strategies.")
        strategy = "custom"
    if strategy not in STRATEGIES and strategy not in STRATEGIES.values() and strategy != "custom":
        raise HTTPException(status_code=422, detail=f"Unsupported strategy. Choose one of: {', '.join(STRATEGIES)}.")
    max_duration = _max_duration(timeframe, duration_unit)
    if duration > max_duration:
        raise HTTPException(
            status_code=422,
            detail=f"Duration cannot exceed {max_duration} {duration_unit} for {timeframe} timeframe.",
        )
    df, live = market_frame(symbol, 6000, live=True, interval=timeframe)
    if not live:
        raise HTTPException(
            status_code=503,
            detail="Live historical data is unavailable. Synthetic demo candles are not used for backtests.",
        )
    cutoff = pd.Timestamp.now(tz="UTC") - _duration_offset(duration, duration_unit)
    timestamps = pd.to_datetime(df["time"], utc=True)
    in_period = timestamps >= cutoff
    if not in_period.any():
        raise HTTPException(status_code=502, detail="No market data is available for the selected backtest period.")
    start_index = int(in_period.to_numpy().argmax())
    result = {
        **run_backtest(
            df, initial_capital, strategy, position_size, stop_loss_pct, fee_bps, start_index,
            strategy_definition,
            take_profit_rr if take_profit_rr is not None else (strategy_definition or {}).get("risk_settings", {}).get("target_r"),
        ),
        "symbol": symbol,
        "strategy": strategy_name,
        "strategy_id": strategy_id,
        "timeframe": timeframe,
        "duration": duration,
        "duration_unit": duration_unit,
        "history_period": TIMEFRAME_HISTORY[timeframe],
        "data_source": "Yahoo Finance chart history (delay possible)",
        "bar_count": len(df) - start_index,
        "period_start": pd.Timestamp(df.time.iloc[start_index]).isoformat(),
        "period_end": pd.Timestamp(df.time.iloc[-1]).isoformat(),
        "warning": "Yahoo Finance history may be delayed and may be adjusted; this is not exchange-authoritative data. Model excludes taxes, brokerage schedules, lot-size constraints, and market impact.",
    }
    if authorization:
        user_id = _authenticated_user_id(authorization)
        strategy_version = int(saved_strategy["version"]) if strategy_id is not None else 0
        strategy_snapshot = strategy_definition or {"name": strategy_name, "rule": strategy}
        created_at = datetime.now(timezone.utc).isoformat()
        with _auth_connection() as connection:
            if DATABASE_URL:
                row = _execute(connection, """
                    INSERT INTO backtest_runs (user_id, strategy_id, strategy_name, strategy_version, strategy_snapshot, result, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """, (user_id, strategy_id, strategy_name, strategy_version, json.dumps(strategy_snapshot), json.dumps(result), created_at)).fetchone()
                saved_backtest_id = int(row["id"])
            else:
                cursor = _execute(connection, """
                    INSERT INTO backtest_runs (user_id, strategy_id, strategy_name, strategy_version, strategy_snapshot, result, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (user_id, strategy_id, strategy_name, strategy_version, json.dumps(strategy_snapshot), json.dumps(result), created_at))
                saved_backtest_id = int(cursor.lastrowid)
        result["saved_backtest_id"] = saved_backtest_id
    return result

@app.get("/api/risk")
def risk():
    return {"stop_loss": 2.0, "max_drawdown": 8.0, "daily_loss_limit": 5000, "alert_enabled": True}

__all__ = ["app"]
