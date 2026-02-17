"""
LinkedIn Sales Navigator scraper facade.

Responsibilities are split by concern into `services/linkedin/salesnav/*`.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import config
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from services.linkedin.salesnav import (
    SalesNavCompanyExtractor,
    CompanyResult,
    ContactsResult,
    SalesNavCompanySearchFlow,
    SalesNavDebug,
    SalesNavEmployeeFetchFlow,
    EmployeeResult,
    SalesNavFilterApplier,
    SalesNavFilterUrlBuildFlow,
    SalesNavFilterUrlFilterIdFlow,
    SalesNavFilterUrlLocationFlow,
    SalesNavNavigator,
    SalesNavPublicUrlBatch,
    SalesNavPublicUrlFlow,
    SalesNavSessionManager,
    SalesNavWaits,
    SalesNavWorkflowFlow,
)
from services.linkedin.salesnav.core.selectors import SEL
from services.linkedin.salesnav.core.operations import run_operation_with_retries
from services.linkedin.salesnav.core.parsing import employee_display_to_int
from services.linkedin.salesnav.core.pacing import pacing_delay
from services.linkedin.salesnav.core.interaction import idle_drift
from services.linkedin.salesnav.extractors.scrape_people import SalesNavPeopleExtractor

LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"


class SalesNavigatorScraper:
    """Public scraper class with split implementations."""

    def __init__(self):
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_authenticated = False

        self.waits = SalesNavWaits(self)
        self.debugger = SalesNavDebug(self)
        self.debug = self.debugger
        self.session_mgr = SalesNavSessionManager(self)
        self.navigator = SalesNavNavigator(self)
        self.filter_applier = SalesNavFilterApplier(self)
        self.people_extractor = SalesNavPeopleExtractor(self)
        self.company_extractor = SalesNavCompanyExtractor(self)
        self.company_search_flow = SalesNavCompanySearchFlow(self)
        self.employee_fetch_flow = SalesNavEmployeeFetchFlow(self)
        self.workflow_flow = SalesNavWorkflowFlow(self)
        self.filter_url_build_flow = SalesNavFilterUrlBuildFlow(self)
        self.filter_url_location_flow = SalesNavFilterUrlLocationFlow(self)
        self.filter_url_filter_id_flow = SalesNavFilterUrlFilterIdFlow(self)
        self.public_url_flow = SalesNavPublicUrlFlow(self)
        self.public_url_batch = SalesNavPublicUrlBatch(self, self.public_url_flow)

    def _require_page(self) -> Page:
        if self.page is None:
            raise RuntimeError("SalesNavigatorScraper has no active page. Call start() first.")
        return self.page

    def _require_auth(self) -> None:
        if not self.is_authenticated:
            raise RuntimeError("Sales Navigator session is not authenticated.")

    async def _ensure_on_account_search(self) -> None:
        page = self._require_page()
        url = page.url or ""
        if "/sales/search/company" in url:
            return
        if not await self.navigator.go_to_account_search():
            raise RuntimeError("Unable to navigate to Sales Navigator account search page.")

    async def _ensure_ready(
        self,
        *,
        require_auth: bool = True,
        require_account_search: bool = False,
        interactive_auth: bool = False,
    ) -> None:
        self._require_page()
        if require_auth and not self.is_authenticated:
            ok = await self.ensure_authenticated(interactive=interactive_auth)
            if not ok:
                raise RuntimeError("Sales Navigator session is not authenticated.")
        if require_account_search:
            await self._ensure_on_account_search()

    def _to_employee_result(self, emp: dict[str, Any]) -> EmployeeResult:
        sales_nav_url = str(emp.get("sales_nav_url") or "").strip()
        public_url = str(emp.get("public_url") or "").strip()
        return EmployeeResult(
            name=str(emp.get("name") or "").strip(),
            title=emp.get("title"),
            sales_nav_url=sales_nav_url or None,
            public_url=public_url or None,
            has_public_url=bool(emp.get("has_public_url") or bool(public_url)),
        )

    def _to_company_result(self, company: dict[str, Any]) -> CompanyResult:
        return CompanyResult(
            company_name=str(company.get("company_name") or "").strip(),
            industry=company.get("industry"),
            employee_count_display=company.get("employee_count"),
            employee_count_int=employee_display_to_int(company.get("employee_count")),
            linkedin_url=company.get("linkedin_url"),
        )

    async def _run_operation(
        self,
        op_name: str,
        fn,
        *,
        retries: int = 2,
        retry_wait_seconds: float = 0.8,
        debug_context: dict[str, Any] | None = None,
    ):
        loop = asyncio.get_running_loop()
        mouse_before = await self._interaction_trace_count()
        started = loop.time()
        keepalive_stop = asyncio.Event()
        keepalive_task: asyncio.Task | None = None
        if self.page is not None:
            keepalive_task = asyncio.create_task(self._operation_keepalive(keepalive_stop))
        try:
            result = await run_operation_with_retries(
                op_name=op_name,
                fn=fn,
                retries=retries,
                retry_wait_seconds=retry_wait_seconds,
                debug=self.debugger,
                debug_context=debug_context or {},
            )
        except Exception:
            # Add interaction trace context on failure for easier diagnosis.
            try:
                await self.debugger.capture(
                    f"{op_name}_interaction_error",
                    context={
                        **(debug_context or {}),
                        "mouse_trace_tail": await self._interaction_trace_tail(limit=20),
                    },
                )
            except Exception:
                pass
            raise
        finally:
            keepalive_stop.set()
            if keepalive_task is not None:
                try:
                    await keepalive_task
                except Exception:
                    pass
        mouse_after = await self._interaction_trace_count()
        elapsed_ms = int((loop.time() - started) * 1000)
        print(
            f"[LinkedIn] op={op_name} ok elapsed_ms={elapsed_ms} mouse_events_delta={max(0, mouse_after - mouse_before)}"
        )
        return result

    async def _operation_keepalive(self, stop_event: asyncio.Event) -> None:
        """
        Periodically send lightweight browser commands while long operations run.
        This avoids completely idle CDP stretches without synthesizing input behavior.
        """
        while not stop_event.is_set():
            try:
                if self.page is not None:
                    await self.page.evaluate("() => 1")
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=1.5)
            except asyncio.TimeoutError:
                pass

    async def _interaction_trace_count(self) -> int:
        if self.page is None:
            return 0
        try:
            value = await self.page.evaluate("(() => (window.__liMouseTrace || []).length)()")
            return int(value)
        except Exception:
            return 0

    async def _interaction_trace_tail(self, limit: int = 20) -> list[dict[str, Any]]:
        if self.page is None:
            return []
        try:
            raw = await self.page.evaluate(
                """
                (limit) => {
                    const arr = window.__liMouseTrace || [];
                    return arr.slice(Math.max(0, arr.length - limit));
                }
                """,
                max(1, int(limit)),
            )
            if isinstance(raw, list):
                return [row for row in raw if isinstance(row, dict)]
        except Exception:
            pass
        return []

    async def __aenter__(self):
        await self.start(headless=config.HEADLESS_MODE)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.stop()

    async def start(self, headless: bool = False):
        """Start browser with persistent LinkedIn session settings."""
        if self.playwright is not None or self.browser is not None or self.context is not None or self.page is not None:
            raise RuntimeError("SalesNavigatorScraper is already started. Call stop() before start().")
        self.playwright = await async_playwright().start()
        launch_args = ["--disable-dev-shm-usage", "--no-sandbox"]
        if config.SALESNAV_STEALTH_ARGS_ENABLED:
            launch_args.insert(0, "--disable-blink-features=AutomationControlled")
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            slow_mo=config.SALESNAV_SLOW_MO_MS,
            args=launch_args,
        )

        context_options: dict[str, Any] = {
            "viewport": {"width": 1920, "height": 1080},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "locale": "en-US",
            "timezone_id": "America/New_York",
        }
        if LINKEDIN_STORAGE_STATE.exists():
            print("[LinkedIn] Loading existing session")
            context_options["storage_state"] = str(LINKEDIN_STORAGE_STATE)
        else:
            print("[LinkedIn] Creating new session")

        self.context = await self.browser.new_context(**context_options)
        try:
            await self.context.grant_permissions(["clipboard-read", "clipboard-write"])
        except Exception:
            pass

        if config.SALESNAV_INIT_SCRIPT_ENABLED:
            await self.context.add_init_script(
                """
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.__liMouseTrace = [];
                const __liPushTrace = (type, evt) => {
                    try {
                        const now = Date.now();
                        const row = {
                            type,
                            t: now,
                            x: (evt && typeof evt.clientX === 'number') ? evt.clientX : null,
                            y: (evt && typeof evt.clientY === 'number') ? evt.clientY : null,
                            dx: (evt && typeof evt.deltaX === 'number') ? evt.deltaX : null,
                            dy: (evt && typeof evt.deltaY === 'number') ? evt.deltaY : null,
                        };
                        window.__liMouseTrace.push(row);
                        if (window.__liMouseTrace.length > 200) {
                            window.__liMouseTrace = window.__liMouseTrace.slice(-200);
                        }
                    } catch (_) {}
                };
                window.addEventListener('mousemove', (e) => __liPushTrace('mousemove', e), { passive: true });
                window.addEventListener('click', (e) => __liPushTrace('click', e), { passive: true });
                window.addEventListener('wheel', (e) => __liPushTrace('wheel', e), { passive: true });
                const originalFetch = window.fetch;
                window.fetch = function(...args) {
                    if (args[0] && args[0].toString().includes('chrome-extension://')) {
                        return Promise.reject(new Error('blocked'));
                    }
                    return originalFetch.apply(this, args);
                };
                """
            )
        self.page = await self.context.new_page()
        await self._check_auth()

    async def stop(self):
        """Stop browser and save session."""
        try:
            if self.page:
                try:
                    await self.page.close()
                except Exception:
                    pass
            if self.context and self.is_authenticated:
                try:
                    await self.context.storage_state(path=str(LINKEDIN_STORAGE_STATE))
                except Exception:
                    pass
            if self.context:
                try:
                    await self.context.close()
                except Exception:
                    pass
            if self.browser:
                try:
                    await self.browser.close()
                except Exception:
                    pass
            if self.playwright:
                try:
                    await self.playwright.stop()
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            self.page = None
            self.context = None
            self.browser = None
            self.playwright = None
            self.is_authenticated = False

    async def _check_auth_passive(self) -> bool:
        """Check auth state on the current page without navigation."""
        try:
            self._require_page()
            url = self.page.url or ""
            if (
                "login" in url.lower()
                or "checkpoint" in url.lower()
                or "authwall" in url.lower()
                or await self.page.locator(SEL.AUTH_LOGIN_FORM).count() > 0
                or await self.page.locator(SEL.AUTH_WALL).count() > 0
            ):
                self.is_authenticated = False
                return False
            if self.session_mgr.is_authenticated_url(url):
                self.is_authenticated = True
                return True
            self.is_authenticated = False
            return False
        except Exception:
            self.is_authenticated = False
            return False

    async def _check_auth_active(self) -> bool:
        """Check auth state by navigating to Sales Navigator home."""
        try:
            self._require_page()
            print("[LinkedIn] Checking session...")
            await self.page.goto(SEL.SALES_HOME_URL, timeout=30000)
            await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
            url = self.page.url or ""
            if (
                "login" in url.lower()
                or "checkpoint" in url.lower()
                or "authwall" in url.lower()
                or await self.page.locator(SEL.AUTH_LOGIN_FORM).count() > 0
                or await self.page.locator(SEL.AUTH_WALL).count() > 0
            ):
                self.is_authenticated = False
                print("[LinkedIn] Session expired - login required")
                return False
            if self.session_mgr.is_authenticated_url(url):
                try:
                    await self.waits.wait_for_salesnav_shell(timeout_ms=20_000)
                except Exception:
                    pass
                self.is_authenticated = True
                print("[LinkedIn] Session valid - already authenticated")
                return True
            self.is_authenticated = False
            return False
        except Exception as exc:
            print(f"[LinkedIn] Auth check error: {exc}")
            self.is_authenticated = False
            return False

    async def _check_auth(self) -> bool:
        """Backward-compatible active auth check."""
        return await self._check_auth_active()

    async def ensure_authenticated(self, *, interactive: bool = True, timeout_minutes: int | None = None) -> bool:
        """
        Ensure the active browser session is authenticated for Sales Navigator.
        If interactive is True and auth is missing, prompt via wait_for_login().
        """
        self._require_page()
        if await self._check_auth_passive():
            return True
        if await self._check_auth_active():
            return True
        if not interactive:
            return False
        ok = await self.wait_for_login(timeout_minutes=timeout_minutes)
        self.is_authenticated = bool(ok)
        return bool(ok)

    async def wait_for_login(self, timeout_minutes: int | None = None) -> bool:
        """Wait for user to manually log in."""
        if timeout_minutes is None:
            timeout_minutes = config.LINKEDIN_TIMEOUT_MINUTES
        self._require_page()
        print(f"\n{'=' * 60}")
        print("  LINKEDIN LOGIN REQUIRED")
        print("  ")
        print("  1. Log in to LinkedIn in the browser window")
        print("  2. Then navigate to Sales Navigator")
        print("  3. URL: https://www.linkedin.com/sales/home")
        print("  ")
        print(f"  You have {timeout_minutes} minutes. Take your time!")
        print(f"{'=' * 60}\n")

        await self.page.goto("https://www.linkedin.com/login", timeout=30000)
        loop = asyncio.get_running_loop()
        start = loop.time()
        timeout = timeout_minutes * 60
        while (loop.time() - start) < timeout:
            await asyncio.sleep(10)
            try:
                url = self.page.url
                if self.session_mgr.is_authenticated_url(url):
                    await self.waits.wait_for_salesnav_shell(timeout_ms=20_000)
                    print("\n[LinkedIn] Sales Navigator detected - login successful!")
                    self.is_authenticated = True
                    await self.context.storage_state(path=str(LINKEDIN_STORAGE_STATE))
                    return True
                if "linkedin.com/feed" in url or "linkedin.com/in/" in url:
                    print("[LinkedIn] Logged into LinkedIn. Now go to Sales Navigator...")
                    print("[LinkedIn] Navigate to: https://www.linkedin.com/sales/home")
            except Exception:
                pass
        print("[LinkedIn] Login timeout")
        return False

    async def reset_search_state(self):
        """Reset search state by navigating to Sales Navigator home."""
        self._require_page()
        print("[LinkedIn] Resetting search state...")
        try:
            await pacing_delay(base_seconds=1.5, variance_seconds=0.5, min_seconds=0.8, max_seconds=3.0)
            if self.page:
                await idle_drift(self.page, duration_seconds=1.5)
            await self.page.goto(SEL.SALES_HOME_URL, timeout=30000)
            await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
            await self.waits.wait_for_salesnav_shell(timeout_ms=20_000)
            print("[LinkedIn] Search state reset")
        except Exception as exc:
            print(f"[LinkedIn] Reset error: {exc}")

    async def apply_filters(self, filters: dict[str, Any]):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        await self._run_operation(
            "apply_filters",
            lambda: self.filter_applier.apply_filters(filters),
            retries=1,
            retry_wait_seconds=0.7,
            debug_context={"filter_keys": sorted(list(filters.keys())) if isinstance(filters, dict) else []},
        )

    async def apply_industry(self, industry: str):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        await self._run_operation(
            "apply_industry",
            lambda: self.filter_applier.apply_industry(industry),
            retries=1,
            retry_wait_seconds=0.7,
            debug_context={"industry": industry},
        )

    async def apply_location(self, location: str):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        await self._run_operation(
            "apply_location",
            lambda: self.filter_applier.apply_location(location),
            retries=1,
            retry_wait_seconds=0.7,
            debug_context={"location": location},
        )

    async def apply_headcount(self, headcount_range: str):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        await self._run_operation(
            "apply_headcount",
            lambda: self.filter_applier.apply_headcount(headcount_range),
            retries=1,
            retry_wait_seconds=0.7,
            debug_context={"headcount_range": headcount_range},
        )

    async def apply_revenue(self, revenue_range: str):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        await self._run_operation(
            "apply_revenue",
            lambda: self.filter_applier.apply_revenue(revenue_range),
            retries=1,
            retry_wait_seconds=0.7,
            debug_context={"revenue_range": revenue_range},
        )

    async def scrape_current_results(self, max_employees: int = 50):
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "scrape_current_results",
            lambda: self.people_extractor.scrape_current_results(max_employees=max_employees),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"max_employees": max_employees},
        )

    async def scrape_company_results(self, max_companies: int = 100):
        await self._ensure_ready(require_auth=True, require_account_search=True)
        return await self._run_operation(
            "scrape_company_results",
            lambda: self.company_extractor.scrape_company_results(max_companies=max_companies),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"max_companies": max_companies},
        )

    async def search_company(self, company_name: str) -> Optional[str]:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "search_company",
            lambda: self.company_search_flow.search_company(company_name),
            retries=1,
            retry_wait_seconds=0.8,
            debug_context={"company_name": company_name},
        )

    async def click_decision_makers(self) -> bool:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "click_decision_makers",
            lambda: self.company_search_flow.click_decision_makers(),
            retries=1,
            retry_wait_seconds=0.8,
        )

    async def get_company_employees(
        self, company_url: str, max_employees: int = 20, title_filter: str | None = None
    ) -> list[dict[str, Any]]:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "get_company_employees",
            lambda: self.employee_fetch_flow.get_company_employees(
                company_url=company_url,
                max_employees=max_employees,
                title_filter=title_filter,
            ),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"company_url": company_url, "max_employees": max_employees, "title_filter": title_filter},
        )

    async def scrape_company_contacts(
        self, company_name: str, domain: str, max_contacts: int = 10, extract_public_urls: bool = False
    ) -> ContactsResult:
        await self._ensure_ready(require_auth=True)
        return await self.scrape_company_contacts_typed(
            company_name=company_name,
            domain=domain,
            max_contacts=max_contacts,
            extract_public_urls=extract_public_urls,
        )

    async def scrape_company_contacts_raw(
        self, company_name: str, domain: str, max_contacts: int = 10, extract_public_urls: bool = False
    ) -> dict[str, Any]:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "scrape_company_contacts_raw",
            lambda: self.workflow_flow.scrape_company_contacts(
                company_name=company_name,
                domain=domain,
                max_contacts=max_contacts,
                extract_public_urls=extract_public_urls,
            ),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={
                "company_name": company_name,
                "domain": domain,
                "max_contacts": max_contacts,
                "extract_public_urls": extract_public_urls,
            },
        )

    async def navigate_to_account_search(self):
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "navigate_to_account_search",
            lambda: self.company_search_flow.navigate_to_account_search(),
            retries=1,
            retry_wait_seconds=0.8,
        )

    async def search_companies_with_filters(self, filters: dict[str, Any], max_companies: int = 100) -> list[CompanyResult]:
        await self._ensure_ready(require_auth=True)
        return await self.search_companies_with_filters_typed(filters=filters, max_companies=max_companies)

    async def search_companies_with_filters_raw(
        self, filters: dict[str, Any], max_companies: int = 100
    ) -> list[dict[str, Any]]:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "search_companies_with_filters_raw",
            lambda: self.workflow_flow.search_companies_with_filters(filters=filters, max_companies=max_companies),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"max_companies": max_companies, "filter_keys": sorted(list(filters.keys())) if isinstance(filters, dict) else []},
        )

    async def build_search_url(self, filters: dict[str, Any]) -> Optional[str]:
        await self._ensure_ready(require_auth=True, require_account_search=True)
        return await self._run_operation(
            "build_search_url",
            lambda: self.filter_url_build_flow.build_search_url(filters),
            retries=1,
            retry_wait_seconds=0.8,
            debug_context={"filter_keys": sorted(list(filters.keys())) if isinstance(filters, dict) else []},
        )

    async def extract_public_linkedin_url(self, card, name: str | None = None) -> Optional[str]:
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "extract_public_linkedin_url",
            lambda: self.public_url_flow.extract_public_linkedin_url(card, name=name),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"name": name},
        )

    async def scrape_current_results_with_public_urls(self, max_employees: int = 50, extract_public_urls: bool = True):
        await self._ensure_ready(require_auth=True)
        return await self._run_operation(
            "scrape_current_results_with_public_urls",
            lambda: self.public_url_batch.run(max_employees=max_employees, extract_public_urls=extract_public_urls),
            retries=1,
            retry_wait_seconds=1.0,
            debug_context={"max_employees": max_employees, "extract_public_urls": extract_public_urls},
        )

    async def scrape_current_results_raw(self, max_employees: int = 50):
        """Explicit raw alias for people scraping output."""
        return await self.scrape_current_results(max_employees=max_employees)

    async def scrape_current_results_typed(self, max_employees: int = 50) -> list[EmployeeResult]:
        employees = await self.scrape_current_results(max_employees=max_employees)
        typed = [self._to_employee_result(emp) for emp in employees]
        return [e for e in typed if e.name]

    async def scrape_company_contacts_typed(
        self, company_name: str, domain: str, max_contacts: int = 10, extract_public_urls: bool = False
    ) -> ContactsResult:
        raw = await self.scrape_company_contacts_raw(
            company_name=company_name,
            domain=domain,
            max_contacts=max_contacts,
            extract_public_urls=extract_public_urls,
        )
        employees = [self._to_employee_result(emp) for emp in raw.get("employees", [])]
        return ContactsResult(
            company_name=str(raw.get("company_name") or company_name).strip(),
            domain=str(raw.get("domain") or domain).strip(),
            employees=[e for e in employees if e.name],
            status=str(raw.get("status") or "pending"),
        )

    async def search_companies_with_filters_typed(
        self, filters: dict[str, Any], max_companies: int = 100
    ) -> list[CompanyResult]:
        companies = await self.search_companies_with_filters_raw(filters=filters, max_companies=max_companies)
        typed = [self._to_company_result(company) for company in companies]
        return [c for c in typed if c.company_name]

    async def scrape_company_results_typed(self, max_companies: int = 100) -> list[CompanyResult]:
        companies = await self.scrape_company_results(max_companies=max_companies)
        typed = [self._to_company_result(company) for company in companies]
        return [c for c in typed if c.company_name]
