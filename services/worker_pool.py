"""
Worker Pool: Manages parallel browser instances for high-throughput operations.
Supports concurrent crawling, extraction, and Salesforce sending.
"""
import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Optional, Callable, Any
from pathlib import Path
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from rich.console import Console
from rich.progress import Progress, TaskID, SpinnerColumn, TextColumn, BarColumn

import config
import database as db

console = Console()


@dataclass
class WorkerStats:
    """Track statistics for a worker."""
    worker_id: int
    tasks_completed: int = 0
    tasks_failed: int = 0
    started_at: datetime = field(default_factory=datetime.now)
    
    @property
    def success_rate(self) -> float:
        total = self.tasks_completed + self.tasks_failed
        return self.tasks_completed / total if total > 0 else 0


@dataclass 
class WorkItem:
    """A single unit of work for a worker."""
    id: str
    data: Dict
    task_type: str  # 'crawl', 'extract', 'send'
    priority: int = 0


class BrowserWorker:
    """
    A single browser worker that can perform crawling or Salesforce operations.
    Each worker maintains its own browser context.
    """
    
    def __init__(self, worker_id: int, browser: Browser, worker_type: str = 'general'):
        self.worker_id = worker_id
        self.browser = browser
        self.worker_type = worker_type
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.stats = WorkerStats(worker_id=worker_id)
        self.is_busy = False
        self.current_task: Optional[str] = None
    
    async def initialize(self, storage_state: str = None):
        """Initialize browser context."""
        if storage_state and Path(storage_state).exists():
            self.context = await self.browser.new_context(
                storage_state=storage_state,
                viewport={'width': 1920, 'height': 1080}
            )
        else:
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )
        self.page = await self.context.new_page()
    
    async def cleanup(self):
        """Clean up resources."""
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
    
    async def save_session(self, path: str):
        """Save session state for reuse."""
        if self.context:
            await self.context.storage_state(path=path)


class WorkerPool:
    """
    Pool of browser workers for parallel operations.
    """
    
    def __init__(
        self,
        num_workers: int = 30,
        worker_type: str = 'general',
        headless: bool = True
    ):
        self.num_workers = num_workers
        self.worker_type = worker_type
        self.headless = headless
        self.workers: List[BrowserWorker] = []
        self.browser: Optional[Browser] = None
        self.playwright = None
        self.work_queue: asyncio.Queue = asyncio.Queue()
        self.results: Dict[str, Any] = {}
        self.lock = asyncio.Lock()
        self._shutdown = False
    
    async def start(self):
        """Start the worker pool with all browser instances."""
        console.print(f"[blue]Starting {self.num_workers} browser workers...[/blue]")
        
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox'
            ]
        )
        
        # Create workers in parallel
        init_tasks = []
        for i in range(self.num_workers):
            worker = BrowserWorker(i, self.browser, self.worker_type)
            self.workers.append(worker)
            init_tasks.append(worker.initialize())
        
        await asyncio.gather(*init_tasks)
        console.print(f"[green]OK - {self.num_workers} workers ready[/green]")
    
    async def stop(self):
        """Stop all workers and clean up."""
        self._shutdown = True
        
        # Clean up all workers
        cleanup_tasks = [w.cleanup() for w in self.workers]
        await asyncio.gather(*cleanup_tasks, return_exceptions=True)
        
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        
        console.print("[yellow]Worker pool stopped[/yellow]")
    
    def get_available_worker(self) -> Optional[BrowserWorker]:
        """Get an available worker."""
        for worker in self.workers:
            if not worker.is_busy:
                return worker
        return None
    
    async def submit_work(self, items: List[WorkItem]):
        """Submit work items to the queue."""
        for item in items:
            await self.work_queue.put(item)
    
    async def process_queue(
        self,
        processor: Callable,
        progress_callback: Callable = None
    ) -> Dict[str, Any]:
        """
        Process all items in the queue using available workers.
        
        Args:
            processor: Async function(worker, item) -> result
            progress_callback: Optional callback for progress updates
        """
        results = {'completed': 0, 'failed': 0, 'results': []}
        active_tasks = set()
        
        async def worker_loop(worker: BrowserWorker):
            while not self._shutdown:
                try:
                    # Get work with timeout to allow checking shutdown
                    try:
                        item = await asyncio.wait_for(
                            self.work_queue.get(), 
                            timeout=1.0
                        )
                    except asyncio.TimeoutError:
                        if self.work_queue.empty():
                            break
                        continue
                    
                    worker.is_busy = True
                    worker.current_task = item.id
                    
                    try:
                        result = await processor(worker, item)
                        worker.stats.tasks_completed += 1
                        
                        async with self.lock:
                            results['completed'] += 1
                            results['results'].append({
                                'id': item.id,
                                'status': 'success',
                                'result': result
                            })
                        
                        if progress_callback:
                            progress_callback(item.id, 'success', result)
                            
                    except Exception as e:
                        worker.stats.tasks_failed += 1
                        
                        async with self.lock:
                            results['failed'] += 1
                            results['results'].append({
                                'id': item.id,
                                'status': 'failed',
                                'error': str(e)
                            })
                        
                        if progress_callback:
                            progress_callback(item.id, 'failed', str(e))
                    
                    finally:
                        worker.is_busy = False
                        worker.current_task = None
                        self.work_queue.task_done()
                        
                except asyncio.CancelledError:
                    break
        
        # Start all workers
        worker_tasks = [
            asyncio.create_task(worker_loop(worker))
            for worker in self.workers
        ]
        
        # Wait for queue to be fully processed
        await self.work_queue.join()
        
        # Signal workers to stop
        self._shutdown = True
        await asyncio.gather(*worker_tasks, return_exceptions=True)
        self._shutdown = False
        
        return results
    
    def get_stats(self) -> Dict:
        """Get aggregate statistics."""
        total_completed = sum(w.stats.tasks_completed for w in self.workers)
        total_failed = sum(w.stats.tasks_failed for w in self.workers)
        
        return {
            'workers': self.num_workers,
            'total_completed': total_completed,
            'total_failed': total_failed,
            'success_rate': total_completed / (total_completed + total_failed) if (total_completed + total_failed) > 0 else 0,
            'per_worker': [
                {
                    'id': w.worker_id,
                    'completed': w.stats.tasks_completed,
                    'failed': w.stats.tasks_failed
                }
                for w in self.workers
            ]
        }


