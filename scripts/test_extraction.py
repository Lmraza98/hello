"""Quick test: check what the browser snapshot sees right now."""
import asyncio
from api.routes.browser_nav import BrowserSnapshotRequest, browser_snapshot


async def test():
    # Try both modes
    for mode in ("ai", "role"):
        print(f"\n=== Mode: {mode} ===")
        snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=None, mode=mode))
        print(f"Snap type: {type(snap)}")
        if isinstance(snap, dict):
            print(f"Keys: {list(snap.keys())}")
            print(f"tab_id: {snap.get('tab_id')}")
            url = snap.get("url", "")
            print(f"URL: {url}")
            snapshot_text = str(snap.get("snapshot_text", ""))[:500]
            print(f"Snapshot text (first 500): {snapshot_text!r}")
            elements_count = snap.get("elements_count", 0)
            print(f"Elements count: {elements_count}")
            error = snap.get("error")
            if error:
                print(f"ERROR: {error}")
        refs = snap.get("refs", []) if isinstance(snap, dict) else []
        print(f"Total refs: {len(refs)}")

    company_refs = [
        r for r in refs
        if isinstance(r, dict) and "/sales/company/" in str(r.get("url", "") or r.get("href", ""))
    ]
    print(f"Company refs (with /sales/company/ in URL): {len(company_refs)}")
    for r in company_refs[:5]:
        label = r.get("label", "")
        url = r.get("url", r.get("href", ""))
        print(f"  - {label} | {url}")

    # Check for results count text
    all_labels = [str(r.get("label", "")) for r in refs if isinstance(r, dict)]
    for label in all_labels:
        if "result" in label.lower():
            print(f"  [results indicator] {label}")

    # Show first 10 refs for debugging
    print("\nFirst 20 refs:")
    for i, r in enumerate(refs[:20]):
        if isinstance(r, dict):
            ref_id = r.get("ref", "?")
            role = r.get("role", "?")
            label = str(r.get("label", ""))[:80]
            url = str(r.get("url", r.get("href", "")))[:60]
            print(f"  [{ref_id}] role={role} label={label!r} url={url!r}")


asyncio.run(test())
