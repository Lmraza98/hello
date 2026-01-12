"""
Build script for LinkedIn Scraper

Creates a standalone Windows executable with the frontend built-in.

Usage:
    python build.py

Output:
    dist/LinkedInScraper.exe
"""
import subprocess
import sys
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent


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
    run_cmd([sys.executable, '-m', 'playwright', 'install', 'chromium'])


def build_exe():
    """Build the executable with PyInstaller."""
    print("\n🔨 Building executable with PyInstaller...")
    
    # Clean previous builds
    for folder in ['build', 'dist']:
        path = PROJECT_ROOT / folder
        if path.exists():
            shutil.rmtree(path)
    
    run_cmd(['pyinstaller', 'linkedin_scraper.spec', '--clean'])
    
    exe_path = PROJECT_ROOT / 'dist' / 'LinkedInScraper.exe'
    if exe_path.exists():
        print(f"\n✅ Build successful!")
        print(f"   Output: {exe_path}")
        print(f"   Size: {exe_path.stat().st_size / 1024 / 1024:.1f} MB")
    else:
        print("❌ Build failed - no exe found")
        sys.exit(1)


def create_installer_files():
    """Create additional files needed for the installer."""
    # Create a simple batch file for running without install
    batch_content = '''@echo off
echo Starting LinkedIn Scraper...
start "" "%~dp0LinkedInScraper.exe"
'''
    (PROJECT_ROOT / 'dist' / 'Start LinkedIn Scraper.bat').write_text(batch_content)
    
    # Copy .env.example
    env_example = PROJECT_ROOT / '.env.example'
    if env_example.exists():
        shutil.copy(env_example, PROJECT_ROOT / 'dist' / '.env.example')
    
    # Create data folder
    (PROJECT_ROOT / 'dist' / 'data').mkdir(exist_ok=True)
    
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


