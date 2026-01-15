"""
Salesforce bulk import service for importing contacts via Data Import Wizard.
"""
import csv
import io
import asyncio
from typing import List, Dict
from pathlib import Path
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
import database as db
from services.name_normalizer import normalize_name


class SalesforceBulkImporter:
    """Browser automation for Salesforce Data Import Wizard."""
    
    def __init__(self):
        self.browser = None
        self.context = None
        self.page = None
        self.is_authenticated = False
    
    async def start(self, headless: bool = False):
        """Start browser with persistent session."""
        playwright = await async_playwright().start()
        
        self.browser = await playwright.chromium.launch(
            headless=headless,
            slow_mo=100
        )
        
        # Load existing session if available
        storage_path = config.SALESFORCE_STORAGE_STATE
        if storage_path.exists():
            self.context = await self.browser.new_context(
                storage_state=str(storage_path),
                viewport={'width': 1920, 'height': 1080}
            )
        else:
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )
        
        self.page = await self.context.new_page()
        await self._check_auth()
    
    async def stop(self):
        """Stop browser and save session."""
        if self.context:
            await self.context.storage_state(path=str(config.SALESFORCE_STORAGE_STATE))
            await self.context.close()
        if self.browser:
            await self.browser.close()
    
    async def _check_auth(self) -> bool:
        """Check if authenticated to Salesforce."""
        try:
            await self.page.goto(f"{config.SALESFORCE_URL}/lightning/page/home", timeout=30000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            
            url = self.page.url.lower()
            auth_pages = ['login', 'secur', 'verification', 'identity', 'mfa', '2fa']
            
            if any(page in url for page in auth_pages):
                self.is_authenticated = False
                return False
            
            lightning = self.page.locator('.slds-global-header, .oneGlobalNav')
            if await lightning.count() > 0:
                self.is_authenticated = True
                return True
        except:
            pass
        
        self.is_authenticated = False
        return False
    
    async def bulk_import_leads(self, contacts: List[Dict]) -> Dict:
        """
        Import contacts to Salesforce using Data Import Wizard.
        
        Args:
            contacts: List of contact dicts with name, email, company_name, title, etc.
        
        Returns:
            Dict with success count and any errors
        """
        if not self.is_authenticated:
            raise Exception("Not authenticated to Salesforce")
        
        # Format contacts for Salesforce import
        sf_rows = []
        for contact in contacts:
            name = contact.get('name', '')
            normalized = normalize_name(name)
            
            sf_row = {
                'Name': name,
                'First Name': normalized.first or 'Unknown',
                'Last Name': normalized.last or 'Contact',
                'Email': contact.get('email', ''),
                'Title': contact.get('title', ''),
                'Company': contact.get('company_name', ''),
                'Website': f"https://{contact.get('domain', '')}" if contact.get('domain') else '',
            }
            sf_rows.append(sf_row)
        
        # Create CSV in memory
        output = io.StringIO()
        fieldnames = ['Name', 'First Name', 'Last Name', 'Email', 'Title', 'Company', 'Website']
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sf_rows)
        
        csv_content = output.getvalue()
        
        # Save CSV to temp file
        temp_csv = config.DATA_DIR / f"sf_import_{asyncio.get_event_loop().time()}.csv"
        with open(temp_csv, 'w', newline='', encoding='utf-8') as f:
            f.write(csv_content)
        
        try:
            # Navigate to Data Import Wizard
            print("[SF Bulk Import] Navigating to Data Import Wizard...")
            await self.page.goto(f"{config.SALESFORCE_URL}/lightning/setup/DataManagement/home", timeout=30000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            await asyncio.sleep(2)
            
            # Click "Import Data" or "Data Import Wizard" link
            import_link = self.page.get_by_text('Data Import Wizard').or_(
                self.page.get_by_text('Import Data')
            ).or_(
                self.page.locator('a[href*="DataManagement"]')
            ).first
            
            try:
                await import_link.click(timeout=10000)
                await self.page.wait_for_load_state('networkidle', timeout=15000)
                await asyncio.sleep(2)
            except:
                # Try direct navigation
                await self.page.goto(f"{config.SALESFORCE_URL}/lightning/setup/DataManagement/page?address=%2Fui%2Fsetup%2Fdata%2FDataManagement%2Fd%2FDataManagementPage%2Fd", timeout=30000)
                await self.page.wait_for_load_state('networkidle', timeout=15000)
                await asyncio.sleep(2)
            
            # Step 1: Select object (Leads)
            print("[SF Bulk Import] Selecting Leads object...")
            leads_option = self.page.get_by_text('Leads').or_(
                self.page.locator('input[value="Lead"]')
            ).first
            await leads_option.click(timeout=10000)
            await asyncio.sleep(1)
            
            # Click Next
            next_btn = self.page.get_by_role('button', name='Next').or_(
                self.page.locator('button:has-text("Next")')
            ).first
            await next_btn.click(timeout=10000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            await asyncio.sleep(2)
            
            # Step 2: Upload CSV file
            print("[SF Bulk Import] Uploading CSV file...")
            file_input = self.page.locator('input[type="file"]')
            await file_input.set_input_files(str(temp_csv))
            await asyncio.sleep(2)
            
            # Click Next
            next_btn = self.page.get_by_role('button', name='Next').or_(
                self.page.locator('button:has-text("Next")')
            ).first
            await next_btn.click(timeout=10000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            await asyncio.sleep(3)
            
            # Step 3: Map fields (may need manual mapping in some orgs)
            print("[SF Bulk Import] Mapping fields...")
            # Salesforce usually auto-maps common fields, but we may need to handle mapping
            
            # Click Next to proceed
            next_btn = self.page.get_by_role('button', name='Next').or_(
                self.page.locator('button:has-text("Next")')
            ).first
            await next_btn.click(timeout=10000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            await asyncio.sleep(2)
            
            # Step 4: Start import
            print("[SF Bulk Import] Starting import...")
            start_btn = self.page.get_by_role('button', name='Start Import').or_(
                self.page.locator('button:has-text("Start Import")')
            ).or_(
                self.page.locator('button:has-text("Import")')
            ).first
            await start_btn.click(timeout=10000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            await asyncio.sleep(3)
            
            # Wait for import to complete (check for success message)
            print("[SF Bulk Import] Waiting for import to complete...")
            success_indicator = self.page.get_by_text('completed').or_(
                self.page.get_by_text('successful')
            ).or_(
                self.page.locator('.success')
            )
            
            try:
                await success_indicator.wait_for(state='visible', timeout=60000)
                print("[SF Bulk Import] Import completed successfully!")
            except:
                print("[SF Bulk Import] Import may still be processing...")
            
            return {
                'success': True,
                'imported': len(sf_rows),
                'message': 'Import started successfully'
            }
            
        except Exception as e:
            print(f"[SF Bulk Import] Error: {e}")
            return {
                'success': False,
                'imported': 0,
                'error': str(e)
            }
        finally:
            # Clean up temp file
            if temp_csv.exists():
                temp_csv.unlink()


async def bulk_import_to_salesforce(contacts: List[Dict], headless: bool = False) -> Dict:
    """
    Convenience function to bulk import contacts to Salesforce.
    
    Args:
        contacts: List of contact dicts
        headless: Run browser in headless mode
    
    Returns:
        Dict with import results
    """
    importer = SalesforceBulkImporter()
    
    try:
        await importer.start(headless=headless)
        
        if not importer.is_authenticated:
            return {
                'success': False,
                'error': 'Not authenticated to Salesforce'
            }
        
        return await importer.bulk_import_leads(contacts)
        
    finally:
        await importer.stop()


