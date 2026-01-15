"""
Parallelized LinkedIn Profile URL Finder using browser search.
Opens multiple LinkedIn browser windows to find profiles in parallel.
"""
import asyncio
import database as db
from services.linkedin import update_contact_linkedin_url
from playwright.async_api import async_playwright
from urllib.parse import quote
import re
import random
import config


# Number of parallel browser workers (keep low to avoid rate limits)
NUM_WORKERS = 1


def find_profile_with_tavily(name: str, company: str) -> str | None:
    """
    Use Tavily web search + GPT-4o to find LinkedIn profile URL.
    Fallback when LinkedIn browser search fails.
    """
    import requests
    from openai import OpenAI
    
    # Step 1: Search with Tavily
    if not config.TAVILY_API_KEY:
        return None
    
    try:
        query = f"{name} {company} LinkedIn profile site:linkedin.com/in/"
        
        response = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": config.TAVILY_API_KEY,
                "query": query,
                "search_depth": "basic",
                "include_answer": False,
                "max_results": 5
            },
            timeout=30
        )
        response.raise_for_status()
        search_results = response.json()
        
    except Exception as e:
        print(f"[Tavily] Search error: {e}")
        return None
    
    results = search_results.get('results', [])
    if not results:
        return None
    
    # Collect LinkedIn URLs
    linkedin_urls = []
    context_parts = []
    
    for result in results[:5]:
        url = result.get('url', '')
        title = result.get('title', '')
        content = result.get('content', '')[:300]
        
        if 'linkedin.com/in/' in url:
            linkedin_urls.append(url)
        
        context_parts.append(f"URL: {url}\nTitle: {title}\nContent: {content}")
    
    # If only one LinkedIn URL found, use it directly
    if len(linkedin_urls) == 1:
        url = linkedin_urls[0]
        match = re.search(r'(https://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+)', url)
        if match:
            return match.group(1)
    
    # Use GPT-4o to pick the right profile
    if not config.OPENAI_API_KEY or not linkedin_urls:
        if linkedin_urls:
            match = re.search(r'(https://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+)', linkedin_urls[0])
            if match:
                return match.group(1)
        return None
    
    context = "\n\n".join(context_parts)
    
    prompt = f"""Find the LinkedIn profile URL for this person:
Name: {name}
Company: {company}

Search results:
{context}

Return ONLY the LinkedIn profile URL (https://www.linkedin.com/in/username) or NONE if not found.
Response:"""

    try:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0
        )
        
        result_text = response.choices[0].message.content.strip()
        
        if "none" in result_text.lower():
            return None
        
        match = re.search(r'(https://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+)', result_text)
        if match:
            return match.group(1)
        
        return None
        
    except Exception as e:
        print(f"[Tavily] GPT error: {e}")
        return None


def find_profile_with_google(name: str, company: str) -> str | None:
    """
    Use Google search to find LinkedIn profile URL.
    Final fallback when LinkedIn and Tavily both fail.
    """
    import requests
    from bs4 import BeautifulSoup
    
    try:
        query = f"{name} {company} LinkedIn site:linkedin.com/in/"
        search_url = f"https://www.google.com/search?q={quote(query)}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Find all links in search results
        links = soup.find_all('a', href=True)
        
        for link in links:
            href = link.get('href', '')
            
            # Google wraps links, extract actual URL
            if href.startswith('/url?q='):
                href = href.split('/url?q=')[1].split('&')[0]
            
            # Check if it's a LinkedIn profile
            if 'linkedin.com/in/' in href and '/in/unavailable' not in href:
                match = re.search(r'(https://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+)', href)
                if match:
                    profile_url = match.group(1)
                    # Ensure it starts with https://www.
                    if not profile_url.startswith('https://www.'):
                        profile_url = profile_url.replace('https://', 'https://www.')
                    return profile_url
        
        return None
        
    except Exception as e:
        print(f"[Google] Search error: {e}")
        return None


