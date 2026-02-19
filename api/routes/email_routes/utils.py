"""Utility helpers for email route modules."""

import subprocess
import sys
from typing import List

import config


def launch_sender(args: List[str]) -> None:
    """Launch the email sender runner in a separate console window."""
    cmd = [sys.executable, "-u", "-m", "services.orchestration.runners.email_sender_runner"] + args
    subprocess.Popen(
        cmd,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        cwd=str(config.BASE_DIR),
    )
