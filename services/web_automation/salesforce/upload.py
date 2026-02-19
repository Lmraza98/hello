"""
Salesforce Upload Browser - Automates the full import flow.
"""
import sys
import glob
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
import config

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
STORAGE_PATH = DATA_DIR / "salesforce_auth.json"

def get_latest_csv():
    """Find the most recent salesforce_import CSV file."""
    pattern = str(DATA_DIR / "salesforce_import_*.csv")
    files = glob.glob(pattern)
    if files:
        return max(files, key=lambda x: Path(x).stat().st_mtime)
    return None


def resolve_salesforce_base_url() -> str:
    """Resolve Salesforce org base URL from storage state with config fallback."""
    try:
        if STORAGE_PATH.exists():
            data = json.loads(STORAGE_PATH.read_text(encoding="utf-8"))
            origins = data.get("origins") or []
            origin_urls = [o.get("origin") for o in origins if isinstance(o, dict) and o.get("origin")]
            for origin in origin_urls:
                if "lightning.force.com" in origin:
                    return origin.rstrip("/")
            for origin in origin_urls:
                if "my.salesforce.com" in origin:
                    return origin.rstrip("/")
    except Exception as e:
        print(f"  Warning: Could not resolve Salesforce org URL from storage: {e}")
    return config.SALESFORCE_URL.rstrip("/")