class SalesforceWorkerPool(WorkerPool):
    """
    Specialized worker pool for Salesforce operations.
    Handles session management and authentication across workers.
    """
    
    def __init__(self, num_workers: int = 30, headless: bool = False):
        super().__init__(num_workers, 'salesforce', headless)
        self.authenticated_workers: List[int] = []
        self.session_dir = config.DATA_DIR / "sf_sessions"
        self.session_dir.mkdir(exist_ok=True)
    
    async def start(self):
        """Start pool with Salesforce session handling."""
        await super().start()
        
        # Try to load existing sessions for each worker
        for worker in self.workers:
            session_file = self.session_dir / f"worker_{worker.worker_id}.json"
            if session_file.exists():
                try:
                    await worker.context.close()
                    worker.context = await self.browser.new_context(
                        storage_state=str(session_file),
                        viewport={'width': 1920, 'height': 1080}
                    )
                    worker.page = await worker.context.new_page()
                except Exception:
                    pass  # Session might be invalid
    
    async def authenticate_worker(self, worker: BrowserWorker) -> bool:
        """Check and handle authentication for a worker."""
        try:
            await worker.page.goto(
                f"{config.SALESFORCE_URL}/lightning/page/home",
                timeout=30000
            )
            await worker.page.wait_for_load_state('networkidle', timeout=15000)
            
            url = worker.page.url
            if 'login' in url.lower() or 'secur' in url.lower():
                return False
            
            # Check for Lightning
            lightning = worker.page.locator('.slds-global-header, .oneGlobalNav')
            if await lightning.count() > 0:
                self.authenticated_workers.append(worker.worker_id)
                # Save session
                session_file = self.session_dir / f"worker_{worker.worker_id}.json"
                await worker.save_session(str(session_file))
                return True
            
            return False
        except Exception:
            return False
    
    async def authenticate_all(self, timeout_minutes: int = None) -> int:
        if timeout_minutes is None:
            timeout_minutes = config.AUTH_TIMEOUT_MINUTES
        """
        Authenticate all workers. Opens browsers for manual login if needed.
        Returns number of authenticated workers.
        """
        console.print("[yellow]Checking authentication for all workers...[/yellow]")
        
        # Check existing auth in parallel
        auth_tasks = [self.authenticate_worker(w) for w in self.workers]
        results = await asyncio.gather(*auth_tasks)
        
        authenticated = sum(results)
        console.print(f"[blue]{authenticated}/{self.num_workers} workers already authenticated[/blue]")
        
        if authenticated < self.num_workers:
            # Need manual login for remaining workers
            unauthenticated = [w for w, auth in zip(self.workers, results) if not auth]
            
            console.print(f"\n[yellow]Please log in to Salesforce in {len(unauthenticated)} browser windows[/yellow]")
            console.print(f"[yellow]You have {timeout_minutes} minutes to complete all logins[/yellow]")
            console.print("[yellow]The system will proceed once all windows are authenticated[/yellow]\n")
            
            # Navigate all unauthenticated workers to login
            for worker in unauthenticated:
                await worker.page.goto(config.SALESFORCE_URL)
            
            # Poll for authentication
            start = datetime.now()
            while (datetime.now() - start).seconds < timeout_minutes * 60:
                await asyncio.sleep(5)
                
                still_pending = []
                for worker in unauthenticated:
                    if worker.worker_id not in self.authenticated_workers:
                        if await self.authenticate_worker(worker):
                            console.print(f"[green]OK - Worker {worker.worker_id} authenticated[/green]")
                        else:
                            still_pending.append(worker)
                
                unauthenticated = still_pending
                
                if not unauthenticated:
                    break
            
            authenticated = len(self.authenticated_workers)
        
        console.print(f"\n[{'green' if authenticated == self.num_workers else 'yellow'}]"
                     f"{authenticated}/{self.num_workers} workers authenticated[/]")
        
        return authenticated


