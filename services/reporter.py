"""
Reporter Service: Daily reports, stats, and export functionality.
"""
import csv
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import config
import database as db


def get_daily_summary(date: str = None) -> Dict:
    """
    Get comprehensive daily summary statistics.
    """
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    summary = {
        'date': date,
        'crawling': {},
        'extraction': {},
        'sending': {},
        'llm_usage': {}
    }
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Crawling stats
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM targets
            WHERE DATE(updated_at) = ?
            GROUP BY status
        """, (date,))
        summary['crawling']['by_status'] = {row['status']: row['count'] for row in cursor.fetchall()}
        
        cursor.execute("""
            SELECT COUNT(*) as count FROM pages
            WHERE DATE(fetched_at) = ? AND fetch_status = 'fetched'
        """, (date,))
        summary['crawling']['pages_fetched'] = cursor.fetchone()['count']
        
        # Extraction stats
        cursor.execute("""
            SELECT COUNT(*) as count FROM candidates
            WHERE DATE(llm_extracted_at) = ?
        """, (date,))
        summary['extraction']['candidates_extracted'] = cursor.fetchone()['count']
        
        cursor.execute("""
            SELECT AVG(overall_score) as avg_score, 
                   AVG(confidence) as avg_confidence
            FROM candidates
            WHERE DATE(llm_extracted_at) = ?
        """, (date,))
        row = cursor.fetchone()
        summary['extraction']['avg_score'] = round(row['avg_score'] or 0, 2)
        summary['extraction']['avg_confidence'] = round(row['avg_confidence'] or 0, 2)
        
        # Sending stats
        cursor.execute("""
            SELECT result, COUNT(*) as count
            FROM send_log
            WHERE DATE(timestamp) = ?
            GROUP BY result
        """, (date,))
        summary['sending']['by_result'] = {row['result']: row['count'] for row in cursor.fetchall()}
        
        total_sent = summary['sending']['by_result'].get('sent', 0)
        total_failed = summary['sending']['by_result'].get('failed', 0)
        total_skipped = summary['sending']['by_result'].get('skipped', 0)
        
        summary['sending']['total_attempts'] = total_sent + total_failed + total_skipped
        summary['sending']['success_rate'] = (
            round(total_sent / (total_sent + total_failed) * 100, 1)
            if (total_sent + total_failed) > 0 else 0
        )
        
        # LLM usage
        llm_usage = db.get_daily_llm_usage(date)
        summary['llm_usage'] = {
            'total_calls': llm_usage['calls'],
            'total_input_tokens': llm_usage['total_input'] or 0,
            'total_output_tokens': llm_usage['total_output'] or 0,
            'estimated_cost': round(llm_usage['total_cost'] or 0, 4)
        }
        
        # Queue status
        cursor.execute("""
            SELECT COUNT(*) as count FROM send_queue
            WHERE status = 'pending' AND scheduled_date <= ?
        """, (date,))
        summary['queue_pending'] = cursor.fetchone()['count']
    
    return summary


def export_daily_report(date: str = None, output_dir: Path = None) -> str:
    """
    Export daily report as CSV.
    Returns the file path.
    """
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    if output_dir is None:
        output_dir = config.DATA_DIR / "reports"
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / f"daily_report_{date}.csv"
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Get all send attempts for the day with full details
        cursor.execute("""
            SELECT 
                sl.timestamp,
                sl.result,
                sl.details,
                sl.sf_record_url,
                sq.contact_name,
                sq.contact_email,
                sq.contact_title,
                sq.planned_subject,
                c.domain,
                c.company_name,
                c.overall_score,
                c.confidence
            FROM send_log sl
            JOIN send_queue sq ON sl.send_queue_id = sq.id
            JOIN candidates c ON sq.candidate_id = c.id
            WHERE DATE(sl.timestamp) = ?
            ORDER BY sl.timestamp
        """, (date,))
        
        rows = cursor.fetchall()
    
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'Timestamp', 'Result', 'Domain', 'Company', 'Contact Name',
            'Contact Email', 'Contact Title', 'Subject', 'Score', 'Confidence',
            'SF Record URL', 'Details'
        ])
        
        for row in rows:
            writer.writerow([
                row['timestamp'],
                row['result'],
                row['domain'],
                row['company_name'],
                row['contact_name'],
                row['contact_email'],
                row['contact_title'],
                row['planned_subject'][:50] + '...' if len(row['planned_subject'] or '') > 50 else row['planned_subject'],
                row['overall_score'],
                row['confidence'],
                row['sf_record_url'],
                row['details']
            ])
    
    print(f"[Reporter] Exported daily report to {output_file}")
    return str(output_file)


def export_failures_bundle(date: str = None, output_dir: Path = None) -> str:
    """
    Export a bundle of failures with screenshots for debugging.
    Returns the bundle directory path.
    """
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    if output_dir is None:
        output_dir = config.DATA_DIR / "reports" / f"failures_{date}"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Get failed sends with screenshot paths
        cursor.execute("""
            SELECT 
                sl.*,
                sq.contact_name,
                sq.contact_email,
                sq.planned_subject,
                c.domain
            FROM send_log sl
            JOIN send_queue sq ON sl.send_queue_id = sq.id
            JOIN candidates c ON sq.candidate_id = c.id
            WHERE DATE(sl.timestamp) = ?
            AND sl.result = 'failed'
        """, (date,))
        
        failures = cursor.fetchall()
    
    # Write failure summary
    summary_file = output_dir / "failures_summary.json"
    failure_list = []
    
    for fail in failures:
        failure_data = {
            'send_queue_id': fail['send_queue_id'],
            'domain': fail['domain'],
            'contact_email': fail['contact_email'],
            'subject': fail['planned_subject'],
            'details': fail['details'],
            'screenshot': fail['screenshot_path'],
            'timestamp': fail['timestamp']
        }
        failure_list.append(failure_data)
        
        # Copy screenshot if exists
        if fail['screenshot_path']:
            src = Path(fail['screenshot_path'])
            if src.exists():
                import shutil
                dest = output_dir / src.name
                shutil.copy(src, dest)
    
    summary_file.write_text(json.dumps(failure_list, indent=2))
    
    print(f"[Reporter] Exported {len(failure_list)} failures to {output_dir}")
    return str(output_dir)


def print_daily_summary(date: str = None):
    """Print a formatted daily summary to console."""
    summary = get_daily_summary(date)
    
    print("\n" + "="*60)
    print(f"DAILY OUTREACH SUMMARY - {summary['date']}")
    print("="*60)
    
    print("\n[CRAWLING]")
    for status, count in summary['crawling'].get('by_status', {}).items():
        print(f"  {status}: {count}")
    print(f"  Pages fetched: {summary['crawling'].get('pages_fetched', 0)}")
    
    print("\n[EXTRACTION]")
    print(f"  Candidates extracted: {summary['extraction'].get('candidates_extracted', 0)}")
    print(f"  Avg score: {summary['extraction'].get('avg_score', 0)}")
    print(f"  Avg confidence: {summary['extraction'].get('avg_confidence', 0)}")
    
    print("\n[SENDING]")
    sending = summary['sending']
    print(f"  Total attempts: {sending.get('total_attempts', 0)}")
    for result, count in sending.get('by_result', {}).items():
        marker = "[OK]" if result == "sent" else "[FAIL]" if result == "failed" else "[SKIP]"
        print(f"  {marker} {result}: {count}")
    print(f"  Success rate: {sending.get('success_rate', 0)}%")
    
    print("\n[LLM USAGE]")
    llm = summary['llm_usage']
    print(f"  API calls: {llm.get('total_calls', 0)}")
    print(f"  Tokens: {llm.get('total_input_tokens', 0)} in / {llm.get('total_output_tokens', 0)} out")
    print(f"  Est. cost: ${llm.get('estimated_cost', 0):.4f}")
    
    print(f"\n[Queue pending]: {summary.get('queue_pending', 0)}")
    print("="*60 + "\n")


def get_monthly_cost_projection() -> Dict:
    """
    Project monthly LLM costs based on recent usage.
    """
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Get last 7 days of usage
        cursor.execute("""
            SELECT 
                date,
                SUM(cost_estimate) as daily_cost,
                COUNT(*) as calls
            FROM llm_usage
            WHERE date >= DATE('now', '-7 days')
            GROUP BY date
            ORDER BY date
        """)
        
        recent = cursor.fetchall()
    
    if not recent:
        return {'avg_daily': 0, 'projected_monthly': 0, 'budget': 100, 'status': 'no_data'}
    
    daily_costs = [r['daily_cost'] for r in recent]
    avg_daily = sum(daily_costs) / len(daily_costs)
    projected_monthly = avg_daily * 30
    
    return {
        'avg_daily': round(avg_daily, 2),
        'projected_monthly': round(projected_monthly, 2),
        'budget': 100,
        'status': 'under_budget' if projected_monthly < 100 else 'over_budget',
        'days_tracked': len(recent)
    }


def get_pipeline_health() -> Dict:
    """
    Get overall pipeline health metrics.
    """
    health = {
        'status': 'healthy',
        'issues': []
    }
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Check for stuck targets
        cursor.execute("""
            SELECT COUNT(*) as count FROM targets
            WHERE status = 'pending'
            AND created_at < datetime('now', '-2 days')
        """)
        stuck = cursor.fetchone()['count']
        if stuck > 10:
            health['issues'].append(f"{stuck} targets stuck in pending for >2 days")
        
        # Check for high failure rate
        cursor.execute("""
            SELECT 
                SUM(CASE WHEN result = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) as failed
            FROM send_log
            WHERE timestamp > datetime('now', '-1 day')
        """)
        row = cursor.fetchone()
        if row['failed'] and row['sent']:
            failure_rate = row['failed'] / (row['sent'] + row['failed'])
            if failure_rate > 0.3:
                health['issues'].append(f"High failure rate: {failure_rate:.1%}")
        
        # Check for low extraction confidence
        cursor.execute("""
            SELECT AVG(confidence) as avg_conf FROM candidates
            WHERE llm_extracted_at > datetime('now', '-1 day')
        """)
        avg_conf = cursor.fetchone()['avg_conf']
        if avg_conf and avg_conf < 0.5:
            health['issues'].append(f"Low extraction confidence: {avg_conf:.2f}")
        
        # Check LLM budget
        cost_projection = get_monthly_cost_projection()
        if cost_projection['status'] == 'over_budget':
            health['issues'].append(f"Projected LLM cost (${cost_projection['projected_monthly']}) exceeds budget")
    
    if health['issues']:
        health['status'] = 'warning' if len(health['issues']) < 3 else 'critical'
    
    return health

