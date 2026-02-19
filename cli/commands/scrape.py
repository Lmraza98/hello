"""
Scrape and enrich command - LinkedIn scraping with parallel email discovery.
"""
import asyncio
import config
import database as db
from cli.utils import calculate_grid_positions


def cmd_scrape_and_enrich(args):
    """
    Scrape LinkedIn for contacts and generate emails using parallel browsers.
    Email pattern discovery runs IN PARALLEL with scraping - as soon as a company
    is scraped, its email pattern discovery begins immediately.
    """
    tier = args.tier
    max_contacts = args.max_contacts
    num_workers = config.LINKEDIN_WORKERS  # Default: 3 parallel browsers
    
    print(f"\n=== Hello Lead Engine ===")
    print(f"Tier filter: {tier or 'All'}")
    print(f"Max contacts per company: {max_contacts}")
    print(f"LinkedIn workers: {num_workers}")
    print(f"Email discovery: Running in parallel\n")
    
    companies = db.get_pending_targets(limit=50, tier=tier)
    
    if not companies:
        print("No pending companies found.")
        print("Add companies via the UI or import a CSV.")
        return
    
    print(f"Found {len(companies)} companies to process\n")
    
    # Run the async scraping with parallel email discovery
    asyncio.run(_scrape_companies_parallel_with_email(companies, max_contacts, num_workers))


