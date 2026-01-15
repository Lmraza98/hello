"""
Opens browser to Salesforce - waits until you close it.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

DATA_DIR = Path(__file__).parent / "data"

async def main():
    print()
    print("=" * 50)
    print("  OPENING SALESFORCE BROWSER")
    print("=" * 50)
    print()
    
    p = await async_playwright().start()
    
    browser = await p.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    
    print("  Navigating to Salesforce...")
    await page.goto("https://zcocorp.lightning.force.com/dataImporter/dataImporter.app?objectSelection=Lead")
    
    print()
    print("  *** BROWSER IS OPEN ***")
    print("  *** LOG IN AND UPLOAD YOUR CSV ***")
    print("  *** CLOSE BROWSER WHEN DONE ***")
    print()
    print(f"  CSV files are in: {DATA_DIR}")
    print()
    print("=" * 50)
    print()
    
    # Wait forever until browser is closed
    while browser.is_connected():
        await asyncio.sleep(1)
    
    # Save session
    try:
        await context.storage_state(path=str(DATA_DIR / "salesforce_auth.json"))
        print("  Session saved!")
    except:
        pass
    
    await p.stop()
    print("  Done!")

if __name__ == "__main__":
    asyncio.run(main())
