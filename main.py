"""
Main Orchestrator: Daily run pipeline for outreach system.
Coordinates all services in sequence.
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict
import typer
from rich.console import Console
from rich.table import Table

import config
import database as db
from services.crawler import import_seed_urls, crawl_pending_targets
from services.extractor import process_crawled_domains
from services.planner import plan_daily_sends, get_todays_send_queue
from services.salesforce_bot import run_salesforce_bot
from services.reporter import (
    print_daily_summary, 
    export_daily_report, 
    export_failures_bundle,
    get_pipeline_health,
    get_monthly_cost_projection
)
from services.worker_pool import parallel_crawl, parallel_send
from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts, get_linkedin_contacts
from services.email_pattern import discover_email_pattern, generate_email_for_contact, save_email_pattern, get_email_pattern
from services.email_discoverer import process_linkedin_contacts_with_patterns, discover_email_pattern as discover_pattern_web


app = typer.Typer(help="Salesforce Outreach Automation System")
console = Console()


@app.command()
def import_targets(csv_path: str):
    """Import targets from a seed_urls.csv file."""
    path = Path(csv_path)
    if not path.exists():
        console.print(f"[red]File not found: {csv_path}[/red]")
        raise typer.Exit(1)
    
    count = import_seed_urls(csv_path)
    console.print(f"[green]Imported {count} new targets[/green]")


@app.command()
def crawl(
    limit: int = 50,
    parallel: bool = typer.Option(False, help="Use parallel browser pool"),
    workers: int = typer.Option(None, help="Number of parallel workers")
):
    """Crawl pending targets to fetch content."""
    if parallel:
        num_workers = workers or config.NUM_BROWSER_WORKERS
        console.print(f"[blue]Starting PARALLEL crawl ({num_workers} workers, limit: {limit})...[/blue]")
        
        targets = db.get_pending_targets(limit)
        if not targets:
            console.print("[yellow]No pending targets[/yellow]")
            return
        
        results = asyncio.run(parallel_crawl(
            targets,
            num_workers=num_workers,
            headless=config.HEADLESS_MODE
        ))
        
        console.print(f"[green]Completed: {results['completed']}, Failed: {results['failed']}[/green]")
    else:
        console.print(f"[blue]Starting crawl (limit: {limit})...[/blue]")
        results = crawl_pending_targets(limit)
        
        success = sum(1 for r in results if r.get('status') == 'success')
        failed = len(results) - success
        
        console.print(f"[green]Crawled {success} domains successfully, {failed} failed[/green]")


@app.command()
def extract(limit: int = 50):
    """Extract contact information using LLM."""
    console.print(f"[blue]Starting extraction (limit: {limit})...[/blue]")
    candidates = process_crawled_domains(limit)
    console.print(f"[green]Extracted {len(candidates)} candidates[/green]")


@app.command()
def plan(limit: int = typer.Option(default=None, help="Override daily limit")):
    """Generate send plan for today."""
    if limit is None:
        limit = config.DAILY_SEND_LIMIT
    
    console.print(f"[blue]Planning sends (limit: {limit})...[/blue]")
    added = plan_daily_sends(limit)
    console.print(f"[green]Planned {added} sends for today[/green]")


@app.command()
def send(
    limit: int = typer.Option(default=None, help="Override daily limit"),
    headless: bool = typer.Option(False, help="Run browser in headless mode"),
    parallel: bool = typer.Option(True, help="Use parallel browser pool (30 browsers)"),
    workers: int = typer.Option(None, help="Number of parallel workers"),
    review: bool = typer.Option(False, "--review", help="REVIEW MODE: Prepare emails but don't send - you click send manually")
):
    """Execute sends through Salesforce (parallel by default)."""
    if limit is None:
        limit = config.DAILY_SEND_LIMIT
    
    if review:
        console.print("\n[bold yellow]=== REVIEW MODE ENABLED ===[/bold yellow]")
        console.print("[yellow]Emails will be prepared but NOT sent automatically.[/yellow]")
        console.print("[yellow]You must click SEND in each browser window.[/yellow]\n")
        headless = False  # Review mode requires visible browser
    
    if parallel:
        num_workers = workers or config.NUM_BROWSER_WORKERS
        console.print(f"[blue]Starting PARALLEL Salesforce ({num_workers} browsers)...[/blue]")
        console.print(f"[yellow]WARNING: {num_workers} browser windows will open for authentication[/yellow]")
        
        # Get pending sends
        pending = db.get_pending_sends(limit=limit)
        if not pending:
            console.print("[yellow]No pending sends[/yellow]")
            return
        
        console.print(f"[blue]Processing {len(pending)} {'emails to review' if review else 'sends'}...[/blue]")
        
        result = asyncio.run(parallel_send(
            pending,
            num_workers=num_workers,
            headless=headless,
            review_mode=review
        ))
        
        if result.get('error'):
            console.print(f"[red]Error: {result['error']}[/red]")
            raise typer.Exit(1)
        
        if review:
            console.print(f"\n[green]=== REVIEW SESSION COMPLETE ===[/green]")
            console.print(f"  [cyan]Prepared:[/cyan] {result.get('ready_for_review', 0)}")
            console.print(f"  [red]Failed to prepare:[/red] {result.get('failed', 0)}")
        else:
            console.print(f"\n[green]=== PARALLEL SEND COMPLETE ===[/green]")
            console.print(f"  [green]Sent:[/green] {result.get('sent', 0)}")
            console.print(f"  [red]Failed:[/red] {result.get('failed', 0)}")
            console.print(f"  [blue]Workers used:[/blue] {result.get('workers_used', 0)}")
            
            # Show per-worker stats
            if result.get('per_worker'):
                console.print("\n[dim]Per-worker breakdown:[/dim]")
                for w in result['per_worker'][:10]:  # Show first 10
                    console.print(f"  Worker {w['id']}: {w['completed']} sent, {w['failed']} failed")
    else:
        # Single-threaded mode
        mode_str = "REVIEW MODE" if review else "single-threaded"
        console.print(f"[blue]Starting Salesforce bot ({mode_str}, limit: {limit})...[/blue]")
        
        result = asyncio.run(run_salesforce_bot(limit=limit, headless=headless, review_mode=review))
        
        if result.get('error'):
            console.print(f"[red]Error: {result['error']}[/red]")
            raise typer.Exit(1)
        
        console.print(f"[green]Processed: {result.get('processed', 0)}[/green]")
        if review:
            console.print(f"  [cyan]Ready for review:[/cyan] {result.get('ready_for_review', 0)}")
        else:
            console.print(f"  [green]Sent:[/green] {result.get('sent', 0)}")
        console.print(f"  [red]Failed:[/red] {result.get('failed', 0)}")
        console.print(f"  [yellow]Skipped:[/yellow] {result.get('skipped', 0)}")


@app.command()
def daily_run(
    seed_csv: str = typer.Option(None, help="Path to seed_urls.csv to import"),
    crawl_limit: int = typer.Option(100, help="Max domains to crawl"),
    extract_limit: int = typer.Option(50, help="Max domains to extract"),
    send_limit: int = typer.Option(None, help="Override daily send limit"),
    headless: bool = typer.Option(False, help="Run browser in headless mode"),
    skip_send: bool = typer.Option(False, help="Skip the send step (plan only)"),
    parallel: bool = typer.Option(True, help="Use parallel processing (30 browsers)"),
    workers: int = typer.Option(None, help="Number of parallel workers")
):
    """
    Run the complete daily pipeline:
    1. Import new targets (optional)
    2. Crawl pending targets
    3. Extract contacts with LLM
    4. Generate send plan
    5. Execute sends via Salesforce
    6. Generate report
    """
    console.print("[bold blue]=== DAILY OUTREACH RUN ===[/bold blue]")
    console.print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    console.print()
    
    # Step 0: Import new targets
    if seed_csv:
        console.print("[bold]Step 0: Importing targets...[/bold]")
        if Path(seed_csv).exists():
            count = import_seed_urls(seed_csv)
            console.print(f"  Imported {count} new targets")
        else:
            console.print(f"  [yellow]Warning: {seed_csv} not found, skipping import[/yellow]")
        console.print()
    
    # Step 1: Crawl
    console.print("[bold]Step 1: Crawling pending targets...[/bold]")
    if parallel:
        num_workers = workers or config.NUM_BROWSER_WORKERS
        targets = db.get_pending_targets(crawl_limit)
        if targets:
            results = asyncio.run(parallel_crawl(targets, num_workers=num_workers, headless=True))
            console.print(f"  Crawled {results['completed']} domains ({results['failed']} failed)")
        else:
            console.print("  No pending targets")
    else:
        results = crawl_pending_targets(crawl_limit)
        success = sum(1 for r in results if r.get('status') == 'success')
        console.print(f"  Crawled {success}/{len(results)} domains successfully")
    console.print()
    
    # Step 2: Extract
    console.print("[bold]Step 2: Extracting contacts...[/bold]")
    candidates = process_crawled_domains(extract_limit)
    console.print(f"  Extracted {len(candidates)} candidates")
    console.print()
    
    # Step 3: Plan
    console.print("[bold]Step 3: Generating send plan...[/bold]")
    limit = send_limit or config.DAILY_SEND_LIMIT
    added = plan_daily_sends(limit)
    console.print(f"  Planned {added} sends")
    console.print()
    
    # Step 4: Send
    if not skip_send:
        console.print("[bold]Step 4: Executing sends via Salesforce...[/bold]")
        
        if parallel:
            num_workers = workers or config.NUM_BROWSER_WORKERS
            pending = db.get_pending_sends(limit=limit)
            if pending:
                console.print(f"  Using {num_workers} parallel browsers...")
                result = asyncio.run(parallel_send(pending, num_workers=num_workers, headless=headless))
            else:
                result = {'sent': 0, 'failed': 0}
        else:
            result = asyncio.run(run_salesforce_bot(limit=limit, headless=headless))
        
        if result.get('error'):
            console.print(f"  [red]Error: {result['error']}[/red]")
        else:
            console.print(f"  Sent: {result.get('sent', 0)}")
            console.print(f"  Failed: {result.get('failed', 0)}")
            if result.get('workers_used'):
                console.print(f"  Workers: {result.get('workers_used', 0)}")
        console.print()
    else:
        console.print("[bold]Step 4: Skipping send (--skip-send)[/bold]")
        console.print()
    
    # Step 5: Report
    console.print("[bold]Step 5: Generating reports...[/bold]")
    report_path = export_daily_report()
    console.print(f"  Report: {report_path}")
    
    # Export failures if any
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) as count FROM send_log 
            WHERE DATE(timestamp) = DATE('now') AND result = 'failed'
        """)
        failures = cursor.fetchone()['count']
    
    if failures > 0:
        failures_path = export_failures_bundle()
        console.print(f"  Failures bundle: {failures_path}")
    console.print()
    
    # Summary
    print_daily_summary()
    
    console.print(f"[bold green]Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/bold green]")


