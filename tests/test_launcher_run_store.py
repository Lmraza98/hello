from datetime import UTC, datetime, timedelta
from pathlib import Path

from launcher_runtime.run_store import RunStore


def test_prune_by_count_and_age(tmp_path: Path):
    store = RunStore(tmp_path, max_runs=2, max_age_days=30)
    old = tmp_path / "run-20000101-000000-000001"
    old.mkdir()
    very_old = datetime.now(UTC) - timedelta(days=31)
    ts = very_old.timestamp()
    old.touch()
    Path(old).chmod(0o755)

    recent1 = tmp_path / "run-20990101-000000-000001"
    recent2 = tmp_path / "run-20990101-000000-000002"
    recent3 = tmp_path / "run-20990101-000000-000003"
    recent1.mkdir()
    recent2.mkdir()
    recent3.mkdir()

    # force old mtime
    import os

    os.utime(old, (ts, ts))

    summary = store.prune()
    assert summary["removed_by_age"] >= 1
    remaining = [p.name for p in tmp_path.iterdir() if p.is_dir()]
    assert len(remaining) == 2