def get_screen_size():
    """Get screen dimensions."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    except:
        return 1920, 1080


def calculate_grid_positions(num_windows: int):
    """Calculate window positions for a grid layout."""
    screen_w, screen_h = get_screen_size()
    
    if num_windows <= 2:
        cols, rows = num_windows, 1
    elif num_windows <= 4:
        cols, rows = 2, 2
    else:
        cols, rows = 3, 2
    
    win_w = screen_w // cols
    win_h = screen_h // rows
    
    positions = []
    for i in range(num_windows):
        row = i // cols
        col = i % cols
        x = col * win_w
        y = row * win_h
        positions.append((x, y, win_w, win_h))
    
    return positions


async def verify_profile(page, name: str, company: str) -> str | None:
    """Verify the current profile page matches the person."""
    try:
        current_url = page.url
        
        if '/in/' not in current_url:
            return None
        
        # Extract clean URL
        match = re.search(r'(https://www\.linkedin\.com/in/[a-zA-Z0-9_-]+)', current_url)
        if not match:
            return None
        
        profile_url = match.group(1)
        
        # Get page content to verify
        page_text = await page.inner_text('body')
        page_text_lower = page_text.lower()
        
        # Check name match
        name_parts = name.lower().split()
        name_matches = sum(1 for part in name_parts if len(part) > 2 and part in page_text_lower)
        
        # Check company match
        company_parts = company.lower().split()
        company_matches = sum(1 for part in company_parts if len(part) > 2 and part in page_text_lower)
        
        if name_matches >= 1 and company_matches >= 1:
            return profile_url
        elif name_matches >= 2:
            return profile_url
        
        return None
        
    except Exception as e:
        return None


async def search_and_find_profile(page, name: str, company: str) -> str | None:
    """Search LinkedIn and find a profile URL directly from search results."""
    try:
        search_query = f"{name} {company}"
        encoded_query = quote(search_query)
        search_url = f"https://www.linkedin.com/search/results/people/?keywords={encoded_query}"
        
        await page.goto(search_url, timeout=30000)
        await page.wait_for_load_state('domcontentloaded', timeout=15000)
        await asyncio.sleep(random.uniform(1.5, 2.5))
        
        # Get ALL /in/ links on the page and filter them
        all_links = await page.evaluate("""
            () => {
                const links = [];
                document.querySelectorAll('a[href*="/in/"]').forEach(a => {
                    const href = a.href || '';
                    const text = a.innerText || '';
                    const parentText = a.closest('li')?.innerText || a.closest('div')?.innerText || '';
                    
                    // Skip mutual connections links, navigation links, etc
                    if (href.includes('miniProfile') || 
                        href.includes('connectionOf') ||
                        href.includes('/in/unavailable') ||
                        text.toLowerCase().includes('mutual') ||
                        text.toLowerCase().includes('connection')) {
                        return;
                    }
                    
                    // Extract the /in/username part
                    const match = href.match(/\\/in\\/([a-zA-Z0-9_-]+)/);
                    if (match) {
                        links.push({
                            username: match[1],
                            url: 'https://www.linkedin.com/in/' + match[1],
                            text: text.substring(0, 100),
                            context: parentText.substring(0, 300)
                        });
                    }
                });
                return links;
            }
        """)
        
        if not all_links:
            return None
        
        # Remove duplicates by username
        seen = set()
        unique_links = []
        for link in all_links:
            if link['username'] not in seen:
                seen.add(link['username'])
                unique_links.append(link)
        
        if not unique_links:
            return None
        
        # Try to find the best match by checking name/company
        name_lower = name.lower()
        name_parts = [p for p in name_lower.split() if len(p) > 2]
        company_lower = company.lower()
        company_parts = [p for p in company_lower.split() if len(p) > 2]
        
        for link in unique_links[:5]:  # Check first 5 unique profiles
            context_lower = link['context'].lower()
            
            # Check name match
            name_matches = sum(1 for part in name_parts if part in context_lower)
            company_matches = sum(1 for part in company_parts if part in context_lower)
            
            # Good match: name + company
            if name_matches >= 1 and company_matches >= 1:
                return link['url']
            # Decent match: strong name match
            elif name_matches >= 2:
                return link['url']
        
        # Fallback: return first result (likely the top search result)
        if unique_links:
            return unique_links[0]['url']
        
        return None
        
    except Exception as e:
        print(f"[Worker] Search error: {e}")
        return None


async def worker_task(worker_id: int, queue: asyncio.Queue, results: dict, results_lock: asyncio.Lock, 
                      rate_lock: asyncio.Lock, playwright, position: tuple):
    """Worker that processes contacts from the queue."""
    
    x, y, width, height = position
    
    # Launch browser with position
    browser = await playwright.chromium.launch(
        headless=False,
        args=[
            f'--window-position={x},{y}',
            f'--window-size={width},{height}',
            '--disable-blink-features=AutomationControlled'
        ]
    )
    
    # Check for existing session
    session_file = config.DATA_DIR / "linkedin_regular_auth.json"
    
    if session_file.exists():
        context = await browser.new_context(
            storage_state=str(session_file),
            viewport={'width': width - 20, 'height': height - 100}
        )
    else:
        context = await browser.new_context(
            viewport={'width': width - 20, 'height': height - 100}
        )
    
    page = await context.new_page()
    
    # Check if authenticated
    try:
        await page.goto("https://www.linkedin.com/feed/", timeout=30000)
        await asyncio.sleep(2)
        
        url = page.url
        if 'login' in url or 'checkpoint' in url or 'authwall' in url:
            if worker_id == 0:
                print(f"\n[Worker {worker_id}] Please log in to LinkedIn...")
                print(f"[Worker {worker_id}] Waiting up to 3 minutes...")
                
                await page.goto("https://www.linkedin.com/login", timeout=30000)
                
                # Wait for login
                for _ in range(36):  # 3 minutes
                    await asyncio.sleep(5)
                    url = page.url
                    if '/feed' in url or '/in/' in url:
                        print(f"[Worker {worker_id}] Login successful!")
                        await context.storage_state(path=str(session_file))
                        break
                else:
                    print(f"[Worker {worker_id}] Login timeout")
                    await browser.close()
                    return
            else:
                # Other workers wait for worker 0 to log in
                await asyncio.sleep(10)
                if session_file.exists():
                    await context.close()
                    context = await browser.new_context(
                        storage_state=str(session_file),
                        viewport={'width': width - 20, 'height': height - 100}
                    )
                    page = await context.new_page()
                    await page.goto("https://www.linkedin.com/feed/", timeout=30000)
                    await asyncio.sleep(2)
    except Exception as e:
        print(f"[Worker {worker_id}] Auth error: {e}")
    
    print(f"[Worker {worker_id}] Ready")
    
    # Process queue
    while True:
        try:
            contact = await asyncio.wait_for(queue.get(), timeout=5.0)
        except asyncio.TimeoutError:
            if queue.empty():
                break
            continue
        
        contact_id = contact['id']
        name = contact['name']
        company = contact['company_name']
        
        # Rate limiting - only one search at a time across all workers
        async with rate_lock:
            print(f"[Worker {worker_id}] Searching: {name} @ {company}")
            await asyncio.sleep(3)  # 3 second delay between searches
        
        try:
            profile_url = await search_and_find_profile(page, name, company)
            
            if profile_url:
                update_contact_linkedin_url(contact_id, profile_url)
                async with results_lock:
                    results['found'] += 1
                print(f"[Worker {worker_id}] FOUND: {profile_url}")
            else:
                # Fallback 1: Google search (free)
                print(f"[Worker {worker_id}] Trying Google fallback for: {name}")
                profile_url = find_profile_with_google(name, company)
                
                if profile_url:
                    update_contact_linkedin_url(contact_id, profile_url)
                    async with results_lock:
                        results['found'] += 1
                    print(f"[Worker {worker_id}] FOUND (Google): {profile_url}")
                else:
                    # Fallback 2: Tavily + LLM search (costs money)
                    print(f"[Worker {worker_id}] Trying Tavily fallback for: {name}")
                    profile_url = find_profile_with_tavily(name, company)
                    
                    if profile_url:
                        update_contact_linkedin_url(contact_id, profile_url)
                        async with results_lock:
                            results['found'] += 1
                        print(f"[Worker {worker_id}] FOUND (Tavily): {profile_url}")
                    else:
                        async with results_lock:
                            results['not_found'] += 1
                        print(f"[Worker {worker_id}] Not found: {name}")
                
        except Exception as e:
            print(f"[Worker {worker_id}] Error: {e}")
            async with results_lock:
                results['errors'] += 1
        
        queue.task_done()
    
    # Cleanup
    try:
        await context.storage_state(path=str(session_file))
    except:
        pass
    await browser.close()
    print(f"[Worker {worker_id}] Done")


async def run_parallel_finder(batch_size: int, num_workers: int):
    """Run parallel LinkedIn profile finding."""
    
    # Get contacts that need URLs (skip ones that already have /in/ URLs)
    # Process in reverse order (newest first)
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, company_name, linkedin_url
            FROM linkedin_contacts 
            WHERE (linkedin_url IS NULL 
               OR linkedin_url = ''
               OR linkedin_url NOT LIKE '%/in/%')
            ORDER BY id DESC
            LIMIT ?
        """, (batch_size * 2,))  # Get more to filter
        
        # Filter out any that somehow have /in/ URLs
        all_contacts = cursor.fetchall()
        contacts = [c for c in all_contacts if not c['linkedin_url'] or '/in/' not in str(c['linkedin_url'])]
        contacts = contacts[:batch_size]  # Limit to batch size
    
    if not contacts:
        print("No contacts need processing!")
        return
    
    print(f"\n{'='*60}")
    print(f"  LinkedIn Profile Finder (Browser Mode)")
    print(f"  Contacts to process: {len(contacts)}")
    print(f"  Browser workers: {num_workers}")
    print(f"{'='*60}\n")
    
    # Calculate window positions
    positions = calculate_grid_positions(num_workers)
    
    # Create queue and results
    queue = asyncio.Queue()
    for contact in contacts:
        await queue.put(dict(contact))
    
    results = {'found': 0, 'not_found': 0, 'errors': 0}
    results_lock = asyncio.Lock()
    rate_lock = asyncio.Lock()
    
    # Start playwright
    playwright = await async_playwright().start()
    
    # Start workers
    tasks = []
    for i in range(num_workers):
        task = asyncio.create_task(
            worker_task(i, queue, results, results_lock, rate_lock, playwright, positions[i])
        )
        tasks.append(task)
        await asyncio.sleep(2)  # Stagger worker starts
    
    # Wait for queue to be processed
    await queue.join()
    
    # Cancel remaining tasks
    for task in tasks:
        task.cancel()
    
    await asyncio.gather(*tasks, return_exceptions=True)
    await playwright.stop()
    
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"  Found: {results['found']}")
    print(f"  Not found: {results['not_found']}")
    print(f"  Errors: {results['errors']}")
    print(f"  Total: {results['found'] + results['not_found'] + results['errors']}")
    print(f"{'='*60}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Find LinkedIn profile URLs using browser")
    parser.add_argument("--batch", type=int, default=50, help="Number of contacts to process")
    parser.add_argument("--workers", type=int, default=3, help="Number of browser workers")
    args = parser.parse_args()
    
    asyncio.run(run_parallel_finder(batch_size=args.batch, num_workers=args.workers))