@app.command()
def status():
    """Show current pipeline status and health."""
    console.print("[bold]Pipeline Status[/bold]")
    console.print()
    
    # Health check
    health = get_pipeline_health()
    status_color = {
        'healthy': 'green',
        'warning': 'yellow',
        'critical': 'red'
    }.get(health['status'], 'white')
    
    console.print(f"Health: [{status_color}]{health['status'].upper()}[/{status_color}]")
    
    if health['issues']:
        console.print("\nIssues:")
        for issue in health['issues']:
            console.print(f"  [yellow]![/yellow] {issue}")
    console.print()
    
    # Queue status
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) as count FROM targets WHERE status = 'pending'")
        pending_targets = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM targets WHERE status = 'crawled'")
        crawled = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM candidates")
        candidates = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM send_queue WHERE status = 'pending'")
        queue = cursor.fetchone()['count']
    
    table = Table(title="Pipeline Counts")
    table.add_column("Stage", style="cyan")
    table.add_column("Count", style="green")
    
    table.add_row("Pending Targets", str(pending_targets))
    table.add_row("Crawled (awaiting extraction)", str(crawled))
    table.add_row("Total Candidates", str(candidates))
    table.add_row("Send Queue (pending)", str(queue))
    
    console.print(table)
    console.print()
    
    # Cost projection
    cost = get_monthly_cost_projection()
    console.print(f"[bold]LLM Cost Projection[/bold] (based on {cost['days_tracked']} days)")
    console.print(f"  Daily avg: ${cost['avg_daily']:.2f}")
    console.print(f"  Monthly projection: ${cost['projected_monthly']:.2f} / ${cost['budget']}")
    
    budget_pct = (cost['projected_monthly'] / cost['budget']) * 100 if cost['budget'] else 0
    budget_color = 'green' if budget_pct < 80 else 'yellow' if budget_pct < 100 else 'red'
    console.print(f"  Budget usage: [{budget_color}]{budget_pct:.0f}%[/{budget_color}]")


@app.command()
def report(
    date: str = typer.Option(None, help="Date (YYYY-MM-DD), defaults to today"),
    export_csv: bool = typer.Option(False, help="Export CSV report")
):
    """Show or export daily report."""
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    print_daily_summary(date)
    
    if export_csv:
        path = export_daily_report(date)
        console.print(f"Exported: {path}")


@app.command()
def queue():
    """Show today's send queue."""
    items = get_todays_send_queue()
    
    if not items:
        console.print("[yellow]No items in today's queue[/yellow]")
        return
    
    table = Table(title=f"Send Queue ({len(items)} items)")
    table.add_column("#", style="dim")
    table.add_column("Company", style="cyan")
    table.add_column("Contact", style="green")
    table.add_column("Email")
    table.add_column("Priority", style="yellow")
    table.add_column("Status")
    
    for i, item in enumerate(items[:50], 1):  # Show first 50
        table.add_row(
            str(i),
            (item.get('company_name') or item.get('domain', ''))[:25],
            (item.get('contact_name') or 'Unknown')[:20],
            (item.get('contact_email') or 'N/A')[:30],
            str(item.get('priority', 0)),
            item.get('status', 'pending')
        )
    
    console.print(table)
    
    if len(items) > 50:
        console.print(f"[dim]... and {len(items) - 50} more[/dim]")


@app.command()
def linkedin_scrape(
    domain: str = typer.Argument(..., help="Domain to scrape employees for"),
    company: str = typer.Option(None, help="Company name (if different from domain)"),
    max_contacts: int = typer.Option(50, help="Max contacts to scrape")
):
    """Scrape employee names from LinkedIn Sales Navigator for a company."""
    console.print(f"[blue]Scraping LinkedIn for: {domain}[/blue]")
    
    async def run():
        scraper = SalesNavigatorScraper()
        try:
            await scraper.start(headless=False)
            
            if not scraper.is_authenticated:
                if not await scraper.wait_for_login(timeout_minutes=15):
                    console.print("[red]Login timeout[/red]")
                    return
            
            result = await scraper.scrape_company_contacts(
                company or domain.split('.')[0].title(),
                domain,
                max_contacts=max_contacts
            )
            
            if result['employees']:
                company_display = company or domain.split('.')[0].title()
                save_linkedin_contacts(company_display, result['employees'], domain=domain)
                console.print(f"\n[green]Found {len(result['employees'])} contacts:[/green]")
                for emp in result['employees']:
                    console.print(f"  - {emp['name']}: {emp.get('title', 'N/A')}")
            else:
                console.print(f"[yellow]No employees found for {domain}[/yellow]")
                
        finally:
            await scraper.stop()
    
    asyncio.run(run())


@app.command()
def discover_pattern(
    domain: str = typer.Argument(..., help="Domain to discover email pattern for")
):
    """Discover a company's email pattern using Google search."""
    console.print(f"[blue]Discovering email pattern for: {domain}[/blue]")
    
    result = asyncio.run(discover_email_pattern(domain))
    
    if result['pattern']:
        save_email_pattern(domain, result['pattern'], result['confidence'], result['sample_emails'])
        console.print(f"\n[green]Pattern discovered:[/green] {result['pattern']}")
        console.print(f"[dim]Confidence: {result['confidence']:.0%}[/dim]")
        if result['sample_emails']:
            console.print(f"[dim]Sample emails found: {', '.join(result['sample_emails'][:5])}[/dim]")
    else:
        console.print("[yellow]Could not determine pattern[/yellow]")