async def _scrape_companies_parallel_with_email(companies: list, max_contacts: int, num_workers: int = 2):
    """
    Scrape LinkedIn AND discover email patterns in parallel.
    
    As soon as a company is scraped:
    1. Email pattern discovery starts immediately in a background thread
    2. Public LinkedIn URLs are extracted directly from Sales Navigator (no separate browser needed)
    
    This runs 2 parallel processes:
    - Sales Navigator scraping (extracts contacts + public URLs in one pass)
    - Email pattern discovery (thread pool)
    """
    from services.web_automation.linkedin import SalesNavigatorScraper
    from services.email.discoverer import discover_email_pattern, generate_email
    from playwright.async_api import async_playwright
    from concurrent.futures import ThreadPoolExecutor
    
    print("=== Parallel Scraping + Email Discovery ===")
    print(f"Starting {num_workers} Sales Nav browsers + email thread pool...")
    
    # Storage for LinkedIn session
    LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"
    
    # Calculate grid positions for browser windows
    positions = calculate_grid_positions(num_workers)
    
    playwright = await async_playwright().start()
    
    # Create browser instances with stealth settings
    workers = []
    for i in range(num_workers):
        x, y, width, height = positions[i]
        
        browser = await playwright.chromium.launch(
            headless=False,
            slow_mo=100,
            args=[
                f'--window-position={x},{y}',
                f'--window-size={width},{height}',
                '--disable-infobars',
                '--disable-blink-features=AutomationControlled',  # Hide automation flag
                '--disable-dev-shm-usage',
                '--no-sandbox',
            ]
        )
        
        # Context with realistic browser fingerprint
        context_options = {
            'viewport': {'width': width - 20, 'height': height - 100},
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'locale': 'en-US',
            'timezone_id': 'America/New_York',
        }
        
        if LINKEDIN_STORAGE_STATE.exists():
            context_options['storage_state'] = str(LINKEDIN_STORAGE_STATE)
        
        context = await browser.new_context(**context_options)
        
        # Hide webdriver flag and add fake plugins
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            
            // Prevent extension probing from failing visibly
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                if (args[0] && args[0].toString().includes('chrome-extension://')) {
                    return Promise.reject(new Error('blocked'));
                }
                return originalFetch.apply(this, args);
            };
        """)
        
        page = await context.new_page()
        
        workers.append({
            'id': i,
            'browser': browser,
            'context': context,
            'page': page,
            'authenticated': False
        })
        print(f"  Worker {i}: Window at ({x}, {y})")
    
    print(f"✓ {num_workers} browser windows opened in grid")
    
    # Check/perform LinkedIn authentication (same as before)
    first_page = workers[0]['page']
    print("\n[LinkedIn] Checking session...")
    await first_page.goto("https://www.linkedin.com/sales/home", timeout=30000)
    await first_page.wait_for_load_state('domcontentloaded', timeout=15000)
    await asyncio.sleep(2)
    
    url = first_page.url
    is_authenticated = '/sales/' in url and 'login' not in url.lower() and 'checkpoint' not in url.lower()
    
    if not is_authenticated:
        print("\n" + "="*60)
        print("  LINKEDIN LOGIN REQUIRED")
        print("  1. Log in to LinkedIn in Browser 1")
        print("  2. Navigate to Sales Navigator")
        print(f"  You have {config.LINKEDIN_TIMEOUT_MINUTES} minutes.")
        print("="*60 + "\n")
        
        await first_page.goto("https://www.linkedin.com/login", timeout=30000)
        timeout = config.LINKEDIN_TIMEOUT_MINUTES * 60
        start = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start) < timeout:
            await asyncio.sleep(5)
            try:
                url = first_page.url
                
                # Already on Sales Navigator - success!
                if '/sales/' in url and 'login' not in url.lower():
                    print("\n[LinkedIn] Login successful - on Sales Navigator!")
                    is_authenticated = True
                    await workers[0]['context'].storage_state(path=str(LINKEDIN_STORAGE_STATE))
                    break
                
                # Logged in but on regular LinkedIn - auto-navigate to Sales Nav
                if '/feed' in url or '/in/' in url or '/mynetwork' in url:
                    print("\n[LinkedIn] Logged in! Navigating to Sales Navigator...")
                    await first_page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                    await asyncio.sleep(3)
                    
                    # Check if we made it to Sales Nav
                    if '/sales/' in first_page.url and 'login' not in first_page.url.lower():
                        print("[LinkedIn] ✓ Sales Navigator loaded!")
                        is_authenticated = True
                        await workers[0]['context'].storage_state(path=str(LINKEDIN_STORAGE_STATE))
                        break
                    else:
                        print("[LinkedIn] Sales Navigator not accessible. Do you have a subscription?")
                        
            except Exception as e:
                pass
        
        if not is_authenticated:
            print("[LinkedIn] Login timeout.")
            for worker in workers:
                try:
                    await worker['browser'].close()
                except:
                    pass
            await playwright.stop()
            return
    
    print("✓ Authenticated\n")
    workers[0]['authenticated'] = True
    
    # Authenticate other workers
    if LINKEDIN_STORAGE_STATE.exists():
        for i, worker in enumerate(workers[1:], 1):
            try:
                await worker['context'].close()
                x, y, width, height = positions[i]
                worker['context'] = await worker['browser'].new_context(
                    storage_state=str(LINKEDIN_STORAGE_STATE),
                    viewport={'width': width - 20, 'height': height - 100}
                )
                worker['page'] = await worker['context'].new_page()
                await worker['page'].goto("https://www.linkedin.com/sales/home", timeout=30000)
                await asyncio.sleep(2)
                if '/sales/' in worker['page'].url:
                    worker['authenticated'] = True
                    print(f"  Worker {i}: ✓ Authenticated")
            except Exception as e:
                print(f"  Worker {i}: Failed - {e}")
    
    authenticated_workers = [w for w in workers if w['authenticated']]
    print(f"\n{len(authenticated_workers)}/{num_workers} workers ready\n")
    
    if not authenticated_workers:
        print("No authenticated workers. Aborting.")
        for worker in workers:
            try:
                await worker['browser'].close()
            except:
                pass
        await playwright.stop()
        return
    
    # Work queues
    scrape_queue = asyncio.Queue()
    for company in companies:
        await scrape_queue.put(company)
    
    # Email discovery runs in a thread pool (since it uses synchronous HTTP/LLM calls)
    email_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="email_")
    email_futures = []
    
    # Results tracking
    results = {
        'total_contacts': 0,
        'companies_processed': 0,
        'emails_generated': 0,
        'profiles_found': 0,
        'errors': 0
    }
    results_lock = asyncio.Lock()
    
    # Rate limiting for LinkedIn
    rate_limit_lock = asyncio.Lock()
    DELAY_BETWEEN_SEARCHES = 2
    
    def process_email_for_company(company_name: str, domain: str):
        """
        Synchronous function to discover email pattern and apply to contacts.
        Runs in a separate thread.
        """
        try:
            print(f"[Email] Starting pattern discovery for {company_name}...")
            
            # Discover the email pattern
            pattern_result = discover_email_pattern(company_name, domain)
            pattern = pattern_result.get('pattern', 'first.last')
            email_domain = pattern_result.get('domain') or domain
            confidence = pattern_result.get('confidence', 0.5)
            
            if not email_domain or '.' not in str(email_domain):
                # Generate domain from company name as fallback
                email_domain = domain.replace('-', '') + '.com' if domain else None
            
            if not email_domain:
                print(f"[Email] No domain found for {company_name}, skipping")
                return 0
            
            contacts = db.get_contacts_missing_generated_email(company_name)
            
            if not contacts:
                print(f"[Email] No contacts to process for {company_name}")
                return 0
            
            # Generate emails for each contact
            generated = 0
            for contact in contacts:
                contact_id = contact['id']
                name = contact['name']

                email = generate_email(name, pattern, email_domain)
                if email:
                    db.update_contact_generated_email(contact_id, email, pattern, int(confidence * 100))
                    generated += 1
            
            print(f"[Email] ✓ {company_name}: {generated} emails generated ({pattern} @ {email_domain})")
            return generated
            
        except Exception as e:
            print(f"[Email] Error for {company_name}: {e}")
            return 0
    
    async def linkedin_worker_task(worker):
        """LinkedIn scraping worker - extracts contacts + public URLs, queues email discovery."""
        scraper = SalesNavigatorScraper()
        scraper.page = worker['page']
        scraper.context = worker['context']
        scraper.is_authenticated = True
        
        while True:
            try:
                try:
                    company = await asyncio.wait_for(scrape_queue.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    if scrape_queue.empty():
                        break
                    continue
                
                company_name = company['company_name']
                domain = company['domain']
                
                async with rate_limit_lock:
                    print(f"[Worker {worker['id']}] Scraping: {company_name}")
                    await asyncio.sleep(DELAY_BETWEEN_SEARCHES)
                
                try:
                    db.update_target_status(company_name=company_name, status='processing')
                    
                    # Scrape contacts AND extract public LinkedIn URLs directly from Sales Nav
                    result = await scraper.scrape_company_contacts_raw(
                        company_name=company_name,
                        domain=domain,
                        max_contacts=max_contacts,
                        extract_public_urls=True  # Gets /in/ URLs directly, no separate browser needed
                    )
                    
                    employees = result.get('employees', [])
                    
                    if employees:
                        db.save_linkedin_contacts(company_name, employees, domain)
                        
                        # Count how many have public URLs
                        public_url_count = sum(1 for e in employees if e.get('has_public_url'))
                        
                        async with results_lock:
                            results['total_contacts'] += len(employees)
                            results['companies_processed'] += 1
                            results['profiles_found'] += public_url_count
                        
                        print(f"[Worker {worker['id']}] ✓ {company_name}: {len(employees)} contacts ({public_url_count} with public URLs)")
                        
                        # Use company_name for reliable matching
                        db.update_target_status(company_name=company_name, status='completed')
                        # Validate status is correct
                        db.validate_and_fix_target_status(company_name)
                        
                        # IMMEDIATELY queue email discovery in background thread
                        future = email_executor.submit(process_email_for_company, company_name, domain)
                        email_futures.append(future)
                    else:
                        print(f"[Worker {worker['id']}] {company_name}: No contacts found")
                        db.update_target_status(company_name=company_name, status='no_results')
                        async with results_lock:
                            results['companies_processed'] += 1
                            
                except Exception as e:
                    print(f"[Worker {worker['id']}] Error: {e}")
                    db.update_target_status(company_name=company_name, status='error')
                    async with results_lock:
                        results['errors'] += 1
                
                scrape_queue.task_done()
                
            except asyncio.CancelledError:
                break
    
    # Start LinkedIn workers
    print("Starting parallel scraping + email discovery...")
    
    # Start Sales Navigator workers (public URLs extracted inline, no separate browser needed)
    tasks = [asyncio.create_task(linkedin_worker_task(w)) for w in authenticated_workers]
    
    # Wait for scraping to complete
    await scrape_queue.join()
    
    # Cancel worker tasks
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    
    # Wait for remaining email discovery tasks to complete
    print("\n[Email] Waiting for remaining email discovery tasks...")
    for future in email_futures:
        try:
            generated = future.result(timeout=60)
            results['emails_generated'] += generated
        except Exception as e:
            print(f"[Email] Task error: {e}")
    
    email_executor.shutdown(wait=True)
    
    # Validate all statuses are correct (companies with contacts should be 'completed')
    print("\n[Validation] Checking target statuses...")
    fixed = db.validate_all_target_statuses()
    if fixed > 0:
        print(f"[Validation] Fixed {fixed} companies with incorrect status")
    
    # Cleanup browsers
    for worker in workers:
        try:
            await worker['context'].close()
        except:
            pass
        try:
            await worker['browser'].close()
        except:
            pass
    
    await playwright.stop()
    
    print(f"\n=== Pipeline Complete ===")
    print(f"  Companies processed: {results['companies_processed']}")
    print(f"  Total contacts scraped: {results['total_contacts']}")
    print(f"  Emails generated: {results['emails_generated']}")
    print(f"  LinkedIn profiles found: {results['profiles_found']}")
    print(f"  Errors: {results['errors']}")

