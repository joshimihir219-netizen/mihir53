import argparse
from datetime import datetime, timezone
import os
import secrets

import main


def promote_first_admin(username):
    with main._auth_connection() as connection:
        existing_admin = main._execute(connection, "SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").fetchone()
        if existing_admin:
            raise RuntimeError("An administrator already exists. Use the admin user-management page for later role changes.")
        user = main._execute(connection, "SELECT id, username, account_status FROM users WHERE LOWER(username) = LOWER(?)", (username.strip(),)).fetchone()
        if user is None:
            raise RuntimeError("No existing account matches that username. Create and verify the account through the normal website first.")
        if user["account_status"] != "ACTIVE":
            raise RuntimeError("A suspended account cannot be promoted. Restore it through an administrator first.")
        user_id = int(user["id"])
        main._execute(connection, "UPDATE users SET role = 'ADMIN' WHERE id = ?", (user_id,))
        main._record_admin_activity(connection, user_id, "ADMIN_BOOTSTRAPPED", "user", user_id, {"username": user["username"]})
    return user["username"]


def create_first_admin(username, password):
    username = username.strip()
    if not 3 <= len(username) <= 50:
        raise RuntimeError("The initial admin username must be between 3 and 50 characters.")
    if not 12 <= len(password) <= 128:
        raise RuntimeError("The initial admin password must be between 12 and 128 characters.")

    with main._auth_connection() as connection:
        if main._execute(connection, "SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").fetchone():
            raise RuntimeError("An administrator already exists. Use the admin user-management page for later role changes.")
        if main._execute(connection, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)).fetchone():
            raise RuntimeError("That username already belongs to an account. Use the existing-account promotion command instead.")

        created_at = datetime.now(timezone.utc).isoformat()
        salt = secrets.token_bytes(16)
        password_hash = main._hash_password(password, salt)
        if main.DATABASE_URL:
            row = main._execute(connection, """
                INSERT INTO users (username, password_salt, password_hash, created_at, password_updated_at, role, account_status)
                VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE') RETURNING id
            """, (username, salt, password_hash, created_at, created_at)).fetchone()
            user_id = int(row["id"])
        else:
            cursor = main._execute(connection, """
                INSERT INTO users (username, password_salt, password_hash, created_at, password_updated_at, role, account_status)
                VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE')
            """, (username, salt, password_hash, created_at, created_at))
            user_id = int(cursor.lastrowid)
        main._record_admin_activity(connection, user_id, "ADMIN_BOOTSTRAPPED", "user", user_id, {"username": username})
    return username


def create_first_admin_from_environment():
    if "ADMIN_USERNAME" in os.environ or "ADMIN_PASSWORD" in os.environ:
        username = os.environ.get("ADMIN_USERNAME", "")
        password = os.environ.get("ADMIN_PASSWORD", "")
    else:
        username = os.environ.get("TRADEMIND_INITIAL_ADMIN_USERNAME", "")
        password = os.environ.get("TRADEMIND_INITIAL_ADMIN_PASSWORD", "")
    if not username or not password:
        raise RuntimeError("Set ADMIN_USERNAME and ADMIN_PASSWORD in the environment.")
    return create_first_admin(username, password)


def main_cli():
    parser = argparse.ArgumentParser(description="Create or promote the first TradeMind administrator.")
    parser.add_argument("username", nargs="?", help="Promote an existing account instead of creating one from environment variables")
    parser.add_argument("--local", action="store_true", help="Allow creating or promoting an account in local SQLite")
    arguments = parser.parse_args()
    if not main.DATABASE_URL and not arguments.local:
        parser.error("Set DATABASE_URL to the target persistent database. Pass --local only when you intend to modify local SQLite.")
    try:
        if arguments.username:
            username = promote_first_admin(arguments.username)
        else:
            username = create_first_admin_from_environment()
    except RuntimeError as error:
        parser.error(str(error))
    print(f"First administrator is ready: '{username}'. Password credentials are not displayed.")


if __name__ == "__main__":
    main_cli()