# ============ Parallel Crawling ============

async def parallel_crawl(
    domains: List[Dict],
    num_workers: int = 30,
    headless: bool = True
) -> List[Dict]:
    """
    Crawl multiple domains in parallel using a worker pool.
    """
    from services.crawler import (
        fetch_page_simple, process_single_page, get_contact_page_urls,
        is_personal_email
    )
    
    pool = WorkerPool(num_workers=num_workers, headless=headless)
    await pool.start()
    
    # Create work items
    work_items = [
        WorkItem(
            id=d['domain'],
            data=d,
            task_type='crawl',
            priority=0
        )
        for d in domains
    ]
    
    await pool.submit_work(work_items)
    
    async def crawl_processor(worker: BrowserWorker, item: WorkItem) -> Dict:
        """Process a single crawl task."""
        domain = item.data['domain']
        homepage_url = item.data.get('source_url', f"https://{domain}")
        
        # Fetch homepage
        await worker.page.goto(homepage_url, timeout=config.RENDER_TIMEOUT_MS)
        await worker.page.wait_for_load_state('networkidle', timeout=10000)
        html = await worker.page.content()
        
        # Process the page
        db.add_page(domain, homepage_url, 'homepage')
        page_data = process_single_page(domain, homepage_url, html)
        
        all_emails = list(page_data.get('emails', []))
        email_contexts = dict(page_data.get('email_contexts', {}))
        pages = [page_data]
        
        # Get contact pages to crawl
        contact_urls = get_contact_page_urls(homepage_url, page_data.get('internal_links', []))
        
        # Crawl contact pages (limit to speed things up)
        for url in contact_urls[:4]:
            if url == homepage_url:
                continue
            try:
                await worker.page.goto(url, timeout=config.RENDER_TIMEOUT_MS)
                await worker.page.wait_for_load_state('networkidle', timeout=8000)
                html = await worker.page.content()
                
                db.add_page(domain, url, 'contact_page')
                contact_data = process_single_page(domain, url, html)
                pages.append(contact_data)
                all_emails.extend(contact_data.get('emails', []))
                email_contexts.update(contact_data.get('email_contexts', {}))
                
                # Early exit if we have enough
                personal = [e for e in set(all_emails) if is_personal_email(e)]
                if len(personal) >= 3:
                    break
                    
            except Exception:
                continue
        
        db.update_target_status(domain, 'crawled')
        
        return {
            'domain': domain,
            'pages': len(pages),
            'emails': list(set(all_emails)),
            'email_contexts': email_contexts
        }
    
    # Process with progress
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console
    ) as progress:
        task = progress.add_task("Crawling...", total=len(work_items))
        
        def on_progress(item_id, status, result):
            progress.advance(task)
        
        results = await pool.process_queue(crawl_processor, on_progress)
    
    await pool.stop()
    
    return results


# ============ Parallel Salesforce Sending ============

