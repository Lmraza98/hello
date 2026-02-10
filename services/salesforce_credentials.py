"""
Salesforce credential storage with encryption.

Credentials are stored encrypted at rest using Fernet symmetric encryption.
The encryption key is derived from a machine-specific identifier to prevent
credentials from being portable between machines.
"""

import json
import hashlib
import platform
import uuid
from pathlib import Path
from typing import Optional, TypedDict

try:
    from cryptography.fernet import Fernet
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

import config


class SalesforceCredentials(TypedDict):
    username: str
    password: str


# Credential storage path
CREDENTIALS_FILE = config.DATA_DIR / "salesforce_credentials.json"


def _get_machine_key() -> bytes:
    """
    Derive a Fernet-compatible key from machine-specific identifiers.
    
    This ties the credentials to this specific machine, so they can't be
    copied to another machine and decrypted.
    """
    # Collect machine identifiers
    identifiers = [
        platform.node(),  # Hostname
        platform.machine(),  # CPU architecture
        platform.system(),  # OS name
    ]
    
    # Try to get a hardware UUID (more stable than hostname)
    try:
        # Windows: use machine GUID from registry
        if platform.system() == "Windows":
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography"
            )
            machine_guid, _ = winreg.QueryValueEx(key, "MachineGuid")
            identifiers.append(machine_guid)
        else:
            # Linux/Mac: use MAC address as fallback
            identifiers.append(str(uuid.getnode()))
    except Exception:
        # Fallback: just use what we have
        identifiers.append(str(uuid.getnode()))
    
    # Hash the identifiers to create a consistent 32-byte key
    combined = ":".join(identifiers)
    key_bytes = hashlib.sha256(combined.encode()).digest()
    
    # Fernet requires base64-encoded 32-byte key
    import base64
    return base64.urlsafe_b64encode(key_bytes)


def _get_fernet() -> Optional["Fernet"]:
    """Get a Fernet instance for encryption/decryption."""
    if not CRYPTO_AVAILABLE:
        return None
    
    key = _get_machine_key()
    return Fernet(key)


def save_credentials(username: str, password: str) -> bool:
    """
    Save Salesforce credentials encrypted to disk.
    
    Returns True on success, False on failure.
    """
    if not username or not password:
        return False
    
    fernet = _get_fernet()
    if not fernet:
        print("[SF Credentials] cryptography package not available - credentials NOT saved")
        return False
    
    try:
        # Encrypt the credentials
        data = json.dumps({
            "username": username,
            "password": password
        })
        encrypted = fernet.encrypt(data.encode())
        
        # Write to file
        CREDENTIALS_FILE.write_bytes(encrypted)
        print(f"[SF Credentials] Saved credentials for {username}")
        return True
        
    except Exception as e:
        print(f"[SF Credentials] Error saving credentials: {e}")
        return False


def get_credentials() -> Optional[SalesforceCredentials]:
    """
    Load and decrypt Salesforce credentials from disk.
    
    Returns dict with username/password, or None if not configured or error.
    """
    if not CREDENTIALS_FILE.exists():
        return None
    
    fernet = _get_fernet()
    if not fernet:
        print("[SF Credentials] cryptography package not available")
        return None
    
    try:
        encrypted = CREDENTIALS_FILE.read_bytes()
        decrypted = fernet.decrypt(encrypted)
        data = json.loads(decrypted.decode())
        
        return SalesforceCredentials(
            username=data.get("username", ""),
            password=data.get("password", "")
        )
        
    except Exception as e:
        print(f"[SF Credentials] Error reading credentials: {e}")
        return None


def clear_credentials() -> bool:
    """
    Remove stored credentials.
    
    Returns True if file was deleted, False otherwise.
    """
    try:
        if CREDENTIALS_FILE.exists():
            CREDENTIALS_FILE.unlink()
            print("[SF Credentials] Credentials cleared")
            return True
        return False
    except Exception as e:
        print(f"[SF Credentials] Error clearing credentials: {e}")
        return False


def credentials_configured() -> bool:
    """Check if credentials are saved (without decrypting)."""
    return CREDENTIALS_FILE.exists()
