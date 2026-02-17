"""Utility helpers for contact route modules."""

import subprocess
import sys

import config


def launch_salesforce_upload() -> None:
    """Launch Salesforce upload helper in a separate console window."""
    script_path = config.BASE_DIR / "services" / "salesforce" / "upload.py"
    subprocess.Popen(
        [sys.executable, str(script_path)],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )

