"""
Hello - Lead Generation CLI

Commands:
  scrape-and-enrich   Scrape LinkedIn for contacts and generate emails (3 parallel browsers)
  discover-emails     Run email discovery on existing contacts
  init                Initialize database
  status              Show status
"""
import asyncio
import argparse
import sys

import config
import database as db


def cmd_init(args):
    """Initialize database and directories."""
    db.init_database()
    print("✓ Database initialized")
    print(f"  Database: {config.DB_PATH}")
    print(f"  Data dir: {config.DATA_DIR}")


def cmd_scrape_and_enrich(args):
    """
    Scrape LinkedIn for contacts and generate emails using parallel browsers.
    Email pattern discovery runs IN PARALLEL with scraping - as soon as a company
    is scraped, its email pattern discovery begins immediately.
    """
    from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts
    from services.email_discoverer import discover_email_pattern, generate_email
    from services.name_normalizer import normalize_name
    
    tier = args.tier
    max_contacts = args.max_contacts
    num_workers = config.LINKEDIN_WORKERS  # Default: 3 parallel browsers
    
    print(f"\n=== Hello Lead Engine ===")
    print(f"Tier filter: {tier or 'All'}")
    print(f"Max contacts per company: {max_contacts}")
    print(f"LinkedIn workers: {num_workers}")
    print(f"Email discovery: Running in parallel\n")
    
    # Get pending companies
    with db.get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, company_name, domain, tier FROM targets WHERE status = 'pending'"
        params = []
        if tier:
            query += " AND tier = ?"
            params.append(tier)
        query += " ORDER BY tier, company_name LIMIT 50"
        cursor.execute(query, params)
        companies = [dict(row) for row in cursor.fetchall()]
    
    if not companies:
        print("No pending companies found.")
        print("Add companies via the UI or import a CSV.")
        return
    
    print(f"Found {len(companies)} companies to process\n")
    
    # Run the async scraping with parallel email discovery
    asyncio.run(_scrape_companies_parallel_with_email(companies, max_contacts, num_workers))


def calculate_grid_positions(num_windows: int, screen_width: int = 1920, screen_height: int = 1080):
    """
    Calculate window positions for a grid layout.
    Returns list of (x, y, width, height) tuples.
    """
    if num_windows <= 0:
        return []
    
    # For 3 windows, arrange horizontally
    if num_windows <= 3:
        cols = num_windows
        rows = 1
    elif num_windows <= 6:
        cols = 3
        rows = 2
    else:
        cols = 4
        rows = (num_windows + 3) // 4
    
    window_width = screen_width // cols
    window_height = screen_height // rows
    
    positions = []
    for i in range(num_windows):
        row = i // cols
        col = i % cols
        x = col * window_width
        y = row * window_height
        positions.append((x, y, window_width, window_height))
    
    return positions


async def _scrape_companies_parallel(companies: list, max_contacts: int, num_workers: int = 3):
    """
    Scrape LinkedIn for companies using multiple parallel browser instances.
    Browsers are arranged in a grid pattern for easy monitoring.
    """
    from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts
    from playwright.async_api import async_playwright
    
    print("=== Phase 1: LinkedIn Scraping ===")
    print(f"Starting {num_workers} browser workers in grid layout...")
    
    # Storage for LinkedIn session (shared across workers for initial auth)
    LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"
    
    # Calculate grid positions for browser windows
    positions = calculate_grid_positions(num_workers)
    
    playwright = await async_playwright().start()
    
    # Create separate browser instances for each worker so we can position them
    workers = []
    for i in range(num_workers):
        x, y, width, height = positions[i]
        
        # Launch browser with specific window position
        browser = await playwright.chromium.launch(
            headless=False,
            slow_mo=100,
            args=[
                f'--window-position={x},{y}',
                f'--window-size={width},{height}',
                '--disable-infobars',
            ]
        )
        
        if LINKEDIN_STORAGE_STATE.exists():
            context = await browser.new_context(
                storage_state=str(LINKEDIN_STORAGE_STATE),
                viewport={'width': width - 20, 'height': height - 100}
            )
        else:
            context = await browser.new_context(
                viewport={'width': width - 20, 'height': height - 100}
            )
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
    
    # Check authentication on first worker
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
        print("  ")
        print("  1. Log in to LinkedIn in Browser 1")
        print("  2. Then navigate to Sales Navigator")
        print("  3. URL: https://www.linkedin.com/sales/home")
        print("  ")
        print(f"  You have {config.LINKEDIN_TIMEOUT_MINUTES} minutes.")
        print("="*60 + "\n")
        
        # Navigate to login
        await first_page.goto("https://www.linkedin.com/login", timeout=30000)
        
        # Wait for user to log in
        timeout = config.LINKEDIN_TIMEOUT_MINUTES * 60
        start = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start) < timeout:
            await asyncio.sleep(10)
            try:
                url = first_page.url
                if '/sales/' in url and 'login' not in url.lower():
                    print("\n[LinkedIn] Sales Navigator detected - login successful!")
                    is_authenticated = True
                    # Save session for all workers
                    await workers[0]['context'].storage_state(path=str(LINKEDIN_STORAGE_STATE))
                    break
            except Exception:
                pass
        
        if not is_authenticated:
            print("[LinkedIn] Login timeout. Please try again.")
            # Close all browser instances
            for worker in workers:
                try:
                    await worker['browser'].close()
                except:
                    pass
            await playwright.stop()
            return
    
    print("✓ Authenticated with LinkedIn Sales Navigator\n")
    
    # Mark first worker as authenticated
    workers[0]['authenticated'] = True
    
    # Navigate all other workers to Sales Navigator using the same session
    if LINKEDIN_STORAGE_STATE.exists():
        for i, worker in enumerate(workers[1:], 1):
            try:
                # Reload context with session (use worker's own browser)
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
        # Close all browser instances
        for worker in workers:
            try:
                await worker['browser'].close()
            except:
                pass
        await playwright.stop()
        return
    
    # Create a work queue
    work_queue = asyncio.Queue()
    for company in companies:
        await work_queue.put(company)
    
    # Results collector
    results = {
        'total_contacts': 0,
        'companies_processed': 0,
        'errors': 0
    }
    results_lock = asyncio.Lock()
    
    # Rate limiting - stagger workers to avoid 429 errors
    # Only one worker can start a new company search at a time
    rate_limit_lock = asyncio.Lock()
    DELAY_BETWEEN_SEARCHES = 2                                                                                 # seconds between starting new searches
    
    async def worker_task(worker):
        """Worker coroutine that processes companies from the queue."""
        scraper = SalesNavigatorScraper()
        scraper.page = worker['page']
        scraper.context = worker['context']
        scraper.is_authenticated = True
        
        while True:
            try:
                # Get next company (with timeout to allow graceful exit)
                try:
                    company = await asyncio.wait_for(work_queue.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    if work_queue.empty():
                        break
                    continue
                
                company_name = company['company_name']
                domain = company['domain']
                
                # Rate limiting: only one worker starts a search at a time
                # This prevents 429 errors from LinkedIn
                async with rate_limit_lock:
                    print(f"[Worker {worker['id']}] Processing: {company_name}")
                    await asyncio.sleep(DELAY_BETWEEN_SEARCHES)  # Stagger requests
                
                try:
                    # Update status
                    db.update_target_status(domain, 'processing')
                    
                    # Scrape contacts
                    result = await scraper.scrape_company_contacts(
                        company_name=company_name,
                        domain=domain,
                        max_contacts=max_contacts
                    )
                    
                    employees = result.get('employees', [])
                    
                    if employees:
                        save_linkedin_contacts(company_name, employees, domain)
                        async with results_lock:
                            results['total_contacts'] += len(employees)
                            results['companies_processed'] += 1
                        print(f"[Worker {worker['id']}] ✓ {company_name}: {len(employees)} contacts")
                        db.update_target_status(domain, 'scraped')
                    else:
                        print(f"[Worker {worker['id']}] {company_name}: No contacts found")
                        db.update_target_status(domain, 'no_results')
                        async with results_lock:
                            results['companies_processed'] += 1
                            
                except Exception as e:
                    print(f"[Worker {worker['id']}] Error with {company_name}: {e}")
                    db.update_target_status(domain, 'error')
                    async with results_lock:
                        results['errors'] += 1
                
                work_queue.task_done()
                
            except asyncio.CancelledError:
                break
    
    # Start all worker tasks
    print("Starting parallel scraping...")
    tasks = [asyncio.create_task(worker_task(w)) for w in authenticated_workers]
    
    # Wait for queue to be processed
    await work_queue.join()
    
    # Cancel worker tasks
    for task in tasks:
        task.cancel()
    
    await asyncio.gather(*tasks, return_exceptions=True)
    
    # Cleanup - close each browser instance
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
    
    print(f"\n=== LinkedIn Scraping Complete ===")
    print(f"  Companies processed: {results['companies_processed']}")
    print(f"  Total contacts: {results['total_contacts']}")
    print(f"  Errors: {results['errors']}")


async def _scrape_companies_parallel_with_email(companies: list, max_contacts: int, num_workers: int = 2):
    """
    Scrape LinkedIn AND discover email patterns AND find profile URLs in parallel.
    
    As soon as a company is scraped:
    1. Email pattern discovery starts immediately in a background thread
    2. LinkedIn profile URL search starts in a separate browser (regular LinkedIn)
    
    This runs 3 parallel processes:
    - Sales Navigator scraping (main browsers)
    - Email pattern discovery (thread pool)
    - LinkedIn profile URL finder (separate browser on regular LinkedIn)
    """
    from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts, LinkedInProfileFinder, update_contact_linkedin_url
    from services.email_discoverer import discover_email_pattern, generate_email
    from services.name_normalizer import normalize_name
    from playwright.async_api import async_playwright
    from concurrent.futures import ThreadPoolExecutor
    import threading
    
    print("=== Parallel Scraping + Email Discovery + Profile URL Finder ===")
    print(f"Starting {num_workers} Sales Nav browsers + email thread pool + profile finder...")
    
    # Storage for LinkedIn session
    LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"
    
    # Calculate grid positions for browser windows
    positions = calculate_grid_positions(num_workers)
    
    playwright = await async_playwright().start()
    
    # Create browser instances
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
            ]
        )
        
        if LINKEDIN_STORAGE_STATE.exists():
            context = await browser.new_context(
                storage_state=str(LINKEDIN_STORAGE_STATE),
                viewport={'width': width - 20, 'height': height - 100}
            )
        else:
            context = await browser.new_context(
                viewport={'width': width - 20, 'height': height - 100}
            )
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
            await asyncio.sleep(10)
            try:
                url = first_page.url
                if '/sales/' in url and 'login' not in url.lower():
                    print("\n[LinkedIn] Login successful!")
                    is_authenticated = True
                    await workers[0]['context'].storage_state(path=str(LINKEDIN_STORAGE_STATE))
                    break
            except Exception:
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
    
    # Profile URL finder queue (contacts to look up on regular LinkedIn)
    profile_queue = asyncio.Queue()
    profile_finder_active = True  # Flag to stop finder when done
    
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
    
    async def profile_finder_task():
        """
        Separate task that finds LinkedIn profile URLs on regular LinkedIn.
        Runs in parallel with Sales Navigator scraping.
        """
        nonlocal profile_finder_active
        
        print("[Profile Finder] Starting browser for regular LinkedIn...")
        finder = LinkedInProfileFinder()
        
        try:
            await finder.start(headless=False)
            
            if not finder.is_authenticated:
                authenticated = await finder.wait_for_login(timeout_minutes=3)
                if not authenticated:
                    print("[Profile Finder] Not authenticated. Profile URLs will be skipped.")
                    return
            
            print("[Profile Finder] ✓ Ready to find profile URLs")
            
            while profile_finder_active or not profile_queue.empty():
                try:
                    # Get contact to look up
                    contact = await asyncio.wait_for(profile_queue.get(), timeout=3.0)
                    
                    contact_id = contact['id']
                    name = contact['name']
                    company = contact['company']
                    
                    # Find the profile URL
                    profile_url = await finder.find_profile_url(name, company)
                    
                    if profile_url:
                        # Update database
                        update_contact_linkedin_url(contact_id, profile_url)
                        async with results_lock:
                            results['profiles_found'] += 1
                    
                    # Small delay between searches
                    await asyncio.sleep(1.5)
                    
                    profile_queue.task_done()
                    
                except asyncio.TimeoutError:
                    if not profile_finder_active and profile_queue.empty():
                        break
                    continue
                except Exception as e:
                    print(f"[Profile Finder] Error: {e}")
                    try:
                        profile_queue.task_done()
                    except:
                        pass
                    
        except Exception as e:
            print(f"[Profile Finder] Fatal error: {e}")
        finally:
            await finder.stop()
            print("[Profile Finder] Stopped")
    
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
            
            # Get contacts for this company from database
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, name FROM linkedin_contacts 
                    WHERE company_name = ? AND (email_generated IS NULL OR email_generated = '')
                """, (company_name,))
                contacts = cursor.fetchall()
            
            if not contacts:
                print(f"[Email] No contacts to process for {company_name}")
                return 0
            
            # Generate emails for each contact
            generated = 0
            with db.get_db() as conn:
                cursor = conn.cursor()
                for contact in contacts:
                    contact_id = contact['id']
                    name = contact['name']
                    
                    email = generate_email(name, pattern, email_domain)
                    if email:
                        cursor.execute("""
                            UPDATE linkedin_contacts 
                            SET email_generated = ?, email_pattern = ?, email_confidence = ?
                            WHERE id = ?
                        """, (email, pattern, int(confidence * 100), contact_id))
                        generated += 1
            
            print(f"[Email] ✓ {company_name}: {generated} emails generated ({pattern} @ {email_domain})")
            return generated
            
        except Exception as e:
            print(f"[Email] Error for {company_name}: {e}")
            return 0
    
    async def linkedin_worker_task(worker):
        """LinkedIn scraping worker - queues email discovery when done with each company."""
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
                    db.update_target_status(domain, 'processing')
                    
                    result = await scraper.scrape_company_contacts(
                        company_name=company_name,
                        domain=domain,
                        max_contacts=max_contacts
                    )
                    
                    employees = result.get('employees', [])
                    
                    if employees:
                        save_linkedin_contacts(company_name, employees, domain)
                        async with results_lock:
                            results['total_contacts'] += len(employees)
                            results['companies_processed'] += 1
                        print(f"[Worker {worker['id']}] ✓ {company_name}: {len(employees)} contacts")
                        db.update_target_status(domain, 'scraped')
                        
                        # IMMEDIATELY queue email discovery in background thread
                        future = email_executor.submit(process_email_for_company, company_name, domain)
                        email_futures.append(future)
                        
                        # Queue contacts for profile URL finding (on regular LinkedIn)
                        # Get the contact IDs that were just saved
                        with db.get_db() as conn:
                            cursor = conn.cursor()
                            cursor.execute("""
                                SELECT id, name FROM linkedin_contacts 
                                WHERE company_name = ? AND (linkedin_url IS NULL OR linkedin_url = '')
                                ORDER BY id DESC LIMIT ?
                            """, (company_name, len(employees)))
                            contacts_for_profile = cursor.fetchall()
                        
                        for contact in contacts_for_profile:
                            await profile_queue.put({
                                'id': contact['id'],
                                'name': contact['name'],
                                'company': company_name
                            })
                    else:
                        print(f"[Worker {worker['id']}] {company_name}: No contacts found")
                        db.update_target_status(domain, 'no_results')
                        async with results_lock:
                            results['companies_processed'] += 1
                            
                except Exception as e:
                    print(f"[Worker {worker['id']}] Error: {e}")
                    db.update_target_status(domain, 'error')
                    async with results_lock:
                        results['errors'] += 1
                
                scrape_queue.task_done()
                
            except asyncio.CancelledError:
                break
    
    # Start LinkedIn workers
    print("Starting parallel scraping + email discovery + profile finder...")
    
    # Start profile finder in parallel (separate browser on regular LinkedIn)
    profile_finder_task_handle = asyncio.create_task(profile_finder_task())
    
    # Start Sales Navigator workers
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
    
    # Signal profile finder to stop and wait for remaining lookups
    print("\n[Profile Finder] Waiting for remaining profile lookups...")
    profile_finder_active = False
    try:
        await asyncio.wait_for(profile_finder_task_handle, timeout=120)  # Give it 2 minutes
    except asyncio.TimeoutError:
        print("[Profile Finder] Timeout waiting, cancelling...")
        profile_finder_task_handle.cancel()
        try:
            await profile_finder_task_handle
        except asyncio.CancelledError:
            pass
    
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


def cmd_discover_emails(args):
    """
    Discover email patterns and generate addresses for existing contacts.
    """
    from services.email_discoverer import process_linkedin_contacts_with_patterns
    
    workers = args.workers
    today_only = args.today
    
    print(f"\n=== Email Discovery ===")
    print(f"Workers: {workers}")
    print(f"Today only: {today_only}\n")
    
    try:
        result = process_linkedin_contacts_with_patterns(
            today_only=today_only,
            workers=workers
        )
        
        print(f"\n✓ Success!")
        print(f"  Contacts processed: {result['contacts']}")
        print(f"  Companies: {result['companies']}")
        print(f"  Output: {result['output_path']}")
        
        # Show pattern summary
        if result.get('patterns'):
            print("\nPatterns discovered:")
            for company, info in list(result['patterns'].items())[:5]:
                domain_mark = "✓" if info.get('domain_discovered') else "?"
                print(f"  {company}: {info['pattern']} @ {info.get('domain', 'unknown')} [{domain_mark}]")
            if len(result['patterns']) > 5:
                print(f"  ... and {len(result['patterns']) - 5} more")
                
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def cmd_status(args):
    """Show pipeline status and statistics."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Companies
        cursor.execute("SELECT COUNT(*) FROM targets")
        total_companies = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'pending'")
        pending = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'scraped'")
        scraped = cursor.fetchone()[0]
        
        # Contacts
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except:
            total_contacts = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''")
            with_email = cursor.fetchone()[0]
        except:
            with_email = 0
    
    print("\n=== Pipeline Status ===")
    print(f"Total Companies:  {total_companies}")
    print(f"  Pending:        {pending}")
    print(f"  Scraped:        {scraped}")
    print(f"")
    print(f"Total Contacts:   {total_contacts}")
    print(f"  With Email:     {with_email}")


