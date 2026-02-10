"""
Automated Company Collector: Uses GPT-4 to parse queries and Sales Navigator to collect companies.
"""
import asyncio
from typing import List, Dict, Optional
from pathlib import Path

from services.salesnav_filter_parser import SalesNavFilterParser
from services.linkedin.scraper import SalesNavigatorScraper
import database as db
import config


class CompanyCollector:
    """
    Automated company collection from LinkedIn Sales Navigator.
    
    Example usage:
        collector = CompanyCollector()
        companies = await collector.collect_companies(
            query="Construction companies in New England",
            max_companies=100
        )
    """
    
    def __init__(self):
        self.filter_parser = SalesNavFilterParser()
        self.scraper = None
    
    async def collect_companies(
        self,
        query: str,
        max_companies: int = 100,
        headless: bool = False,
        save_to_db: bool = True,
        on_page_ready=None
    ) -> Dict:
        """
        Collect companies from Sales Navigator based on a natural language query.
        
        Args:
            query: Natural language query like "Construction companies in New England"
            max_companies: Maximum number of companies to collect
            headless: Run browser in headless mode
            save_to_db: Whether to save companies to database
            
        Returns:
            Dictionary with companies list and metadata
        """
        result = {
            'query': query,
            'companies': [],
            'filters_applied': {},
            'status': 'pending',
            'error': None
        }
        
        try:
            # Step 1: Parse query into filters using GPT-4
            print(f"\n[Company Collector] Parsing query: {query}")
            filters = self.filter_parser.parse_query(query)
            result['filters_applied'] = filters
            print(f"[Company Collector] Parsed filters: {filters}")
            
            # Step 2: Start scraper
            self.scraper = SalesNavigatorScraper()
            await self.scraper.start(headless=headless)
            
            if not self.scraper.is_authenticated:
                print("[Company Collector] Authentication required...")
                if not await self.scraper.wait_for_login():
                    result['status'] = 'auth_failed'
                    result['error'] = 'Login timeout'
                    return result
            
            # Notify caller that the browser page is ready (e.g. for live streaming)
            if on_page_ready and self.scraper.page:
                on_page_ready(self.scraper.page)
            
            # Step 3: Search and scrape companies
            print(f"[Company Collector] Collecting up to {max_companies} companies...")
            companies = await self.scraper.search_companies_with_filters(
                filters=filters,
                max_companies=max_companies
            )
            
            result['companies'] = companies
            result['status'] = 'success'
            print(f"[Company Collector] Collected {len(companies)} companies")
            
            # Step 4: Save to database if requested
            if save_to_db and companies:
                saved_count = self._save_companies_to_db(companies, query)
                result['saved_count'] = saved_count
                print(f"[Company Collector] Saved {saved_count} companies to database")
            
        except Exception as e:
            print(f"[Company Collector] Error: {e}")
            result['status'] = 'error'
            result['error'] = str(e)
        
        finally:
            if self.scraper:
                await self.scraper.stop()
        
        return result
    
    def _save_companies_to_db(self, companies: List[Dict], source_query: str) -> int:
        """
        Save collected companies to the database.
        
        Args:
            companies: List of company dictionaries
            source_query: The original query that generated these companies
            
        Returns:
            Number of companies saved
        """
        saved_count = 0
        
        with db.get_db() as conn:
            cursor = conn.cursor()
            
            for company in companies:
                try:
                    company_name = company.get('company_name')
                    if not company_name:
                        continue
                    
                    # Generate domain from company name if not available
                    domain = company.get('domain')
                    if not domain:
                        import re
                        domain = re.sub(r'[\W_]+', '-', company_name.lower()).strip('-')
                    
                    # Extract vertical from industry
                    vertical = company.get('industry')
                    
                    # Check if company already exists
                    cursor.execute(
                        "SELECT id FROM targets WHERE domain = ? OR company_name = ?",
                        (domain, company_name)
                    )
                    existing = cursor.fetchone()
                    
                    if existing:
                        # Update existing record
                        cursor.execute("""
                            UPDATE targets 
                            SET company_name = ?, vertical = ?, source = ?, notes = ?
                            WHERE id = ?
                        """, (
                            company_name,
                            vertical,
                            'salesnav_automated',
                            f"Collected via query: {source_query}",
                            existing[0]
                        ))
                    else:
                        # Insert new record
                        cursor.execute("""
                            INSERT INTO targets (
                                domain, company_name, vertical, source, notes, status
                            ) VALUES (?, ?, ?, ?, ?, 'pending')
                        """, (
                            domain,
                            company_name,
                            vertical,
                            'salesnav_automated',
                            f"Collected via query: {source_query}"
                        ))
                    
                    saved_count += 1
                    
                except Exception as e:
                    print(f"[Company Collector] Error saving company {company.get('company_name')}: {e}")
                    continue
        
        return saved_count


async def collect_companies_from_query(
    query: str,
    max_companies: int = 100,
    headless: bool = False,
    save_to_db: bool = True,
    on_page_ready=None
) -> Dict:
    """
    Convenience function to collect companies from a natural language query.
    
    Args:
        query: Natural language query like "Construction companies in New England"
        max_companies: Maximum number of companies to collect
        headless: Run browser in headless mode
        save_to_db: Whether to save companies to database
        on_page_ready: Optional callback(page) invoked when the browser page is ready
        
    Returns:
        Dictionary with companies list and metadata
    """
    collector = CompanyCollector()
    return await collector.collect_companies(
        query=query,
        max_companies=max_companies,
        headless=headless,
        save_to_db=save_to_db,
        on_page_ready=on_page_ready
    )