@app.command()
def find_emails(
    reprocess: bool = typer.Option(False, help="Reprocess all domains even if already done"),
    workers: int = typer.Option(20, help="Number of parallel browser workers")
):
    """Find email patterns and generate emails with confidence scores for all contacts."""
    from services.email_finder import discover_company_pattern, generate_email_with_confidence
    from services.email_pattern import save_email_pattern, get_email_pattern
    
    # Get all contacts
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, domain, company, name, title, email_generated 
            FROM linkedin_contacts 
            WHERE domain IS NOT NULL
        """)
        all_contacts = [dict(row) for row in cursor.fetchall()]
    
    if not all_contacts:
        console.print("[yellow]No LinkedIn contacts found. Run linkedin-batch first.[/yellow]")
        return
    
    # Group by domain
    by_domain = {}
    for c in all_contacts:
        d = c['domain']
        if d not in by_domain:
            by_domain[d] = []
        by_domain[d].append(c)
    
    console.print(f"[bold blue]=== EMAIL FINDER ===[/bold blue]")
    console.print(f"Contacts: {len(all_contacts)}")
    console.print(f"Companies: {len(by_domain)}\n")
    
    # Check which need processing
    to_process = []
    for domain in by_domain.keys():
        existing = get_email_pattern(domain)
        if reprocess or not existing or existing.get('confidence', 0) < 0.4:
            to_process.append(domain)
        else:
            console.print(f"[dim]{domain}: Using cached pattern ({existing['pattern']} {existing['confidence']:.0%})[/dim]")
    
    # Process domains that need it
    if to_process:
        console.print(f"\n[blue]Discovering patterns for {len(to_process)} companies with {workers} workers...[/blue]\n")
        
        async def process_single_domain(domain: str, worker_id: int) -> Dict:
            """Process a single domain in a worker."""
            try:
                company = by_domain[domain][0].get('company', domain)
                employee_names = [c['name'] for c in by_domain[domain] if c.get('name')][:5]
                result = await discover_company_pattern(domain, company, employee_names)
                
                save_email_pattern(
                    domain, 
                    result['pattern'], 
                    result['confidence'], 
                    result['sample_emails']
                )
                
                return {'domain': domain, 'status': 'success', 'result': result}
                
            except Exception as e:
                save_email_pattern(domain, '{first}.{last}', 0.3, [])
                return {'domain': domain, 'status': 'error', 'error': str(e)}
        
        async def worker(worker_id: int, queue: asyncio.Queue, results: list):
            """Worker that processes domains from queue."""
            while True:
                try:
                    domain = await asyncio.wait_for(queue.get(), timeout=2)
                except asyncio.TimeoutError:
                    if queue.empty():
                        break
                    continue
                
                result = await process_single_domain(domain, worker_id)
                results.append(result)
                
                # Print result
                if result['status'] == 'success':
                    r = result['result']
                    conf_color = 'green' if r['confidence'] > 0.6 else 'yellow' if r['confidence'] > 0.4 else 'red'
                    console.print(f"[dim]W{worker_id}[/dim] {domain}: [{conf_color}]{r['pattern']} ({r['confidence']:.0%})[/{conf_color}]")
                else:
                    console.print(f"[dim]W{worker_id}[/dim] {domain}: [red]Error[/red]")
                
                queue.task_done()
                await asyncio.sleep(1)  # Small delay between domains per worker
        
        async def run_parallel():
            queue = asyncio.Queue()
            for d in to_process:
                await queue.put(d)
            
            results = []
            
            # Start workers
            tasks = [
                asyncio.create_task(worker(i, queue, results))
                for i in range(min(workers, len(to_process)))
            ]
            
            await asyncio.gather(*tasks)
            return results
        
        asyncio.run(run_parallel())
    
    # Generate emails for all contacts
    console.print(f"\n[blue]Generating emails with confidence scores...[/blue]\n")
    
    updated = 0
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        for domain, contacts in by_domain.items():
            pattern_data = get_email_pattern(domain)
            pattern = pattern_data['pattern'] if pattern_data else '{first}.{last}'
            confidence = pattern_data['confidence'] if pattern_data else 0.3
            
            for contact in contacts:
                result = generate_email_with_confidence(
                    contact['name'],
                    domain,
                    pattern,
                    confidence
                )
                
                if result:
                    cursor.execute("""
                        UPDATE linkedin_contacts 
                        SET email_generated = ?, email_confidence = ?
                        WHERE id = ?
                    """, (result['email'], result['confidence'], contact['id']))
                    updated += 1
        
        conn.commit()
    
    # Add email_confidence column if it doesn't exist
    try:
        with db.get_db() as conn:
            conn.execute("ALTER TABLE linkedin_contacts ADD COLUMN email_confidence INTEGER")
    except:
        pass
    
    console.print(f"[green]Updated {updated} contacts with emails![/green]")
    
    # Show summary
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                CASE 
                    WHEN email_confidence >= 70 THEN 'High (70%+)'
                    WHEN email_confidence >= 50 THEN 'Medium (50-69%)'
                    ELSE 'Low (<50%)'
                END as tier,
                COUNT(*) as count
            FROM linkedin_contacts
            WHERE email_generated IS NOT NULL
            GROUP BY tier
            ORDER BY tier DESC
        """)
        
        console.print(f"\n[bold]Confidence Distribution:[/bold]")
        for row in cursor.fetchall():
            console.print(f"  {row['tier']}: {row['count']} contacts")
    
    console.print(f"\nRun [bold]python main.py linkedin-export[/bold] to export CSV with confidence scores")


@app.command()
def linkedin_export():
    """Export all LinkedIn contacts to CSV with confidence scores."""
    import csv
    
    export_path = config.DATA_DIR / "linkedin_contacts.csv"
    
    # Add confidence column if missing
    try:
        with db.get_db() as conn:
            conn.execute("ALTER TABLE linkedin_contacts ADD COLUMN email_confidence INTEGER DEFAULT 30")
    except:
        pass
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT company, name, title, domain, email_generated, 
                   COALESCE(email_confidence, 30) as confidence
            FROM linkedin_contacts
            ORDER BY email_confidence DESC, company, name
        """)
        rows = cursor.fetchall()
    
    if not rows:
        console.print("[yellow]No contacts to export[/yellow]")
        return
    
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Company', 'Name', 'Title', 'Email', 'Confidence %', 'Domain'])
        for row in rows:
            writer.writerow([
                row['company'] or '',
                row['name'] or '',
                row['title'] or '',
                row['email_generated'] or '',
                row['confidence'] or 30,
                row['domain'] or ''
            ])
    
    console.print(f"[green]Exported {len(rows)} contacts to: {export_path}[/green]")
    console.print(f"[dim]Sorted by confidence (highest first)[/dim]")


@app.command()
def linkedin_contacts(
    domain: str = typer.Argument(None, help="Filter by domain (optional)"),
    export: bool = typer.Option(False, "--export", help="Export to CSV")
):
    """Show saved LinkedIn contacts."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        if domain:
            cursor.execute("""
                SELECT domain, company, name, title, email_generated, scraped_at
                FROM linkedin_contacts
                WHERE domain = ?
                ORDER BY scraped_at DESC
            """, (domain,))
        else:
            cursor.execute("""
                SELECT domain, company, name, title, email_generated, scraped_at
                FROM linkedin_contacts
                ORDER BY company, scraped_at DESC
            """)
        
        rows = cursor.fetchall()
        
        if not rows:
            console.print("[yellow]No LinkedIn contacts saved yet[/yellow]")
            return
        
        if export:
            # Export to CSV
            import csv
            export_path = config.DATA_DIR / "linkedin_contacts.csv"
            with open(export_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['Name', 'Title', 'Company', 'Email', 'Domain'])
                for row in rows:
                    writer.writerow([
                        row['name'],
                        row['title'] or '',
                        row['company'] or '',
                        row['email_generated'] or '',
                        row['domain']
                    ])
            console.print(f"[green]Exported {len(rows)} contacts to: {export_path}[/green]")
            return
        
        console.print(f"\n[bold]LinkedIn Contacts ({len(rows)} total)[/bold]\n")
        
        current_company = None
        for row in rows:
            company = row['company'] or row['domain']
            if company != current_company:
                current_company = company
                console.print(f"\n[blue]{current_company}[/blue]")
            
            email = row['email_generated'] or '[not generated]'
            console.print(f"  {row['name']}: {row['title'] or 'N/A'}")
            console.print(f"    Email: [green]{email}[/green]")


@app.command()
def generate_emails(
    domain: str = typer.Argument(..., help="Domain to generate emails for")
):
    """Generate emails for LinkedIn contacts using discovered pattern."""
    # Get pattern
    pattern_data = get_email_pattern(domain)
    if not pattern_data:
        console.print(f"[yellow]No pattern found for {domain}. Run 'discover-pattern' first.[/yellow]")
        return
    
    # Get contacts
    contacts = get_linkedin_contacts(domain)
    if not contacts:
        console.print(f"[yellow]No LinkedIn contacts for {domain}. Run 'linkedin-scrape' first.[/yellow]")
        return
    
    console.print(f"\n[blue]Generating emails using pattern: {pattern_data['pattern']}[/blue]\n")
    
    generated = []
    for contact in contacts:
        email = generate_email_for_contact(contact['name'], domain, pattern_data['pattern'])
        if email:
            generated.append({
                'name': contact['name'],
                'title': contact.get('title'),
                'email': email
            })
            console.print(f"  {contact['name']}: [green]{email}[/green]")
    
    console.print(f"\n[green]Generated {len(generated)} emails[/green]")
    
    # Save to database
    with db.get_db() as conn:
        cursor = conn.cursor()
        for g in generated:
            cursor.execute("""
                UPDATE linkedin_contacts 
                SET email_generated = ?
                WHERE domain = ? AND name = ?
            """, (g['email'], domain, g['name']))


