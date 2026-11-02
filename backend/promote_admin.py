import argparse

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


def main_cli():
    parser = argparse.ArgumentParser(description="Promote one existing TradeMind account to the first administrator.")
    parser.add_argument("username", help="Username of the existing account to promote")
    parser.add_argument("--local", action="store_true", help="Allow promoting an account in the local SQLite database")
    arguments = parser.parse_args()
    if not main.DATABASE_URL and not arguments.local:
        parser.error("Set DATABASE_URL to the deployed Neon database. Pass --local only when you intend to promote a local SQLite account.")
    try:
        username = promote_first_admin(arguments.username)
    except RuntimeError as error:
        parser.error(str(error))
    print(f"Promoted existing account '{username}' to ADMIN.")


if __name__ == "__main__":
    main_cli()