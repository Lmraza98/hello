"""
Build script for Hello Lead Engine / LeadPilot launcher.

Creates a standalone desktop app bundle with the frontend built-in and
the LeadPilot bridge launcher.
"""
import subprocess
import sys
import shutil
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent
LAUNCHER_ENTRY = PROJECT_ROOT / "launcher.py"


def run_cmd(cmd, cwd=None):
    """Run a command and print output."""
    print(f"\n> {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, shell=True)
    if result.returncode != 0:
        print(f"Command failed with code {result.returncode}")
        sys.exit(1)


def build_frontend():
    """Build the React frontend."""
    ui_dir = PROJECT_ROOT / 'ui'
    
    if not (ui_dir / 'node_modules').exists():
        print("\n📦 Installing frontend dependencies...")
        run_cmd(['npm', 'install'], cwd=ui_dir)
    
    print("\n🔨 Building frontend...")
    run_cmd(['npm', 'run', 'build'], cwd=ui_dir)
    
    # The build output should be in ui/dist
    if not (ui_dir / 'dist').exists():
        print("❌ Frontend build failed - no dist folder")
        sys.exit(1)
    
    print("✅ Frontend built successfully")


def install_dependencies():
    """Install Python dependencies."""
    print("\n📦 Installing Python dependencies...")
    run_cmd([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
    
    # Install Playwright browsers
    print("\n🌐 Installing Playwright browsers...")
    runtime_dir = PROJECT_ROOT / "runtime"
    runtime_dir.mkdir(exist_ok=True)
    env = os.environ.copy()
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(runtime_dir / "playwright")
    run_cmd([sys.executable, '-m', 'playwright', 'install', 'chromium'], cwd=PROJECT_ROOT)


def build_exe():
    """Build the launcher with PyInstaller."""
    print("\n🔨 Building launcher with PyInstaller...")

    # Clean previous builds
    for folder in ["build", "dist"]:
        path = PROJECT_ROOT / folder
        if path.exists():
            shutil.rmtree(path)

    # Use onedir for easier resource bundling
    run_cmd(
        [
            "pyinstaller",
            "--noconfirm",
            "--onedir",
            "--name",
            "LeadPilot",
            str(LAUNCHER_ENTRY),
        ]
    )

    exe_path = PROJECT_ROOT / "dist" / "LeadPilot" / ("LeadPilot.exe" if sys.platform.startswith("win") else "LeadPilot")
    if exe_path.exists():
        print(f"\n✅ Build successful!")
        print(f"   Output: {exe_path}")
        print(f"   Size: {exe_path.stat().st_size / 1024 / 1024:.1f} MB")
    else:
        print("❌ Build failed - launcher not found")
        sys.exit(1)


def create_installer_files():
    """Create additional files needed for the installer."""
    dist_dir = PROJECT_ROOT / "dist" / "LeadPilot"

    # Create a simple batch file for running without install
    if sys.platform.startswith("win"):
        batch_content = """@echo off
echo Starting LeadPilot...
start "" "%~dp0LeadPilot.exe"
"""
        (dist_dir / "Start LeadPilot.bat").write_text(batch_content)

    # Copy .env.example
    env_example = PROJECT_ROOT / ".env.example"
    if env_example.exists():
        shutil.copy(env_example, dist_dir / ".env.example")

    # Copy UI build output
    ui_dist = PROJECT_ROOT / "ui" / "dist"
    if ui_dist.exists():
        target = dist_dir / "ui" / "dist"
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(ui_dist, target)

    # Copy OpenClaw source (bridge dependency) for now
    openclaw_src = PROJECT_ROOT / "openclaw"
    if openclaw_src.exists():
        if not (openclaw_src / "node_modules").exists():
            print("⚠️  openclaw/node_modules not found. Run `pnpm install` in openclaw before packaging.")
        target = dist_dir / "openclaw"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(openclaw_src, target)

    # Copy Playwright browser runtime
    runtime_playwright = PROJECT_ROOT / "runtime" / "playwright"
    if runtime_playwright.exists():
        target = dist_dir / "runtime" / "playwright"
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(runtime_playwright, target)

    # Copy bundled Node runtime if provided
    runtime_node = PROJECT_ROOT / "runtime" / "node"
    if runtime_node.exists():
        target = dist_dir / "runtime" / "node"
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(runtime_node, target)

    # Create data folder
    (dist_dir / "data").mkdir(exist_ok=True)

    print("✅ Installer files created")


def main():
    print("=" * 50)
    print("  LinkedIn Scraper - Build Script")
    print("=" * 50)
    
    # Step 1: Build frontend
    build_frontend()
    
    # Step 2: Install Python dependencies
    install_dependencies()
    
    # Step 3: Build executable
    build_exe()
    
    # Step 4: Create installer files
    create_installer_files()
    
    print("\n" + "=" * 50)
    print("  BUILD COMPLETE!")
    print("=" * 50)
    print("\nNext steps:")
    print("1. Copy dist/ folder to target machine")
    print("2. Run LinkedInScraper.exe")
    print("3. Configure .env with API keys")


if __name__ == '__main__':
    main()
