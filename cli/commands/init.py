"""
Initialize database command.
"""
import config
import database as db


def cmd_init(args):
    """Initialize database and directories."""
    db.init_database()
    print("[OK] Database initialized")
    print(f"  Database: {config.DB_PATH}")
    print(f"  Data dir: {config.DATA_DIR}")