@app.command()
def linkedin_pipeline(
    domain: str = typer.Argument(..., help="Domain to process"),
    company: str = typer.Option(None, help="Company name"),
    max_contacts: int = typer.Option(10, help="Max contacts")
):
    """Full pipeline: LinkedIn scrape -> Pattern discovery -> Email generation."""
    console.print(f"[bold blue]=== LINKEDIN EMAIL PIPELINE ===[/bold blue]")
    console.print(f"Domain: {domain}\n")
    
    async def run():
        # Step 1: Scrape LinkedIn
        console.print("[bold]Step 1: Scraping LinkedIn Sales Navigator...[/bold]")
        scraper = SalesNavigatorScraper()
        try:
            await scraper.start(headless=False)
            
            if not scraper.is_authenticated:
                if not await scraper.wait_for_login():
                    console.print("[red]Login timeout[/red]")
                    return
            
            result = await scraper.scrape_company_contacts(
                company or domain.split('.')[0].title(),
                domain,
                max_contacts=max_contacts
            )
            
            if result['employees']:
                company_display = company or domain.split('.')[0].title()
                save_linkedin_contacts(company_display, result['employees'], domain=domain)
                console.print(f"  Found {len(result['employees'])} contacts")
            else:
                console.print("[red]No employees found, aborting[/red]")
                return
                
        finally:
            await scraper.stop()
        
        # Step 2: Discover pattern
        console.print("\n[bold]Step 2: Discovering email pattern...[/bold]")
        pattern_result = await discover_email_pattern(domain)
        
        if pattern_result['pattern']:
            save_email_pattern(
                domain, 
                pattern_result['pattern'], 
                pattern_result['confidence'],
                pattern_result['sample_emails']
            )
            console.print(f"  Pattern: {pattern_result['pattern']} ({pattern_result['confidence']:.0%} confidence)")
        else:
            pattern_result['pattern'] = '{first}.{last}'
            console.print("  Using default: first.last")
        
        # Step 3: Generate emails
        console.print("\n[bold]Step 3: Generating emails...[/bold]")
        contacts = get_linkedin_contacts(domain)
        
        for contact in contacts:
            email = generate_email_for_contact(contact['name'], domain, pattern_result['pattern'])
            if email:
                console.print(f"  {contact['name']}: [green]{email}[/green]")
                
                # Save to database
                with db.get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE linkedin_contacts 
                        SET email_generated = ?
                        WHERE domain = ? AND name = ?
                    """, (email, domain, contact['name']))
        
        console.print(f"\n[green]Pipeline complete for {domain}[/green]")
    
    asyncio.run(run())


@app.command()
def linkedin_batch(
    workers: int = typer.Option(config.LINKEDIN_WORKERS, help="Number of parallel browsers (keep LOW, default 3 to avoid rate limits)"),
    max_contacts: int = typer.Option(50, help="Max contacts per company"),
    delay: int = typer.Option(10, help="Seconds delay between companies per worker"),
    export: bool = typer.Option(True, help="Export to CSV when done"),
    screen_width: int = typer.Option(1920, help="Your screen width"),
    screen_height: int = typer.Option(1080, help="Your screen height"),
    skip_done: bool = typer.Option(True, help="Skip companies already in database"),
    csv_file: str = typer.Option(None, help="Path to target CSV (default: target_companies.csv or seed_urls.csv)"),
    tier: str = typer.Option(None, help="Only process companies with this tier (A, B, C)")
):
    """Scrape LinkedIn for companies in target_companies.csv with parallel browsers in a grid.
    
    Expected CSV format:
        Tier,Company,Vertical,Target_Reason,Wedge
        A,DRB Facility Services,Facility services,...
    
    WARNING: LinkedIn rate-limits aggressively. Keep workers LOW (3-5).
    """
    import csv
    import math
    from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts
    
    # Find CSV file: explicit path > target_companies.csv > seed_urls.csv (legacy)
    if csv_file:
        seed_file = Path(csv_file)
    elif (config.DATA_DIR / "target_companies.csv").exists():
        seed_file = config.DATA_DIR / "target_companies.csv"
    else:
        seed_file = config.DATA_DIR / "seed_urls.csv"
    
    if not seed_file.exists():
        console.print(f"[red]CSV file not found: {seed_file}[/red]")
        console.print("[dim]Create data/target_companies.csv with columns: Tier,Company,Vertical,Target_Reason,Wedge[/dim]")
        return
    
    console.print(f"[dim]Loading companies from: {seed_file}[/dim]")
    
    # Load companies from CSV
    all_companies = []
    with open(seed_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        is_new_format = 'Company' in headers
        
        for row in reader:
            if is_new_format:
                # New format: Company name
                company_name = row.get('Company', '').strip()
                company_tier = row.get('Tier', '').strip()
                if not company_name:
                    continue
                # Filter by tier if specified
                if tier and company_tier.upper() != tier.upper():
                    continue
                # Support both old and new column names
                target_reason = (
                    row.get('Target_Reason', '') or 
                    row.get('Why this is a good Zco target', '')
                ).strip()
                wedge = (
                    row.get('Wedge', '') or 
                    row.get('Zco wedge', '')
                ).strip()
                all_companies.append({
                    'company_name': company_name,
                    'tier': company_tier,
                    'vertical': row.get('Vertical', '').strip(),
                    'target_reason': target_reason,
                    'wedge': wedge,
                })
            else:
                # Legacy format: derive company name from domain
                domain = row.get('domain_or_url', '').strip()
                if domain and not domain.startswith('http'):
                    company_name = domain.split('.')[0].replace('-', ' ').title()
                elif domain:
                    from urllib.parse import urlparse
                    parsed = urlparse(domain if domain.startswith('http') else f'http://{domain}')
                    domain = parsed.netloc or parsed.path.split('/')[0]
                    company_name = domain.split('.')[0].replace('-', ' ').title()
                else:
                    continue
                all_companies.append({
                    'company_name': company_name,
                    'domain': domain,
                    'tier': None,
                    'vertical': None,
                })
    
    # Skip companies already in database
    companies = all_companies
    if skip_done:
        with db.get_db() as conn:
            cursor = conn.cursor()
            # Check by company name (more reliable than domain now)
            cursor.execute("SELECT DISTINCT company_name FROM linkedin_contacts WHERE company_name IS NOT NULL")
            done_companies = {row['company_name'].lower() for row in cursor.fetchall()}
        
        companies = [c for c in all_companies if c['company_name'].lower() not in done_companies]
        if len(companies) < len(all_companies):
            console.print(f"[dim]Skipping {len(all_companies) - len(companies)} already-processed companies[/dim]")
    
    if not companies:
        console.print("[green]All companies already processed! Use --no-skip-done to reprocess.[/green]")
        return
    
    # Calculate grid layout
    cols = int(math.ceil(math.sqrt(workers)))
    rows = int(math.ceil(workers / cols))
    win_width = screen_width // cols
    win_height = screen_height // rows
    
    console.print(f"[bold blue]=== LINKEDIN PARALLEL BATCH ===[/bold blue]")
    console.print(f"Companies: {len(companies)}")
    if tier:
        console.print(f"Tier filter: {tier}")
    console.print(f"Workers: {workers} ({cols}x{rows} grid)")
    console.print(f"Window size: {win_width}x{win_height}")
    console.print(f"Max contacts/company: {max_contacts}\n")
    
    results = {'success': 0, 'failed': 0, 'total_contacts': 0, 'lock': asyncio.Lock()}
    
    def get_window_position(worker_id: int):
        """Calculate window position for grid layout."""
        row = worker_id // cols
        col = worker_id % cols
        x = col * win_width
        y = row * win_height
        return x, y, win_width, win_height
    
    async def worker_task(worker_id: int, company_queue: asyncio.Queue, auth_event: asyncio.Event):
        """Worker that processes companies from the queue."""
        from playwright.async_api import async_playwright
        
        x, y, w, h = get_window_position(worker_id)
        
        playwright = await async_playwright().start()
        
        # Load session if exists
        storage_path = config.DATA_DIR / "linkedin_auth.json"
        context_opts = {'viewport': {'width': w - 20, 'height': h - 100}}
        if storage_path.exists():
            context_opts['storage_state'] = str(storage_path)
        
        browser = await playwright.chromium.launch(
            headless=False,
            args=[f'--window-position={x},{y}', f'--window-size={w},{h}']
        )
        context = await browser.new_context(**context_opts)
        page = await context.new_page()
        
        is_authenticated = False
        
        try:
            # Check auth
            await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
            await asyncio.sleep(3)
            
            if '/sales/' in page.url and 'login' not in page.url:
                is_authenticated = True
                console.print(f"[green]Worker {worker_id}: Authenticated[/green]")
            else:
                console.print(f"[yellow]Worker {worker_id}: Waiting for login...[/yellow]")
                # Wait for first worker to authenticate
                await auth_event.wait()
                # Reload with new session
                if storage_path.exists():
                    await context.close()
                    context = await browser.new_context(
                        storage_state=str(storage_path),
                        viewport={'width': w - 20, 'height': h - 100}
                    )
                    page = await context.new_page()
                    await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                    await asyncio.sleep(2)
                    is_authenticated = '/sales/' in page.url
            
            if not is_authenticated:
                console.print(f"[red]Worker {worker_id}: Auth failed[/red]")
                return
            
            # Process companies from queue
            while True:
                try:
                    company_info = await asyncio.wait_for(company_queue.get(), timeout=5)
                except asyncio.TimeoutError:
                    if company_queue.empty():
                        break
                    continue
                
                try:
                    # Get company name directly from queue item
                    company_name = company_info['company_name']
                    company_tier = company_info.get('tier', '')
                    tier_prefix = f"[{company_tier}] " if company_tier else ""
                    console.print(f"[dim]Worker {worker_id}: {tier_prefix}{company_name}[/dim]")
                    
                    # Search for company
                    search_input = page.locator('input[placeholder*="Search"]').first
                    await search_input.click()
                    await asyncio.sleep(0.5)
                    await search_input.fill(company_name)
                    await asyncio.sleep(1)
                    await search_input.press('Enter')
                    await asyncio.sleep(4)
                    
                    # Switch to Accounts
                    accounts_tab = page.locator('button:has-text("Accounts")').first
                    if await accounts_tab.count() > 0:
                        await accounts_tab.click()
                        await asyncio.sleep(3)
                    
                    # Click company
                    company_link = page.locator('a[href*="/sales/company/"]').first
                    if await company_link.count() > 0:
                        await company_link.click()
                        await asyncio.sleep(3)
                        
                        # Click Decision Makers
                        dm_link = page.locator('a:has-text("Decision maker")').first
                        if await dm_link.count() > 0:
                            await dm_link.click()
                            await asyncio.sleep(4)
                            
                            # Scroll and collect
                            for _ in range(10):
                                await page.evaluate("""
                                    const c = document.querySelector('#search-results-container');
                                    if (c) c.scrollTop += 800;
                                """)
                                await asyncio.sleep(1)
                            
                            # Extract contacts
                            cards = page.locator('[data-x-search-result="LEAD"]')
                            count = await cards.count()
                            
                            employees = []
                            for i in range(min(count, max_contacts)):
                                card = cards.nth(i)
                                name_el = card.locator('[data-anonymize="person-name"]').first
                                title_el = card.locator('[data-anonymize="title"]').first
                                
                                name = await name_el.text_content() if await name_el.count() > 0 else None
                                title = await title_el.text_content() if await title_el.count() > 0 else None
                                
                                if name and len(name.strip()) > 2:
                                    employees.append({
                                        'name': name.strip(),
                                        'title': title.strip() if title else None,
                                        'linkedin_url': None
                                    })
                            
                            if employees:
                                # Use company name as the identifier (no domain needed)
                                save_linkedin_contacts(company_name, employees)
                                async with results['lock']:
                                    results['success'] += 1
                                    results['total_contacts'] += len(employees)
                                console.print(f"[green]Worker {worker_id}: {company_name} - {len(employees)} contacts[/green]")
                            else:
                                async with results['lock']:
                                    results['failed'] += 1
                                console.print(f"[yellow]Worker {worker_id}: {company_name} - no contacts[/yellow]")
                        else:
                            async with results['lock']:
                                results['failed'] += 1
                            console.print(f"[yellow]Worker {worker_id}: {company_name} - no DM link[/yellow]")
                    else:
                        async with results['lock']:
                            results['failed'] += 1
                        console.print(f"[yellow]Worker {worker_id}: {company_name} - company not found[/yellow]")
                    
                    # Go back to home for next search
                    await page.goto("https://www.linkedin.com/sales/home", timeout=15000)
                    await asyncio.sleep(delay)  # Delay between companies to avoid rate limits
                    
                except Exception as e:
                    async with results['lock']:
                        results['failed'] += 1
                    console.print(f"[red]Worker {worker_id}: {company_name} - {e}[/red]")
                
                company_queue.task_done()
                
        finally:
            try:
                await context.close()
                await browser.close()
                await playwright.stop()
            except:
                pass
    
    async def run_parallel():
        # Create queue with all companies
        queue = asyncio.Queue()
        for c in companies:
            await queue.put(c)
        
        auth_event = asyncio.Event()
        
        # First, authenticate with one browser
        console.print("[yellow]Opening first browser for authentication...[/yellow]")
        console.print("[yellow]Log in to LinkedIn Sales Navigator, then the rest will start.[/yellow]\n")
        
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=False)
        storage_path = config.DATA_DIR / "linkedin_auth.json"
        
        ctx_opts = {}
        if storage_path.exists():
            ctx_opts['storage_state'] = str(storage_path)
        
        ctx = await browser.new_context(**ctx_opts)
        page = await ctx.new_page()
        
        await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
        await asyncio.sleep(3)
        
        # Wait for auth
        for _ in range(180):  # 3 minutes
            if '/sales/' in page.url and 'login' not in page.url:
                console.print("[green]Authenticated! Saving session...[/green]")
                await ctx.storage_state(path=str(storage_path))
                break
            await asyncio.sleep(1)
        
        await ctx.close()
        await browser.close()
        await pw.stop()
        
        auth_event.set()
        console.print(f"\n[bold]Starting {workers} parallel workers...[/bold]\n")
        
        # Start workers
        tasks = [
            asyncio.create_task(worker_task(i, queue, auth_event))
            for i in range(workers)
        ]
        
        await asyncio.gather(*tasks)
    
    asyncio.run(run_parallel())
    
    console.print(f"\n[bold]=== BATCH COMPLETE ===[/bold]")
    console.print(f"Success: {results['success']}")
    console.print(f"Failed: {results['failed']}")
    console.print(f"Total contacts: {results['total_contacts']}")
    
    # Export
    if export:
        import csv
        export_path = config.DATA_DIR / "linkedin_contacts.csv"
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT company, name, title, domain, email_generated
                FROM linkedin_contacts ORDER BY company, name
            """)
            rows = cursor.fetchall()
        
        with open(export_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Company', 'Name', 'Title', 'Domain', 'Email'])
            for row in rows:
                writer.writerow([row['company'] or '', row['name'] or '', row['title'] or '', row['domain'] or '', row['email_generated'] or ''])
        
        console.print(f"\n[green]Exported {len(rows)} contacts to: {export_path}[/green]")


@app.command()
def linkedin_debug():
    """Open Sales Navigator and wait - for debugging selectors."""
    console.print("[blue]Opening Sales Navigator for debugging...[/blue]")
    console.print("[yellow]Navigate manually and I'll capture the page structure[/yellow]")
    
    async def run():
        from services.linkedin_scraper import SalesNavigatorScraper
        scraper = SalesNavigatorScraper()
        
        try:
            await scraper.start(headless=False)
            
            if not scraper.is_authenticated:
                if not await scraper.wait_for_login():
                    console.print("[red]Login timeout[/red]")
                    return
            
            console.print("\n[green]Logged in! Now navigate to a Lead Search.[/green]")
            console.print("Go to: https://www.linkedin.com/sales/search/people")
            console.print("\nSet up the filters you want (Company, Title, etc)")
            console.print("Then press ENTER here when ready...")
            
            input()  # Wait for user
            
            # Capture the current URL and page structure
            console.print(f"\n[bold]Current URL:[/bold] {scraper.page.url}")
            
            # Save the HTML for analysis
            html = await scraper.page.content()
            debug_path = config.DATA_DIR / "linkedin_debug.html"
            debug_path.write_text(html, encoding='utf-8')
            console.print(f"[green]Saved page HTML to: {debug_path}[/green]")
            
            # Try to find filter elements
            console.print("\n[bold]Looking for filter elements...[/bold]")
            
            filter_selectors = [
                'button[aria-label*="Company"]',
                'button[aria-label*="Title"]', 
                'button[aria-label*="Seniority"]',
                '[data-test-filter]',
                '.search-filter',
                '.filter-container',
            ]
            
            for sel in filter_selectors:
                count = await scraper.page.locator(sel).count()
                if count > 0:
                    console.print(f"  Found: {sel} ({count} elements)")
            
            console.print("\nPress ENTER to close...")
            input()
            
        finally:
            await scraper.stop()
    
    asyncio.run(run())


@app.command()
def init():
    """Initialize the database and directories."""
    console.print("Initializing...")
    
    # Database is auto-initialized on import
    db.init_database()
    console.print("  [green]OK[/green] Database initialized")
    
    # Ensure directories exist
    config.DATA_DIR.mkdir(exist_ok=True)
    config.PAGES_DIR.mkdir(exist_ok=True)
    config.SCREENSHOTS_DIR.mkdir(exist_ok=True)
    (config.DATA_DIR / "reports").mkdir(exist_ok=True)
    console.print("  [green]OK[/green] Directories created")
    
    # Create sample seed_urls.csv
    sample_csv = config.DATA_DIR / "seed_urls.csv"
    if not sample_csv.exists():
        sample_csv.write_text("domain_or_url,source,notes\nexample.com,manual,Sample entry\n")
        console.print(f"  [green]OK[/green] Created sample {sample_csv}")
    
    # Create .env template if not exists
    env_file = config.BASE_DIR / ".env"
    if not env_file.exists():
        env_content = """# Outreach Configuration
OPENAI_API_KEY=your-openai-api-key-here
SALESFORCE_URL=https://your-org.lightning.force.com
SENDER_NAME=Your Name
VALUE_PROP=streamline their outreach
"""
        env_file.write_text(env_content)
        console.print(f"  [green]OK[/green] Created .env template")
    
    console.print("[green]Initialization complete![/green]")
    console.print("\nNext steps:")
    console.print("  1. Edit .env with your API keys and settings")
    console.print("  2. Add targets to data/seed_urls.csv")
    console.print("  3. Run: python main.py daily-run --seed-csv data/seed_urls.csv")


@app.command()
def test_patterns():
    """
    Generate test emails to discover which pattern works per company.
    Sends all pattern variants to ONE person per company.
    The one that doesn't bounce = correct pattern.
    """
    from services.pattern_tester import create_test_queue, print_test_summary, get_test_email_body
    import csv
    
    console.print("[bold]Pattern Test Plan[/bold]")
    console.print("Strategy: Send test emails with ALL patterns to ONE person per company.")
    console.print("The pattern that doesn't bounce = correct pattern for that domain.\n")
    
    test_queue = create_test_queue()
    print_test_summary(test_queue)
    
    # Save test plan to CSV
    export_path = config.DATA_DIR / "pattern_test_queue.csv"
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['domain', 'company', 'name', 'title', 'pattern', 'email', 'status'])
        writer.writeheader()
        writer.writerows(test_queue)
    
    console.print(f"\n[green]Test plan saved to {export_path}[/green]")
    
    # Show what to do next
    domains = set(t['domain'] for t in test_queue)
    console.print(f"\n[bold]Next Steps:[/bold]")
    console.print(f"  1. You'll send ~{len(test_queue)} test emails ({len(domains)} companies x 5 patterns)")
    console.print(f"  2. Wait 24-48 hours for bounces")
    console.print(f"  3. Check which emails bounced in Salesforce")
    console.print(f"  4. The pattern that DIDN'T bounce = correct pattern")
    console.print(f"\nRun [cyan]python main.py send-tests[/cyan] to send via Salesforce")