def main():
    parser = argparse.ArgumentParser(
        description="Hello Lead Engine CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # init
    init_parser = subparsers.add_parser('init', help='Initialize database')
    init_parser.set_defaults(func=cmd_init)
    
    # scrape-and-enrich
    scrape_parser = subparsers.add_parser('scrape-and-enrich', 
        help='Scrape LinkedIn for contacts and generate emails')
    scrape_parser.add_argument('--tier', '-t', help='Filter by tier (A, B, C)')
    scrape_parser.add_argument('--max-contacts', '-m', type=int, default=25,
        help='Max contacts per company (default: 25)')
    scrape_parser.set_defaults(func=cmd_scrape_and_enrich)
    
    # discover-emails
    email_parser = subparsers.add_parser('discover-emails',
        help='Run email discovery on existing contacts')
    email_parser.add_argument('--workers', '-w', type=int, default=5,
        help='Number of parallel workers (default: 5)')
    email_parser.add_argument('--today', action='store_true',
        help="Only process today's contacts")
    email_parser.set_defaults(func=cmd_discover_emails)
    
    # status
    status_parser = subparsers.add_parser('status', help='Show pipeline status')
    status_parser.set_defaults(func=cmd_status)
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        return
    
    args.func(args)


if __name__ == "__main__":
    main()
