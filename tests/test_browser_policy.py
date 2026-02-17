import time

from services.browser_policy import BrowserPolicy, BrowserPolicyConfig, TokenBucket


def test_token_bucket_wait_and_consume():
    bucket = TokenBucket(rate_per_sec=2.0, capacity=1.0, tokens=1.0)
    assert bucket.consume() is True
    assert bucket.consume() is False
    wait_s = bucket.wait_seconds_for()
    assert wait_s > 0


def test_browser_policy_enforces_hourly_budget():
    policy = BrowserPolicy(
        BrowserPolicyConfig(
            enabled=True,
            max_actions_per_hour=2,
            nav_rate_per_sec=100.0,
            click_rate_per_sec=100.0,
            type_rate_per_sec=100.0,
            tab_rate_per_sec=100.0,
        )
    )
    assert policy.consume("click") is True
    assert policy.consume("click") is True
    assert policy.consume("click") is False
    assert policy.wait_seconds_for("click") > 0


def test_browser_policy_cooldown_after_friction():
    policy = BrowserPolicy(
        BrowserPolicyConfig(
            enabled=True,
            cooldown_after_friction_ms=250,
            max_actions_per_hour=1000,
            nav_rate_per_sec=100.0,
            click_rate_per_sec=100.0,
            type_rate_per_sec=100.0,
            tab_rate_per_sec=100.0,
        )
    )
    policy.note_friction()
    assert policy.consume("click") is False
    assert policy.wait_seconds_for("click") > 0
    time.sleep(0.30)
    assert policy.consume("click") is True