def main():
    print()
    print("=" * 60)
    print("  SALESFORCE DATA IMPORTER - AUTOMATED")
    print("=" * 60)
    print()
    
    # Find the CSV file to upload
    csv_file = get_latest_csv()
    if csv_file:
        print(f"  CSV file: {csv_file}")
    else:
        print("  WARNING: No CSV file found!")
    print()
    print("  Starting browser...")
    sf_base_url = resolve_salesforce_base_url()
    print(f"  Salesforce base URL: {sf_base_url}")
    
    with sync_playwright() as p:
        # Launch browser - NOT headless
        browser = p.chromium.launch(headless=False)
        
        # Create context (with saved session if exists)
        if STORAGE_PATH.exists():
            print("  Loading saved session...")
            context = browser.new_context(storage_state=str(STORAGE_PATH))
        else:
            print("  Creating new session...")
            context = browser.new_context()
        
        page = context.new_page()
        
        # Navigate to Salesforce Data Importer
        print("  Navigating to Salesforce...")
        page.goto(f"{sf_base_url}/dataImporter/dataImporter.app?objectSelection=Lead")
        
        print()
        print("  BROWSER IS OPEN - Log in if prompted")
        print()
        
        # Step tracking
        step_leads = False
        step_add_new = False
        step_csv = False
        step_file = False
        step_next = False
        step_next2 = False
        step_import = False
        step_ok = False
        step_results = False
        import_results = {}
        
        while browser.is_connected():
            try:
                # STEP 1: Click on "Leads"
                if not step_leads:
                    leads_link = page.locator('a.lv-link:has-text("Leads")').first
                    if leads_link.is_visible(timeout=1000):
                        print("  [1/4] Clicking 'Leads'...")
                        leads_link.click()
                        step_leads = True
                        page.wait_for_timeout(2000)
                        continue
                
                # STEP 2: Click on "Add new records"
                if step_leads and not step_add_new:
                    add_new_link = page.locator('a.lv-link:has-text("Add new records")').first
                    if add_new_link.is_visible(timeout=1000):
                        print("  [2/4] Clicking 'Add new records'...")
                        add_new_link.click()
                        step_add_new = True
                        page.wait_for_timeout(2000)
                        continue
                
                # STEP 3: Click on "CSV" box
                if step_add_new and not step_csv:
                    # Try clicking the anchor inside the CSV selection box
                    csv_link = page.locator('.dataImporterDiCsvSelectionActivity a.stdcolor').first
                    if csv_link.is_visible(timeout=1000):
                        print("  [3/4] Clicking 'CSV'...")
                        csv_link.click()
                        step_csv = True
                        page.wait_for_timeout(2000)
                        continue
                    # Fallback: try clicking the div with CSV text
                    csv_div = page.locator('.dataImporterDiCsvFileSelector').first
                    if csv_div.is_visible(timeout=1000):
                        print("  [3/4] Clicking 'CSV' (fallback)...")
                        csv_div.click()
                        step_csv = True
                        page.wait_for_timeout(2000)
                        continue
                
                # STEP 4: Upload the CSV file
                if step_csv and not step_file and csv_file:
                    file_input = page.locator('input[type="file"][accept*="csv"]').first
                    if file_input.is_visible(timeout=1000):
                        print(f"  [4/5] Uploading CSV file...")
                        file_input.set_input_files(csv_file)
                        step_file = True
                        page.wait_for_timeout(2000)
                        continue
                
                # STEP 5: Click "Next" button (first time)
                if step_file and not step_next:
                    next_btn = page.locator('a.button.success:has-text("Next")').first
                    if next_btn.is_visible(timeout=1000):
                        print("  [5/6] Clicking 'Next'...")
                        next_btn.click()
                        step_next = True
                        page.wait_for_timeout(3000)
                        continue
                
                # STEP 6: Click "Next" button (second time)
                if step_next and not step_next2:
                    next_btn = page.locator('a.button.success:has-text("Next")').first
                    if next_btn.is_visible(timeout=1000):
                        print("  [6/7] Clicking 'Next' again...")
                        next_btn.click()
                        step_next2 = True
                        page.wait_for_timeout(3000)
                        continue
                
                # STEP 7: Click "Start Import" button
                if step_next2 and not step_import:
                    import_btn = page.locator('a.button.success:has-text("Start Import")').first
                    if import_btn.is_visible(timeout=1000):
                        print("  [7/8] Clicking 'Start Import'...")
                        import_btn.click()
                        step_import = True
                        page.wait_for_timeout(3000)
                        continue
                
                # STEP 8: Click "OK" button on congrats dialog
                if step_import and not step_ok:
                    ok_btn = page.locator('section[role="dialog"] a.button.success:has-text("OK")').first
                    if ok_btn.is_visible(timeout=1000):
                        print("  [8/9] Clicking 'OK'...")
                        ok_btn.click()
                        step_ok = True
                        page.wait_for_timeout(3000)
                        continue
                
                # STEP 9: Capture import results from table
                if step_ok and not step_results:
                    results_table = page.locator('.dataImporterDiLanding table').first
                    if results_table.is_visible(timeout=2000):
                        print("  [9/9] Capturing import results...")
                        try:
                            # Get the first data row (most recent import)
                            first_row = page.locator('.dataImporterDiLanding table tr').nth(1)
                            cells = first_row.locator('td').all_text_contents()
                            
                            if len(cells) >= 5:
                                import_results['status'] = cells[0]      # Status
                                import_results['object'] = cells[1]       # Object
                                import_results['created'] = int(cells[2]) # Records Created
                                import_results['updated'] = int(cells[3]) # Records Updated
                                import_results['failed'] = int(cells[4])  # Records Failed
                                import_results['date'] = cells[5] if len(cells) > 5 else ''
                                
                                print()
                                print("  ╔══════════════════════════════════════╗")
                                print("  ║       SALESFORCE IMPORT RESULTS      ║")
                                print("  ╠══════════════════════════════════════╣")
                                print(f"  ║  Status:          {import_results['status']:<18} ║")
                                print(f"  ║  Records Created: {import_results['created']:<18} ║")
                                print(f"  ║  Records Updated: {import_results['updated']:<18} ║")
                                print(f"  ║  Records Failed:  {import_results['failed']:<18} ║")
                                print("  ╚══════════════════════════════════════╝")
                                print()
                        except Exception as e:
                            print(f"  Warning: Could not parse results: {e}")
                        
                        step_results = True
                        print("  You can close the browser now.")
                        continue
                
                # All steps done or waiting
                page.wait_for_timeout(2000)
                
            except KeyboardInterrupt:
                print("\n  Interrupted!")
                break
            except Exception as e:
                # Just keep waiting
                try:
                    page.wait_for_timeout(2000)
                except:
                    break
        
        # Save session before closing
        print()
        print("  Saving session...")
        try:
            context.storage_state(path=str(STORAGE_PATH))
            print(f"  Session saved to: {STORAGE_PATH}")
        except:
            pass
        
        # Mark contacts as uploaded if we successfully completed the import
        if step_results:
            print()
            print("  Updating database with import results...")
            try:
                # Find the latest batch file
                batch_pattern = str(DATA_DIR / "sf_batch_*.json")
                batch_files = glob.glob(batch_pattern)
                if batch_files:
                    latest_batch = max(batch_files, key=lambda x: Path(x).stat().st_mtime)
                    with open(latest_batch, 'r') as f:
                        batch_data = json.load(f)
                    
                    # Add import results to batch data
                    batch_data['import_results'] = import_results
                    
                    # Import database and mark contacts
                    sys.path.insert(0, str(Path(__file__).parent))
                    import database as db
                    
                    conn = db.get_connection()
                    cursor = conn.cursor()
                    contact_ids = batch_data['contact_ids']
                    
                    # Determine status based on results
                    created = import_results.get('created', 0)
                    failed = import_results.get('failed', 0)
                    
                    if failed == 0 and created > 0:
                        status = 'uploaded'
                    elif failed > 0 and created > 0:
                        status = 'partial'  # Some succeeded, some failed
                    elif failed > 0 and created == 0:
                        status = 'failed'
                    else:
                        status = 'uploaded'
                    
                    placeholders = ','.join(['?'] * len(contact_ids))
                    cursor.execute(f"""
                        UPDATE linkedin_contacts 
                        SET salesforce_status = ?,
                            salesforce_uploaded_at = ?,
                            salesforce_upload_batch = ?
                        WHERE id IN ({placeholders})
                    """, [status, batch_data['batch_timestamp'], batch_data['batch_id']] + contact_ids)
                    conn.commit()
                    conn.close()
                    
                    print(f"  ✓ Marked {len(contact_ids)} contacts as '{status}'")
                    print(f"    Created: {created}, Failed: {failed}")
                    
                    # Save results to a log file
                    results_file = DATA_DIR / f"sf_results_{batch_data['batch_id']}.json"
                    with open(results_file, 'w') as f:
                        json.dump(batch_data, f, indent=2)
                    print(f"  ✓ Results saved to: {results_file}")
                    
                    # Delete the batch file
                    Path(latest_batch).unlink()
            except Exception as e:
                print(f"  Warning: Could not update database: {e}")
        
        print("  Done!")

if __name__ == "__main__":
    main()