async def parallel_send(
    send_items: List[Dict],
    num_workers: int = 30,
    headless: bool = False,
    review_mode: bool = False
) -> Dict:
    """
    Send emails through Salesforce in parallel using multiple browser sessions.
    
    Args:
        review_mode: If True, prepare emails but DON'T click send.
                    Opens all browsers with emails ready for manual review.
    """
    # Review mode requires visible browsers
    if review_mode:
        headless = False
    from services.salesforce_pages import GlobalSearch, LeadPage, EmailComposer
    
    pool = SalesforceWorkerPool(num_workers=num_workers, headless=headless)
    await pool.start()
    
    # Authenticate all workers
    authenticated = await pool.authenticate_all(timeout_minutes=10)
    
    if authenticated == 0:
        console.print("[red]No workers authenticated. Aborting.[/red]")
        await pool.stop()
        return {'error': 'No authenticated workers', 'sent': 0, 'failed': 0}
    
    # Only use authenticated workers
    pool.workers = [w for w in pool.workers if w.worker_id in pool.authenticated_workers]
    pool.num_workers = len(pool.workers)
    
    console.print(f"[blue]Processing {len(send_items)} sends with {pool.num_workers} workers[/blue]")
    
    # Create work items
    work_items = [
        WorkItem(
            id=str(item['id']),
            data=item,
            task_type='send',
            priority=item.get('priority', 0)
        )
        for item in send_items
    ]
    
    await pool.submit_work(work_items)
    
    async def send_processor(worker: BrowserWorker, item: WorkItem) -> Dict:
        """Process a single send task."""
        nonlocal review_mode  # Access review_mode from outer scope
        data = item.data
        send_id = data['id']
        
        # Create/find Lead
        lead_page = LeadPage(worker.page)
        search = GlobalSearch(worker.page)
        
        email = data.get('contact_email')
        company = data.get('company_name', data.get('domain', 'Unknown'))
        
        # Search for existing record
        record_url = None
        if email:
            await search.search(email)
            await asyncio.sleep(1)
            results = await search.get_search_results()
            if results and email.lower() in results[0]['text'].lower():
                await search.click_result_by_text(email)
                record_url = worker.page.url
        
        if not record_url:
            # Create new Lead
            await lead_page.create_new_lead()
            
            name = data.get('contact_name', '')
            name_parts = name.split() if name else []
            
            await lead_page.fill_lead_form(
                first_name=name_parts[0] if name_parts else None,
                last_name=' '.join(name_parts[1:]) if len(name_parts) > 1 else name_parts[0] if name_parts else 'Contact',
                company=company,
                title=data.get('contact_title'),
                email=email,
                website=f"https://{data.get('domain', '')}",
                description=f"Source: Automated Outreach\n{data.get('company_info', '')[:500]}"
            )
            
            record_url = await lead_page.save_lead()
        
        if not record_url:
            raise Exception("Failed to create/find Lead")
        
        # Navigate to record
        if record_url != worker.page.url:
            await worker.page.goto(record_url)
            await worker.page.wait_for_load_state('networkidle', timeout=15000)
        
        # Send email
        composer = EmailComposer(worker.page)
        if not await composer.open_email_composer():
            raise Exception("Failed to open email composer")
        
        await asyncio.sleep(1)
        
        if not await composer.fill_email(
            subject=data['planned_subject'],
            body=data['planned_body'],
            to=email
        ):
            raise Exception("Failed to fill email")
        
        # In review mode, don't click send
        if review_mode:
            # Just verify the send button is there
            if not await composer.send_email(skip_click=True):
                raise Exception("Email composer not ready")
            
            return {
                'sf_record_url': record_url,
                'status': 'ready_for_review',
                'worker_id': worker.worker_id
            }
        
        if not await composer.send_email():
            raise Exception("Failed to send email")
        
        # Update database
        db.update_send_queue_status(send_id, 'sent', record_url)
        db.log_send_result(
            send_queue_id=send_id,
            sf_record_url=record_url,
            result='sent',
            details='Sent via parallel worker'
        )
        
        return {'sf_record_url': record_url}
    
    # Process with progress
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console
    ) as progress:
        task = progress.add_task("Sending...", total=len(work_items))
        
        def on_progress(item_id, status, result):
            progress.advance(task)
            if status == 'failed':
                db.update_send_queue_status(int(item_id), 'failed')
                db.log_send_result(
                    send_queue_id=int(item_id),
                    result='failed',
                    details=str(result)
                )
        
        results = await pool.process_queue(send_processor, on_progress)
    
    stats = pool.get_stats()
    
    if review_mode:
        # Don't close browsers - keep them open for manual review
        console.print("\n" + "="*60)
        console.print("[bold yellow]  REVIEW MODE - ALL EMAILS READY[/bold yellow]")
        console.print(f"  {results['completed']} emails prepared across {stats['workers']} browser windows")
        console.print("  ")
        console.print("  -> Go to each browser window and review the email")
        console.print("  -> Click SEND in each window to send the email")
        console.print("  -> Close browser windows when done")
        console.print("="*60)
        
        # Wait for user to finish reviewing
        input("\nPress ENTER when you've finished reviewing and sending all emails...")
        
        await pool.stop()
        
        return {
            'ready_for_review': results['completed'],
            'failed': results['failed'],
            'workers_used': stats['workers'],
            'review_mode': True
        }
    
    await pool.stop()
    
    return {
        'sent': results['completed'],
        'failed': results['failed'],
        'workers_used': stats['workers'],
        'per_worker': stats['per_worker']
    }