@app.command()
def send_tests(
    limit: int = typer.Option(None, help="Limit number of test emails to send"),
    review: bool = typer.Option(True, help="Pause before each send for manual approval")
):
    """
    Send pattern test emails through Salesforce.
    Opens Salesforce, creates Leads, sends test emails.
    """
    import csv
    from services.salesforce_bot import SalesforceBot
    from services.pattern_tester import get_test_email_body
    
    test_file = config.DATA_DIR / "pattern_test_queue.csv"
    if not test_file.exists():
        console.print("[red]No test queue found. Run 'python main.py test-patterns' first.[/red]")
        return
    
    # Load test queue
    with open(test_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        all_tests = list(reader)
    
    tests = [t for t in all_tests if t.get('status', 'pending') == 'pending']
    
    if limit:
        tests = tests[:limit]
    
    if not tests:
        console.print("[yellow]No pending tests to send.[/yellow]")
        return
    
    console.print(f"[bold]Sending {len(tests)} test emails via Salesforce[/bold]")
    console.print(f"Review mode: {review} (will pause before each send)\n")
    
    async def run_tests():
        bot = SalesforceBot()
        await bot.start(headless=False)
        
        sent_count = 0
        results = []
        
        try:
            for i, test in enumerate(tests):
                company = test.get('company', '')
                name = test.get('name', '')
                email = test.get('email', '')
                pattern = test.get('pattern', '')
                
                console.print(f"\n[{i+1}/{len(tests)}] {email} ({pattern})")
                
                # Parse name
                name_parts = name.split() if name else ['Test', 'Contact']
                first_name = name_parts[0] if name_parts else 'Test'
                last_name = name_parts[-1] if len(name_parts) > 1 else 'Contact'
                
                # Create Lead
                console.print(f"  Creating Lead: {email}")
                lead_url = await bot.create_or_update_lead(
                    first_name=first_name,
                    last_name=last_name,
                    company=company or 'Unknown',
                    email=email,
                    title=test.get('title', ''),
                    lead_source='Pattern Test'
                )
                lead_created = lead_url is not None
                
                if not lead_created:
                    console.print(f"  [red]Failed to create Lead[/red]")
                    results.append({**test, 'status': 'failed', 'reason': 'create_failed'})
                    continue
                
                # Send test email
                subject = f"Quick question for {company}"
                body = get_test_email_body(name, company)
                
                console.print(f"  Sending email...")
                sent = await bot.send_email_from_record(
                    subject=subject,
                    body=body,
                    to_email=email,
                    review_mode=review
                )
                
                if review:
                    console.print(f"  [yellow]Review mode - check the email and click Send manually[/yellow]")
                    console.print(f"  Press Enter when done...")
                    input()
                
                if sent or review:
                    sent_count += 1
                    results.append({**test, 'status': 'sent'})
                    console.print(f"  [green]Sent![/green]")
                else:
                    results.append({**test, 'status': 'failed', 'reason': 'send_failed'})
                    console.print(f"  [red]Failed to send[/red]")
                
                await asyncio.sleep(2)  # Rate limiting
                
        finally:
            await bot.stop()
        
        return results, sent_count
    
    results, sent_count = asyncio.run(run_tests())
    
    # Update test queue with results
    for test in all_tests:
        for r in results:
            if test['email'] == r['email']:
                test['status'] = r.get('status', test.get('status', 'pending'))
    
    with open(test_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=all_tests[0].keys())
        writer.writeheader()
        writer.writerows(all_tests)
    
    console.print(f"\n[green]Sent {sent_count}/{len(tests)} test emails[/green]")
    console.print(f"Results saved to {test_file}")
    console.print(f"\n[cyan]Next: Wait 24 hours, then run 'python main.py check-bounces'[/cyan]")


@app.command()
def check_bounces():
    """
    Check Salesforce for bounced test emails and determine winning patterns.
    Run this 24 hours after sending test emails.
    """
    import csv
    
    console.print("[bold]Bounce Check Guide[/bold]\n")
    
    console.print("After sending test emails, check bounces in Salesforce:")
    console.print("")
    console.print("  [cyan]1. Go to Setup → Email Logs[/cyan]")
    console.print("     - Request logs for the past 24-48 hours")
    console.print("     - Look for 'Bounced' status")
    console.print("")
    console.print("  [cyan]2. Check Lead records[/cyan]")
    console.print("     - Look for 'Email Bounced' indicator")
    console.print("     - Or 'Invalid Email' checkbox")
    console.print("")
    console.print("  [cyan]3. Manual pattern recording[/cyan]")
    console.print("     - For each company, note which pattern(s) bounced")
    console.print("     - The one that DIDN'T bounce = correct pattern")
    console.print("")
    
    # Load test queue to show what to check
    test_file = config.DATA_DIR / "pattern_test_queue.csv"
    if test_file.exists():
        with open(test_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            tests = list(reader)
        
        domains = sorted(set(t['domain'] for t in tests))
        console.print(f"\n[bold]Companies to check ({len(domains)}):[/bold]")
        for d in domains[:10]:
            console.print(f"  • {d}")
        if len(domains) > 10:
            console.print(f"  ... and {len(domains) - 10} more")
        
        console.print(f"\n[yellow]Update {test_file} with bounce status, then run:[/yellow]")
        console.print("[cyan]python main.py apply-patterns[/cyan]")


@app.command()
def apply_patterns():
    """
    Apply winning patterns from bounce test results to all contacts.
    """
    import csv
    from services.simple_email import generate_email
    
    test_file = config.DATA_DIR / "pattern_test_queue.csv"
    if not test_file.exists():
        console.print("[red]No test results found.[/red]")
        return
    
    # Load test results
    with open(test_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        tests = list(reader)
    
    # Find winning pattern per domain (status != 'bounced')
    from collections import defaultdict
    by_domain = defaultdict(list)
    for t in tests:
        by_domain[t['domain']].append(t)
    
    winners = {}
    for domain, results in by_domain.items():
        # Find non-bounced patterns
        working = [r for r in results if r.get('status') not in ('bounced', 'bounce')]
        if working:
            # Prefer first.last if it works
            for preferred in ['first.last', 'flast', 'firstlast', 'first_last', 'first']:
                for r in working:
                    if r['pattern'] == preferred:
                        winners[domain] = preferred
                        break
                if domain in winners:
                    break
    
    console.print(f"\n[bold]Winning patterns found: {len(winners)}/{len(by_domain)}[/bold]")
    
    # Apply to all contacts
    updated = 0
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, domain, name FROM linkedin_contacts")
        contacts = cursor.fetchall()
        
        for c in contacts:
            domain = c['domain']
            if domain in winners:
                pattern = winners[domain]
                email = generate_email(c['name'], domain, pattern.replace('.', '_').replace('-', '_'))
                if email:
                    conn.execute("""
                        UPDATE linkedin_contacts 
                        SET email_generated = ?, email_confidence = 90
                        WHERE id = ?
                    """, (email, c['id']))
                    updated += 1
    
    console.print(f"[green]Updated {updated} contacts with verified patterns![/green]")
    console.print("\nConfidence: 90% (pattern verified by bounce test)")


@app.command()
def simple_emails():
    """
    Generate emails using simple first.last@domain.com pattern.
    Honest about confidence (~65%). No fake Google searches.
    """
    from services.simple_email import bulk_generate, check_mx
    import csv
    
    console.print("[bold]Simple Email Generator[/bold]")
    console.print("Pattern: first.last@domain.com")
    console.print("Estimated accuracy: ~65-70% for B2B companies\n")
    
    # Get all contacts
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, domain, company, name, title
            FROM linkedin_contacts
        """)
        rows = cursor.fetchall()
    
    contacts = [dict(row) for row in rows]
    console.print(f"Processing {len(contacts)} contacts...")
    
    # Generate emails
    result = bulk_generate(contacts)
    
    # Update database
    updated = 0
    with db.get_db() as conn:
        for c in result['contacts']:
            conn.execute("""
                UPDATE linkedin_contacts 
                SET email_generated = ?, email_confidence = ?
                WHERE id = ?
            """, (c['email'], c['email_confidence'], c['id']))
            updated += 1
    
    # Print summary
    console.print(f"\n[green]Generated {updated} emails[/green]")
    console.print(f"  MX Valid: {result['mx_valid']} domains can receive email")
    console.print(f"  MX Invalid: {result['mx_invalid']} domains may not work")
    console.print(f"\n[yellow]Note: {result['note']}[/yellow]")
    
    # Export to CSV
    export_path = config.DATA_DIR / "emails_generated.csv"
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['company', 'name', 'title', 'email', 'confidence', 'mx_valid'])
        writer.writeheader()
        for c in result['contacts']:
            writer.writerow({
                'company': c.get('company', ''),
                'name': c.get('name', ''),
                'title': c.get('title', ''),
                'email': c.get('email', ''),
                'confidence': c.get('email_confidence', 65),
                'mx_valid': c.get('mx_valid', False)
            })
    
    console.print(f"\n[green]Exported to {export_path}[/green]")


@app.command()
def discover_emails(
    today_only: bool = typer.Option(False, "--today", help="Only process contacts scraped today")
):
    """
    Discover email patterns for all companies using web search + GPT-4o.
    
    For each company in LinkedIn contacts:
    1. Searches the web for email examples (via Tavily)
    2. Uses GPT-4o to analyze and determine the pattern
    3. Generates emails for all contacts
    4. Exports to CSV with confidence scores
    
    Requires: TAVILY_API_KEY and OPENAI_API_KEY in .env
    """
    if not config.TAVILY_API_KEY:
        console.print("[red]ERROR: TAVILY_API_KEY not set![/red]")
        console.print("Get a free API key at: https://tavily.com")
        console.print("Add to .env: TAVILY_API_KEY=your_key_here")
        return
    
    if not config.OPENAI_API_KEY:
        console.print("[red]ERROR: OPENAI_API_KEY not set![/red]")
        return
    
    console.print("[bold blue]=== EMAIL PATTERN DISCOVERY ===[/bold blue]")
    console.print("Using web search + GPT-4o to discover email patterns")
    if today_only:
        console.print("[yellow]Filtering: Today's contacts only[/yellow]")
    console.print()
    
    result = process_linkedin_contacts_with_patterns(today_only=today_only)
    
    console.print(f"\n[bold green]=== COMPLETE ===[/bold green]")
    console.print(f"Companies processed: {result['companies']}")
    console.print(f"Contacts with emails: {result['contacts']}")
    console.print(f"Output: {result['output_path']}")
    
    # Show pattern summary
    if result.get('patterns'):
        console.print("\n[bold]Discovered Patterns:[/bold]")
        for company, info in list(result['patterns'].items())[:10]:
            conf = info['confidence']
            conf_color = "green" if conf >= 0.7 else "yellow" if conf >= 0.5 else "red"
            console.print(f"  {company}: [{conf_color}]{info['pattern']}[/{conf_color}] ({conf:.0%})")
        
        if len(result['patterns']) > 10:
            console.print(f"  ... and {len(result['patterns']) - 10} more")


@app.command()
def scrape_and_enrich(
    workers: int = typer.Option(config.LINKEDIN_WORKERS, help="LinkedIn browser workers"),
    max_contacts: int = typer.Option(50, help="Max contacts per company"),
    tier: str = typer.Option(None, help="Only process companies with this tier (A, B, C)"),
    csv_file: str = typer.Option(None, help="Path to target CSV"),
    skip_done: bool = typer.Option(True, help="Skip already-scraped companies"),
    delay: int = typer.Option(10, help="Delay between companies (seconds)")
):
    """
    FULL PIPELINE: Scrape LinkedIn → Discover email patterns → Export CSV.
    
    Runs in sequence:
    1. LinkedIn batch scrape (from target_companies.csv)
    2. Email pattern discovery (web search + GPT-4o) 
    3. Export today's contacts with emails
    
    Output: data/linkedin_contacts_YYYY-MM-DD.csv
    """
    import subprocess
    import sys
    from datetime import datetime
    
    console.print("[bold blue]╔══════════════════════════════════════════╗[/bold blue]")
    console.print("[bold blue]║     LINKEDIN SCRAPE + EMAIL ENRICHMENT   ║[/bold blue]")
    console.print("[bold blue]╚══════════════════════════════════════════╝[/bold blue]")
    console.print()
    
    # Check API keys
    if not config.TAVILY_API_KEY:
        console.print("[red]ERROR: TAVILY_API_KEY not set![/red]")
        console.print("Get a free API key at: https://tavily.com")
        return
    
    if not config.OPENAI_API_KEY:
        console.print("[red]ERROR: OPENAI_API_KEY not set![/red]")
        return
    
    # ═══════════════════════════════════════════════════════════════
    # STEP 1: LinkedIn Batch Scrape
    # ═══════════════════════════════════════════════════════════════
    console.print("\n[bold cyan]STEP 1/2: LinkedIn Scraping[/bold cyan]")
    console.print("─" * 45)
    
    # Call linkedin_batch with the same parameters
    # We need to run it directly since it uses asyncio
    import csv as csv_module
    import math
    from services.linkedin_scraper import SalesNavigatorScraper, save_linkedin_contacts
    
    # Find CSV file
    if csv_file:
        seed_file = Path(csv_file)
    elif (config.DATA_DIR / "target_companies.csv").exists():
        seed_file = config.DATA_DIR / "target_companies.csv"
    else:
        seed_file = config.DATA_DIR / "seed_urls.csv"
    
    if not seed_file.exists():
        console.print(f"[red]CSV file not found: {seed_file}[/red]")
        return
    
    console.print(f"Loading from: {seed_file}")
    
    # Load companies
    all_companies = []
    with open(seed_file, 'r', encoding='utf-8') as f:
        reader = csv_module.DictReader(f)
        headers = reader.fieldnames or []
        is_new_format = 'Company' in headers
        
        for row in reader:
            if is_new_format:
                company_name = row.get('Company', '').strip()
                company_tier = row.get('Tier', '').strip()
                if not company_name:
                    continue
                if tier and company_tier.upper() != tier.upper():
                    continue
                target_reason = (
                    row.get('Target_Reason', '') or 
                    row.get('Why this is a good Zco target', '')
                ).strip()
                wedge = (
                    row.get('Wedge', '') or 
                    row.get('Zco wedge', '')
                ).strip()
                all_companies.append({
                    'company_name': company_name,
                    'tier': company_tier,
                    'vertical': row.get('Vertical', '').strip(),
                    'target_reason': target_reason,
                    'wedge': wedge,
                })
            else:
                domain = row.get('domain_or_url', '').strip()
                if domain and not domain.startswith('http'):
                    company_name = domain.split('.')[0].replace('-', ' ').title()
                elif domain:
                    from urllib.parse import urlparse
                    parsed = urlparse(domain if domain.startswith('http') else f'http://{domain}')
                    domain = parsed.netloc or parsed.path.split('/')[0]
                    company_name = domain.split('.')[0].replace('-', ' ').title()
                else:
                    continue
                all_companies.append({
                    'company_name': company_name,
                    'domain': domain,
                    'tier': None,
                })
    
    # Skip already done
    companies = all_companies
    if skip_done:
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT company_name FROM linkedin_contacts WHERE company_name IS NOT NULL")
            done = {row['company_name'].lower() for row in cursor.fetchall()}
        companies = [c for c in all_companies if c['company_name'].lower() not in done]
        if len(companies) < len(all_companies):
            console.print(f"[dim]Skipping {len(all_companies) - len(companies)} already-processed[/dim]")
    
    if not companies:
        console.print("[yellow]No new companies to scrape - proceeding to email enrichment[/yellow]")
    else:
        console.print(f"Companies to scrape: {len(companies)}")
        if tier:
            console.print(f"Tier filter: {tier}")
        console.print(f"Workers: {workers} (parallel browsers)")
        console.print()
        
        # Run parallel LinkedIn scrape (same as linkedin-batch)
        import math
        
        screen_width = 1920
        screen_height = 1080
        cols = int(math.ceil(math.sqrt(workers)))
        rows = int(math.ceil(workers / cols))
        win_width = screen_width // cols
        win_height = screen_height // rows
        
        results = {'success': 0, 'failed': 0, 'total_contacts': 0, 'lock': asyncio.Lock()}
        
        def get_window_position(worker_id: int):
            row = worker_id // cols
            col = worker_id % cols
            return col * win_width, row * win_height, win_width, win_height
        
        async def worker_task(worker_id: int, company_queue: asyncio.Queue, auth_event: asyncio.Event):
            from playwright.async_api import async_playwright
            
            x, y, w, h = get_window_position(worker_id)
            
            playwright = await async_playwright().start()
            storage_path = config.DATA_DIR / "linkedin_auth.json"
            context_opts = {'viewport': {'width': w - 20, 'height': h - 100}}
            if storage_path.exists():
                context_opts['storage_state'] = str(storage_path)
            
            browser = await playwright.chromium.launch(
                headless=False,
                args=[f'--window-position={x},{y}', f'--window-size={w},{h}']
            )
            context = await browser.new_context(**context_opts)
            page = await context.new_page()
            
            is_authenticated = False
            
            try:
                await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                await asyncio.sleep(3)
                
                if '/sales/' in page.url and 'login' not in page.url:
                    is_authenticated = True
                    console.print(f"[green]Worker {worker_id}: Authenticated[/green]")
                else:
                    console.print(f"[yellow]Worker {worker_id}: Waiting for login...[/yellow]")
                    await auth_event.wait()
                    if storage_path.exists():
                        await context.close()
                        context = await browser.new_context(
                            storage_state=str(storage_path),
                            viewport={'width': w - 20, 'height': h - 100}
                        )
                        page = await context.new_page()
                        await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                        await asyncio.sleep(2)
                        is_authenticated = '/sales/' in page.url
                
                if not is_authenticated:
                    console.print(f"[red]Worker {worker_id}: Auth failed[/red]")
                    return
                
                while True:
                    try:
                        company_info = await asyncio.wait_for(company_queue.get(), timeout=5)
                    except asyncio.TimeoutError:
                        if company_queue.empty():
                            break
                        continue
                    
                    try:
                        company_name = company_info['company_name']
                        tier_str = f"[{company_info.get('tier', '')}] " if company_info.get('tier') else ""
                        console.print(f"[dim]Worker {worker_id}: {tier_str}{company_name}[/dim]")
                        
                        # Search for company
                        search_input = page.locator('input[placeholder*="Search"]').first
                        await search_input.click()
                        await asyncio.sleep(0.5)
                        await search_input.fill(company_name)
                        await asyncio.sleep(1)
                        await search_input.press('Enter')
                        await asyncio.sleep(4)
                        
                        # Switch to Accounts
                        accounts_tab = page.locator('button:has-text("Accounts")').first
                        if await accounts_tab.count() > 0:
                            await accounts_tab.click()
                            await asyncio.sleep(3)
                        
                        # Click company
                        company_link = page.locator('a[href*="/sales/company/"]').first
                        if await company_link.count() > 0:
                            await company_link.click()
                            await asyncio.sleep(3)
                            
                            # Click Decision Makers
                            dm_link = page.locator('a:has-text("Decision maker")').first
                            if await dm_link.count() > 0:
                                await dm_link.click()
                                await asyncio.sleep(4)
                                
                                # Scroll and collect
                                for _ in range(10):
                                    await page.evaluate("""
                                        const c = document.querySelector('#search-results-container');
                                        if (c) c.scrollTop += 800;
                                    """)
                                    await asyncio.sleep(1)
                                
                                # Extract contacts
                                cards = page.locator('[data-x-search-result="LEAD"]')
                                count = await cards.count()
                                
                                employees = []
                                for i in range(min(count, max_contacts)):
                                    card = cards.nth(i)
                                    name_el = card.locator('[data-anonymize="person-name"]').first
                                    title_el = card.locator('[data-anonymize="title"]').first
                                    
                                    name = await name_el.text_content() if await name_el.count() > 0 else None
                                    title = await title_el.text_content() if await title_el.count() > 0 else None
                                    
                                    if name and len(name.strip()) > 2:
                                        employees.append({
                                            'name': name.strip(),
                                            'title': title.strip() if title else None,
                                            'linkedin_url': None
                                        })
                                
                                if employees:
                                    save_linkedin_contacts(company_name, employees)
                                    async with results['lock']:
                                        results['success'] += 1
                                        results['total_contacts'] += len(employees)
                                    console.print(f"[green]Worker {worker_id}: {company_name} - {len(employees)} contacts[/green]")
                                else:
                                    async with results['lock']:
                                        results['failed'] += 1
                                    console.print(f"[yellow]Worker {worker_id}: {company_name} - no contacts[/yellow]")
                            else:
                                async with results['lock']:
                                    results['failed'] += 1
                                console.print(f"[yellow]Worker {worker_id}: {company_name} - no DM link[/yellow]")
                        else:
                            async with results['lock']:
                                results['failed'] += 1
                            console.print(f"[yellow]Worker {worker_id}: {company_name} - company not found[/yellow]")
                        
                        await page.goto("https://www.linkedin.com/sales/home", timeout=15000)
                        await asyncio.sleep(delay)
                        
                    except Exception as e:
                        async with results['lock']:
                            results['failed'] += 1
                        console.print(f"[red]Worker {worker_id}: {company_name} - {e}[/red]")
                    
                    company_queue.task_done()
                    
            finally:
                try:
                    await context.close()
                    await browser.close()
                    await playwright.stop()
                except:
                    pass
        
        async def run_parallel():
            queue = asyncio.Queue()
            for c in companies:
                await queue.put(c)
            
            auth_event = asyncio.Event()
            
            console.print("[yellow]Opening first browser for authentication...[/yellow]")
            
            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            browser = await pw.chromium.launch(headless=False)
            storage_path = config.DATA_DIR / "linkedin_auth.json"
            
            ctx_opts = {}
            if storage_path.exists():
                ctx_opts['storage_state'] = str(storage_path)
            
            ctx = await browser.new_context(**ctx_opts)
            page = await ctx.new_page()
            
            await page.goto("https://www.linkedin.com/sales/home", timeout=30000)
            await asyncio.sleep(3)
            
            for _ in range(180):
                if '/sales/' in page.url and 'login' not in page.url:
                    console.print("[green]Authenticated! Saving session...[/green]")
                    await ctx.storage_state(path=str(storage_path))
                    break
                await asyncio.sleep(1)
            
            await ctx.close()
            await browser.close()
            await pw.stop()
            
            auth_event.set()
            console.print(f"\n[bold]Starting {workers} parallel workers...[/bold]\n")
            
            tasks = [
                asyncio.create_task(worker_task(i, queue, auth_event))
                for i in range(workers)
            ]
            
            await asyncio.gather(*tasks)
        
        asyncio.run(run_parallel())
        
        console.print(f"\n[bold]LinkedIn Scrape Complete:[/bold]")
        console.print(f"  Success: {results['success']}")
        console.print(f"  Failed: {results['failed']}")
        console.print(f"  Total contacts: {results['total_contacts']}")
    
    # ═══════════════════════════════════════════════════════════════
    # STEP 2: Email Pattern Discovery
    # ═══════════════════════════════════════════════════════════════
    console.print("\n[bold cyan]STEP 2/2: Email Pattern Discovery[/bold cyan]")
    console.print("─" * 45)
    console.print("Using web search + GPT-4o to find email patterns & domains")
    console.print()
    
    result = process_linkedin_contacts_with_patterns(today_only=True)
    
    console.print(f"\n[bold green]═══════════════════════════════════════════[/bold green]")
    console.print(f"[bold green]           PIPELINE COMPLETE              [/bold green]")
    console.print(f"[bold green]═══════════════════════════════════════════[/bold green]")
    console.print(f"\nCompanies processed: {result['companies']}")
    console.print(f"Contacts with emails: {result['contacts']}")
    console.print(f"\n[bold]Output file:[/bold] {result['output_path']}")


if __name__ == "__main__":
    app()

