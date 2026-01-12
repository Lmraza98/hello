"""
Hello - Desktop App

Simple native window app. Double-click to run, close window to stop.
Everything runs automatically - no setup needed.
"""
import sys
import threading
import time
import os
from pathlib import Path

# Set working directory to app location
APP_DIR = Path(__file__).parent
os.chdir(APP_DIR)
sys.path.insert(0, str(APP_DIR))

SERVER_PORT = 8000
server_ready = threading.Event()


def start_server():
    """Start the FastAPI server in background."""
    global server_ready
    
    try:
        # Initialize database first
        import database as db
        db.init_database()
        
        # Import and run uvicorn
        import uvicorn
        
        # Signal that we're about to start
        def on_startup():
            server_ready.set()
        
        config = uvicorn.Config(
            "api:app",
            host="127.0.0.1",
            port=SERVER_PORT,
            log_level="warning",
        )
        server = uvicorn.Server(config)
        
        # Run in a way that allows graceful shutdown
        server_ready.set()  # Set ready just before running
        server.run()
        
    except Exception as e:
        print(f"Server error: {e}")
        server_ready.set()  # Unblock waiting even on error


def wait_for_server(timeout=15):
    """Wait for the server to accept connections."""
    import requests
    
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(f"http://127.0.0.1:{SERVER_PORT}/api/stats", timeout=1)
            if r.status_code == 200:
                return True
        except:
            pass
        time.sleep(0.3)
    return False


def main():
    import webview
    
    print("Starting Hello...")
    
    # Start server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Wait for server to be ready
    print("Waiting for server...")
    if not wait_for_server(timeout=15):
        print("Warning: Server may not be fully ready")
    else:
        print("Server ready!")
    
    # Create window (frameless - no Windows title bar)
    window = webview.create_window(
        title='Hello',
        url=f'http://127.0.0.1:{SERVER_PORT}',
        width=1280,
        height=850,
        background_color='#111827',
        frameless=True,
    )
    
    # Window controls for JavaScript
    def minimize():
        window.minimize()
    def maximize():
        window.toggle_fullscreen()
    def close():
        window.destroy()
    
    window.expose(minimize, maximize, close)
    
    # Start webview (blocks until window closed)
    webview.start()
    
    print("Goodbye!")


if __name__ == '__main__':
    main()
