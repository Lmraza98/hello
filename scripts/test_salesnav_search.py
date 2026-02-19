"""End-to-end test: search SalesNav for companies with NL query decomposition."""
import asyncio
import json
from services.web_automation.browser.workflows.recipes import search_and_extract


async def test():
    print("=== Testing SalesNav company search with NL decomposition ===\n")

    result = await search_and_extract(
        task="salesnav_search_account",
        query="SaaS companies specializing in AI-powered cybersecurity for the healthcare industry",
        limit=10,
        wait_ms=2000,
    )

    print(f"Status: {'ok' if result.get('ok') else 'error'}")
    print(f"URL: {result.get('url', 'N/A')}")
    print(f"Items extracted: {result.get('count', 0)}")

    decomp = result.get("query_decomposition")
    if decomp:
        print(f"\nQuery decomposition:")
        print(f"  Original: {decomp.get('original_query')}")
        print(f"  Keywords: {decomp.get('effective_keywords')}")
        print(f"  Filters: {json.dumps(decomp.get('filters_applied', {}), indent=2)}")

    applied = result.get("applied_filters")
    if applied:
        print(f"\nApplied filters:")
        for name, info in applied.items():
            print(f"  {name}: value={info.get('value')} applied={info.get('applied')}")

    diag = result.get("extraction_diagnosis")
    if diag:
        print(f"\nExtraction diagnosis:")
        print(f"  Page has results: {diag.get('page_has_results')}")
        print(f"  Results count text: {diag.get('results_count_text')}")
        print(f"  Snapshot refs: {diag.get('snapshot_refs_count')}")
        print(f"  Retried: {diag.get('retried', False)}")
        print(f"  Retry count: {diag.get('retry_count', 'N/A')}")

    warning = result.get("extraction_warning")
    if warning:
        print(f"\nWARNING: {warning}")

    mismatch = result.get("industry_mismatch_warning")
    if mismatch:
        print(f"\nINDUSTRY MISMATCH: {mismatch}")

    items = result.get("items", [])
    if items:
        print(f"\nFirst 5 results:")
        for item in items[:5]:
            print(f"  - {item.get('name', 'Unknown')} | {item.get('sales_nav_url', 'no url')}")

    error = result.get("error")
    if error:
        print(f"\nError: {error}")
        print(f"Error detail: {result.get('error_detail', 'N/A')}")


asyncio.run(test())
