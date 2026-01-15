# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for LinkedIn Scraper

Build with: pyinstaller linkedin_scraper.spec
"""

import sys
from pathlib import Path

block_cipher = None

# Get the project root
project_root = Path(SPECPATH)

# Collect all Python files
py_files = list(project_root.glob('*.py'))
py_files.extend(project_root.glob('services/*.py'))
py_files.extend(project_root.glob('scripts/*.py'))

# Data files to include
datas = [
    ('ui/dist', 'ui/dist'),  # Built frontend
    ('data', 'data'),  # Data directory
    ('.env.example', '.'),  # Example env file
]

# Hidden imports that PyInstaller might miss
hidden_imports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'starlette',
    'pydantic',
    'openai',
    'playwright',
    'pystray',
    'PIL',
    'PIL.Image',
    'PIL.ImageDraw',
    'requests',
    'rich',
    'typer',
    'dotenv',
    'sqlite3',
]

a = Analysis(
    ['app.py'],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='LinkedInScraper',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico' if Path('icon.ico').exists() else None,
)



