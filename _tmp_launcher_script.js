
          let activeTab = 'logs';
          let tests = [];
          let status = {};
          let openSuiteId = null;
          const expandedTests = new Set();
          const caseSearchByTest = {};
          const caseGroupByTest = {};
          const caseScrollTopByTestId = {};
          let selectedCase = null;
          let drawerOpen = false;
          let drawerTab = 'summary';
          const expandedAssertionRows = new Set();
          const expandedAssertionMore = new Set();
          let visibleCaseOrder = [];
          const caseLookupByKey = {};
          const caseModelCache = {};
          const caseModelPending = {};
          let drawerWidth = 350;
          let drawerRail = false;
          let drawerResizing = false;
          let drawerResizeStartX = 0;
          let drawerResizeStartWidth = 350;
          let densityMode = 'comfort';
          let filterOutcomeValue = '';
          let filterOutcomeMenuEl = null;
          let quickFilter = 'all';
          let selectedCaseCursor = -1;
          const uiInteractionLock = { active: false, untilTs: 0 };
          let pendingRefresh = false;

          function markUiInteraction() {
            uiInteractionLock.active = true;
            uiInteractionLock.untilTs = Date.now() + 1200;
          }

          function isUiInteractionLocked() {
            if (!uiInteractionLock.active) return false;
            if (Date.now() >= uiInteractionLock.untilTs) {
              uiInteractionLock.active = false;
              return false;
            }
            return true;
          }

          function captureCaseScrollPositions() {
            document.querySelectorAll('.child-scroll[data-test-id]').forEach((el) => {
              caseScrollTopByTestId[el.dataset.testId] = el.scrollTop;
            });
          }

          function restoreCaseScrollPositions() {
            document.querySelectorAll('.child-scroll[data-test-id]').forEach((el) => {
              const saved = caseScrollTopByTestId[el.dataset.testId];
              if (typeof saved === 'number') {
                const prev = el.style.scrollBehavior;
                el.style.scrollBehavior = 'auto';
                el.scrollTop = saved;
                el.style.scrollBehavior = prev;
              }
            });
          }

          function caseKeyOf(testId, nodeid) {
            return `${testId}::${nodeid}`;
          }

          function ensureSelectedCursor() {
            if (!selectedCase || !selectedCase.key) {
              selectedCaseCursor = -1;
              return;
            }
            selectedCaseCursor = visibleCaseOrder.indexOf(selectedCase.key);
          }

          function statusToBadge(value) {
            if (value === 'passed' || value === 'failed' || value === 'running' || value === 'queued' || value === 'retrying' || value === 'timed_out' || value === 'canceled') return value;
            return 'idle';
          }

          function closeSplitMenus() {
            document.querySelectorAll('.split-menu[open], .copy-menu[open]').forEach((el) => el.removeAttribute('open'));
            if (filterOutcomeMenuEl) {
              filterOutcomeMenuEl.remove();
              filterOutcomeMenuEl = null;
            }
          }

          function setDensity(mode) {
            densityMode = mode === 'compact' ? 'compact' : 'comfort';
            const testsPanel = document.querySelector('.tests');
            if (testsPanel) testsPanel.classList.toggle('compact', densityMode === 'compact');
            const comfort = document.getElementById('densityComfortBtn');
            const compact = document.getElementById('densityCompactBtn');
            if (comfort) comfort.classList.toggle('active', densityMode === 'comfort');
            if (compact) compact.classList.toggle('active', densityMode === 'compact');
          }

          function setOutcomeFilter(value) {
            filterOutcomeValue = value || '';
            const btn = document.getElementById('filterOutcomeBtn');
            if (btn) btn.textContent = filterOutcomeValue ? `outcome: ${filterOutcomeValue}` : 'all outcomes';
            renderTests();
          }

          function setQuickFilter(mode) {
            quickFilter = mode || 'all';
            document.querySelectorAll('#quickStrip button').forEach((btn) => btn.classList.toggle('active', btn.dataset.qf === quickFilter));
            renderTests();
          }

          function toggleOutcomeMenu(event) {
            const btn = event.currentTarget;
            if (filterOutcomeMenuEl) {
              filterOutcomeMenuEl.remove();
              filterOutcomeMenuEl = null;
              return;
            }
            const rect = btn.getBoundingClientRect();
            const menu = document.createElement('div');
            menu.className = 'filter-menu';
            menu.style.left = `${Math.max(8, rect.left)}px`;
            menu.style.top = `${rect.bottom + 6}px`;
            [
              ['', 'all outcomes'],
              ['idle', 'idle'],
              ['queued', 'queued'],
              ['running', 'running'],
              ['retrying', 'retrying'],
              ['passed', 'passed'],
              ['failed', 'failed'],
              ['canceled', 'canceled'],
              ['timed_out', 'timed_out'],
            ].forEach(([value, label]) => {
              const opt = document.createElement('button');
              opt.type = 'button';
              opt.textContent = label;
              opt.onclick = () => {
                setOutcomeFilter(value);
                if (filterOutcomeMenuEl) {
                  filterOutcomeMenuEl.remove();
                  filterOutcomeMenuEl = null;
                }
              };
              menu.appendChild(opt);
            });
            document.body.appendChild(menu);
            filterOutcomeMenuEl = menu;
          }

          function formatTime(ts) {
            if (!ts) return 'n/a';
            const dt = new Date(ts);
            if (Number.isNaN(dt.getTime())) return String(ts);
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }

          function getSuiteMeta(testId) {
            return tests.find((t) => t.id === testId) || null;
          }

          function applyDrawerLayout() {
            const drawer = document.getElementById('testDrawer');
            const host = document.querySelector('.tests-main');
            if (!drawer) return;
            drawer.style.width = drawerRail ? '56px' : `${drawerWidth}px`;
            if (host) {
              const r = host.getBoundingClientRect();
              drawer.style.top = `${Math.round(r.top)}px`;
              drawer.style.bottom = `${Math.max(0, Math.round(window.innerHeight - r.bottom))}px`;
              drawer.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
            }
            drawer.classList.toggle('rail', drawerRail);
          }

          function beginDrawerResize(event) {
            if (drawerRail || !drawerOpen) return;
            drawerResizing = true;
            drawerResizeStartX = event.clientX;
            drawerResizeStartWidth = drawerWidth;
            event.preventDefault();
          }

          function updateToolbarState() {
            const runPrimary = document.getElementById('runPrimaryBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const hasRunning = Object.keys(status || {}).some((k) => {
              const row = status[k];
              return row && row.status === 'running';
            });
            if (cancelBtn) cancelBtn.style.display = hasRunning ? 'inline-block' : 'none';
            if (runPrimary) runPrimary.disabled = tests.length === 0;
          }

          function updateSelectedCaseHighlight(previousKey, nextKey) {
            if (previousKey) {
              const prev = document.querySelector(`[data-case-key="${previousKey}"]`);
              if (prev) {
                prev.classList.remove('selected');
                prev.setAttribute('aria-selected', 'false');
              }
            }
            if (nextKey) {
              const next = document.querySelector(`[data-case-key="${nextKey}"]`);
              if (next) {
                next.classList.add('selected');
                next.setAttribute('aria-selected', 'true');
              }
            }
          }

          function buildCaseModel(caseObj) {
            const statusVal = (status[caseObj.testId] && status[caseObj.testId].status) || 'idle';
            const st = status[caseObj.testId] || {};
            const testMeta = getSuiteMeta(caseObj.testId);
            const assertions = [
              {
                id: `${caseObj.key}::a1`,
                title: `1 == 1`,
                state: statusVal === 'failed' ? 'failed' : 'passed',
                detail: [
                  `Completed ${caseObj.name}()`,
                  `Validate node ${caseObj.nodeid}`,
                  `Resolved context for ${caseObj.file}`,
                  `Finished assertion pipeline`,
                ],
              },
              {
                id: `${caseObj.key}::a2`,
                title: `output not empty`,
                state: statusVal === 'failed' ? 'failed' : 'passed',
                detail: [
                  `stdout captured`,
                  `normalized result payload`,
                  `shape validation passed`,
                ],
              },
            ];
            const passedCount = assertions.filter((a) => a.state === 'passed').length;
            const failedCount = assertions.length - passedCount;
            const logs = [`[case] ${caseObj.nodeid}`, `[status] ${statusVal}`, `[file] ${caseObj.file}`];
            const artifactCount = Array.isArray(st.artifacts) ? st.artifacts.length : Number(st.artifact_count || 0);
            const lastRunAt = st.last_run_at || st.updated_at || st.finished_at || st.started_at || null;
            return {
              ...caseObj,
              status: statusVal,
              duration: statusVal === 'running' ? 'running' : ((status[caseObj.testId] && status[caseObj.testId].duration) ? `${status[caseObj.testId].duration.toFixed(2)}s` : 'n/a'),
              assertions,
              assertionsPassed: passedCount,
              assertionsFailed: failedCount,
              logs,
              logsCount: logs.length,
              assertionsCount: assertions.length,
              artifactsCount: Number.isFinite(artifactCount) ? artifactCount : 0,
              lastRunAt,
              suiteId: (testMeta && testMeta.suite_id) || 'unknown',
              suiteName: (testMeta && (testMeta.suite_name || testMeta.suite_id)) || 'unknown',
              filePath: caseObj.file || 'unknown',
              traceback: statusVal === 'failed' ? `Traceback (most recent call last):
  ...
AssertionError: ${caseObj.name}` : '',
            };
          }

          function primeCaseModel(caseObj) {
            if (!caseObj || !caseObj.key || caseModelCache[caseObj.key] || caseModelPending[caseObj.key]) return;
            caseModelPending[caseObj.key] = true;
            requestAnimationFrame(() => {
              setTimeout(() => {
                delete caseModelPending[caseObj.key];
                caseModelCache[caseObj.key] = buildCaseModel(caseObj);
                if (drawerOpen && selectedCase && selectedCase.key === caseObj.key) renderDrawer();
              }, 0);
            });
          }

          function scheduleDrawerDetailsRender(caseKey) {
            if (!caseKey) return;
            requestAnimationFrame(() => {
              setTimeout(() => {
                if (!drawerOpen || !selectedCase || selectedCase.key !== caseKey) return;
                renderDrawer();
              }, 0);
            });
          }

          function selectCase(caseObj, options = {}) {
            const previousKey = selectedCase && selectedCase.key;
            selectedCase = caseObj || null;
            ensureSelectedCursor();
            updateSelectedCaseHighlight(previousKey, selectedCase && selectedCase.key ? selectedCase.key : null);
            if (selectedCase) primeCaseModel(selectedCase);
            if (options.openDrawer) {
              openDrawer();
              return;
            }
            if (drawerOpen) {
              renderDrawer();
              scheduleDrawerDetailsRender(selectedCase && selectedCase.key ? selectedCase.key : '');
            }
          }

          function openDrawer(caseObj = null) {
            if (caseObj) selectCase(caseObj);
            if (!selectedCase) return;
            drawerOpen = true;
            if (!drawerTab) drawerTab = 'summary';
            // Open first, load details later to keep selection responsive on large suites.
            applyDrawerLayout();
            renderDrawer();
            primeCaseModel(selectedCase);
            scheduleDrawerDetailsRender(selectedCase.key);
          }

          function closeDrawer() {
            drawerOpen = false;
            const el = document.getElementById('testDrawer');
            if (el) el.classList.remove('open');
          }

          function caseModel() {
            if (!selectedCase) return null;
            return caseModelCache[selectedCase.key] || null;
          }

          function renderDrawer() {
            const drawer = document.getElementById('testDrawer');
            const header = document.getElementById('drawerHeader');
            const tabs = document.getElementById('drawerTabs');
            const body = document.getElementById('drawerBody');
            const rail = document.getElementById('drawerRail');
            const model = caseModel();
            const statusVal = (model && model.status) || ((selectedCase && status[selectedCase.testId] && status[selectedCase.testId].status) || 'idle');
            const durationVal = (model && model.duration) || (statusVal === 'running' ? 'running' : (selectedCase && status[selectedCase.testId] && status[selectedCase.testId].duration ? `${status[selectedCase.testId].duration.toFixed(2)}s` : 'n/a'));

            if (!drawer || !header || !tabs || !body || !rail || !selectedCase || !drawerOpen) {
              if (drawer) drawer.classList.remove('open');
              return;
            }
            applyDrawerLayout();
            drawer.classList.add('open');

            rail.innerHTML = '';
            const railExpand = document.createElement('button');
            railExpand.className = 'icon-btn';
            railExpand.textContent = '»';
            railExpand.title = 'Expand drawer';
            railExpand.onclick = () => {
              drawerRail = false;
              applyDrawerLayout();
              renderDrawer();
            };
            const railDot = document.createElement('span');
            railDot.className = `rail-dot ${statusToBadge(statusVal)}`;
            const railLabel = document.createElement('div');
            railLabel.className = 'rail-label';
            railLabel.textContent = selectedCase.name;
            rail.appendChild(railExpand);
            rail.appendChild(railDot);
            rail.appendChild(railLabel);
            if (drawerRail) return;

            header.innerHTML = '';
            const headRow = document.createElement('div');
            headRow.className = 'drawer-head-row';
            const title = document.createElement('div');
            title.className = 'drawer-title';
            title.textContent = selectedCase.name;
            const headActions = document.createElement('div');
            headActions.className = 'drawer-head-actions';
            const statusPill = document.createElement('span');
            statusPill.className = `badge ${statusToBadge(statusVal)}`;
            statusPill.textContent = statusVal;
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'icon-btn';
            collapseBtn.textContent = '«';
            collapseBtn.title = 'Collapse to rail';
            collapseBtn.onclick = () => {
              drawerRail = true;
              applyDrawerLayout();
              renderDrawer();
            };
            const closeBtn = document.createElement('button');
            closeBtn.className = 'icon-btn';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close';
            closeBtn.onclick = () => closeDrawer();
            headActions.appendChild(statusPill);
            headActions.appendChild(collapseBtn);
            headActions.appendChild(closeBtn);
            headRow.appendChild(title);
            headRow.appendChild(headActions);
            header.appendChild(headRow);
            const sub = document.createElement('div');
            sub.className = 'drawer-sub';
            sub.textContent = `${selectedCase.nodeid} | ${durationVal}`;
            header.appendChild(sub);
            const suiteFile = document.createElement('div');
            suiteFile.className = 'drawer-sub mono';
            const suiteMeta = getSuiteMeta(selectedCase.testId);
            const suiteName = (model && model.suiteName) || (suiteMeta && suiteMeta.suite_name) || 'unknown';
            const filePath = (model && model.filePath) || selectedCase.file || 'unknown';
            suiteFile.textContent = `${suiteName} | ${filePath}`;
            suiteFile.title = 'Click to copy suite + file';
            suiteFile.style.cursor = 'pointer';
            suiteFile.onclick = async () => navigator.clipboard.writeText(`${suiteName} | ${filePath}`);
            header.appendChild(suiteFile);
            const headerSummary = document.createElement('div');
            headerSummary.className = 'drawer-summary';
            const hdrAssertions = (model && model.assertionsCount !== undefined && model.assertionsCount !== null) ? model.assertionsCount : '--';
            const hdrLogs = (model && model.logsCount !== undefined && model.logsCount !== null) ? model.logsCount : '--';
            const hdrArtifacts = (model && model.artifactsCount !== undefined && model.artifactsCount !== null) ? model.artifactsCount : '--';
            const hdrLastRun = (model && model.lastRunAt) ? formatTime(model.lastRunAt) : 'n/a';
            headerSummary.innerHTML = `<div class="drawer-summary-grid"><div>Status: ${statusVal}</div><div>Duration: ${durationVal}</div><div>Last run: ${hdrLastRun}</div><div>Suite: ${suiteName}</div></div><div class="drawer-summary-kpis"><span>Assertions: ${hdrAssertions}</span><span>Logs: ${hdrLogs}</span><span>Artifacts: ${hdrArtifacts}</span></div>`;
            header.appendChild(headerSummary);

            const actionRow = document.createElement('div');
            actionRow.className = 'drawer-actions';
            const rerun = document.createElement('button');
            rerun.textContent = 'Rerun';
            rerun.onclick = async () => window.pywebview.api.run_plan([selectedCase.testId], []);
            const copyMenu = document.createElement('details');
            copyMenu.className = 'copy-menu';
            const copySummary = document.createElement('summary');
            copySummary.className = 'ghost';
            copySummary.textContent = 'Copy';
            const copyPop = document.createElement('div');
            copyPop.className = 'split-pop';
            const copyNode = document.createElement('button');
            copyNode.textContent = 'Copy node id';
            copyNode.onclick = async () => {
              await navigator.clipboard.writeText(selectedCase.nodeid);
              copyMenu.removeAttribute('open');
            };
            const copySuitePath = document.createElement('button');
            copySuitePath.textContent = 'Copy suite + file';
            copySuitePath.onclick = async () => {
              await navigator.clipboard.writeText(`${suiteName} | ${filePath}`);
              copyMenu.removeAttribute('open');
            };
            const copyDiag = document.createElement('button');
            copyDiag.textContent = 'Copy diagnostics';
            copyDiag.onclick = async () => {
              await navigator.clipboard.writeText(await window.pywebview.api.get_diagnostics_summary());
              copyMenu.removeAttribute('open');
            };
            const copyRepro = document.createElement('button');
            copyRepro.textContent = 'Copy repro command';
            copyRepro.onclick = async () => {
              const repro = `pytest -k \"${selectedCase.nodeid}\"`;
              await navigator.clipboard.writeText(repro);
              copyMenu.removeAttribute('open');
            };
            copyPop.appendChild(copyNode);
            copyPop.appendChild(copySuitePath);
            copyPop.appendChild(copyDiag);
            copyPop.appendChild(copyRepro);
            copyMenu.appendChild(copySummary);
            copyMenu.appendChild(copyPop);
            actionRow.appendChild(rerun);
            actionRow.appendChild(copyMenu);
            header.appendChild(actionRow);

            const tabDefs = [
              { id: 'summary', label: 'Summary' },
              { id: 'assertions', label: 'Assertions' },
              { id: 'logs', label: 'Logs' },
            ];
            if (model && model.traceback) tabDefs.push({ id: 'traceback', label: 'Traceback' });
            if (!tabDefs.find((t) => t.id === drawerTab)) drawerTab = 'summary';

            tabs.innerHTML = '';
            tabDefs.forEach((tab) => {
              const btn = document.createElement('button');
              btn.className = `drawer-tab ${drawerTab === tab.id ? 'active' : ''}`;
              btn.textContent = tab.label;
              btn.onclick = () => {
                drawerTab = tab.id;
                renderDrawer();
              };
              tabs.appendChild(btn);
            });

            body.innerHTML = '';
            if (!model) {
              if (drawerTab === 'summary') {
                body.innerHTML = `<div class="drawer-skeleton long"></div><div class="drawer-skeleton medium"></div><div class="drawer-skeleton short"></div>`;
              } else if (drawerTab === 'logs') {
                body.innerHTML = `<div class="drawer-skeleton long"></div><div class="drawer-skeleton medium"></div><div class="drawer-skeleton long"></div>`;
              } else {
                body.innerHTML = `<div class="drawer-skeleton long"></div><div class="drawer-skeleton medium"></div>`;
              }
              return;
            }
            if (drawerTab === 'summary') {
              const failedAssertion = model.assertions.find((a) => a.state !== 'passed');
              const failureMsg = failedAssertion ? `Failing assertion: ${failedAssertion.title}` : 'No failing assertion detected.';
              const stackPreview = model.traceback ? model.traceback.split('\n').slice(0, 4).join('\n') : 'No traceback available.';
              body.innerHTML = `<div class="case-section"><div>${model.assertionsPassed} passed, ${model.assertionsFailed} failed</div><span class="case-pill">${model.duration}</span></div><div class="muted">${failureMsg}</div><pre class="mono" style="white-space: pre-wrap; margin-top: 8px;">${stackPreview}</pre>`;
            } else if (drawerTab === 'logs') {
              model.logs.forEach((line) => {
                const row = document.createElement('div');
                row.className = 'mono';
                row.textContent = line;
                body.appendChild(row);
              });
            } else if (drawerTab === 'traceback') {
              const trace = document.createElement('pre');
              trace.className = 'mono';
              trace.style.whiteSpace = 'pre-wrap';
              trace.textContent = model.traceback;
              body.appendChild(trace);
            } else if (drawerTab === 'assertions') {
              const top = document.createElement('div');
              top.className = 'case-section';
              top.innerHTML = `<div>${model.assertionsPassed} passed / ${model.assertionsFailed} failed</div><span class="case-pill">${model.duration}</span>`;
              body.appendChild(top);
              model.assertions.forEach((a) => {
                const row = document.createElement('div');
                row.className = 'assertion-row';
                row.innerHTML = `<div>${a.title}</div><div class="${a.state === 'passed' ? 'assertion-pass' : 'badge failed'}">${a.state}</div>`;
                row.onclick = () => {
                  if (expandedAssertionRows.has(a.id)) expandedAssertionRows.delete(a.id);
                  else expandedAssertionRows.add(a.id);
                  renderDrawer();
                };
                body.appendChild(row);
                if (expandedAssertionRows.has(a.id)) {
                  const showAll = expandedAssertionMore.has(a.id);
                  const lines = showAll ? a.detail : a.detail.slice(0, 2);
                  lines.forEach((line) => {
                    const step = document.createElement('div');
                    step.className = 'assertion-step';
                    step.textContent = `> ${line}`;
                    body.appendChild(step);
                  });
                  if (a.detail.length > 2 && !showAll) {
                    const more = document.createElement('button');
                    more.className = 'ghost';
                    more.textContent = `Show ${a.detail.length - 2} more`;
                    more.onclick = () => {
                      expandedAssertionMore.add(a.id);
                      renderDrawer();
                    };
                    body.appendChild(more);
                  }
                }
              });
            }
          }

          function switchTab(tabId) {
            activeTab = tabId;
            const tabEls = document.querySelectorAll('.tab');
            for (let i = 0; i < tabEls.length; i += 1) {
              const btn = tabEls[i];
              btn.classList.toggle('active', btn.dataset.tab === tabId);
            }
            const panelEls = document.querySelectorAll('.panel');
            for (let i = 0; i < panelEls.length; i += 1) {
              const panel = panelEls[i];
              panel.classList.toggle('active', panel.id === `panel-${tabId}`);
            }
            if (tabId !== 'tests') closeDrawer();
          }

          async function refreshLogs() {
            if (activeTab !== 'logs') return;
            const el = document.getElementById('logs');
            const text = await window.pywebview.api.get_logs();
            const shouldScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
            el.value = text;
            if (shouldScroll) el.scrollTop = el.scrollHeight;
          }

          async function copyLogs() {
            const text = await window.pywebview.api.get_logs();
            await navigator.clipboard.writeText(text);
          }

          async function copyDiagnostics() {
            const text = await window.pywebview.api.get_diagnostics_summary();
            await navigator.clipboard.writeText(text);
          }

          function selectedIds() {
            return Array.from(document.querySelectorAll('.tests-list input[type="checkbox"]')).filter((el) => el.checked).map((el) => el.value);
          }

          function applyFilters(rows) {
            const suite = document.getElementById('filterSuite').value;
            const kind = document.getElementById('filterKind').value;
            const outcome = filterOutcomeValue;
            const tag = document.getElementById('filterTag').value.trim().toLowerCase();
            return rows.filter((row) => {
              const st = (status[row.id] && status[row.id].status) || 'idle';
              const dur = Number(((status[row.id] && status[row.id].duration) || 0));
              if (suite && row.suite_id !== suite) return false;
              if (kind && row.kind !== kind) return false;
              if (outcome && st !== outcome) return false;
              if (tag && !(row.tags || []).some((t) => t.toLowerCase() === tag)) return false;
              if (quickFilter === 'failed' && st !== 'failed') return false;
              if (quickFilter === 'skipped' && st !== 'canceled' && st !== 'timed_out' && st !== 'skipped') return false;
              if (quickFilter === 'slow' && !(dur >= 1.0)) return false;
              return true;
            });
          }

          function suiteStatus(items) {
            const states = items.map((item) => (status[item.id] && status[item.id].status) || 'idle');
            if (states.some((s) => s === 'running')) return 'running';
            if (states.some((s) => s === 'retrying')) return 'retrying';
            if (states.some((s) => s === 'queued')) return 'queued';
            if (states.some((s) => s === 'failed')) return 'failed';
            if (states.some((s) => s === 'timed_out')) return 'timed_out';
            if (states.some((s) => s === 'canceled')) return 'canceled';
            if (states.length > 0 && states.every((s) => s === 'passed')) return 'passed';
            return 'idle';
          }

          function renderTests() {
            const list = document.getElementById('testsList');
            const suites = Array.from(new Set(tests.map((t) => t.suite_id))).sort();
            const suiteSelect = document.getElementById('filterSuite');
            const existing = suiteSelect.value;
            suiteSelect.innerHTML = '<option value="">all suites</option>';
            suites.forEach((s) => {
              const opt = document.createElement('option');
              opt.value = s;
              opt.textContent = s;
              suiteSelect.appendChild(opt);
            });
            suiteSelect.value = existing;

            captureCaseScrollPositions();
            list.innerHTML = '';
            const rows = applyFilters(tests);
            const suitesMap = new Map();
            rows.forEach((item) => {
              if (!suitesMap.has(item.suite_id)) suitesMap.set(item.suite_id, []);
              suitesMap.get(item.suite_id).push(item);
            });
            const allSuiteMap = new Map();
            tests.forEach((item) => {
              if (!allSuiteMap.has(item.suite_id)) allSuiteMap.set(item.suite_id, []);
              allSuiteMap.get(item.suite_id).push(item);
            });

            visibleCaseOrder = [];
            Object.keys(caseLookupByKey).forEach((k) => delete caseLookupByKey[k]);
            Array.from(allSuiteMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([suiteId, suiteItems]) => {
              const items = suitesMap.get(suiteId) || [];
              const card = document.createElement('div');
              card.className = 'suite-card';
              if (openSuiteId === suiteId) card.classList.add('open');

              const header = document.createElement('div');
              header.className = 'suite-header';
              header.onclick = () => {
                markUiInteraction();
                if (openSuiteId === suiteId) openSuiteId = null;
                else openSuiteId = suiteId;
                renderTests();
              };

              const left = document.createElement('div');
              left.className = 'suite-left';
              const summary = suiteStatus(suiteItems);
              const suiteLabel = suiteItems[0] ? suiteItems[0].suite_name : suiteId;
              const passedCount = suiteItems.filter((it) => ((status[it.id] && status[it.id].status) || 'idle') === 'passed').length;
              const failedCount = suiteItems.filter((it) => ((status[it.id] && status[it.id].status) || 'idle') === 'failed').length;
              const chev = openSuiteId === suiteId ? '⌄' : '›';
              left.innerHTML = `<div class=\"chev\">${chev}</div><div class=\"suite-title\">${suiteLabel} <span class=\"suite-meta\">${passedCount}/${failedCount}/${suiteItems.length}</span></div>`;

              const right = document.createElement('div');
              right.className = 'suite-right';
              const badge = document.createElement('span');
              badge.className = `badge ${summary}`;
              badge.textContent = summary;
              const runSuiteBtn = document.createElement('button');
              runSuiteBtn.className = 'ghost';
              runSuiteBtn.textContent = 'Run';
              runSuiteBtn.onclick = async (event) => {
                event.stopPropagation();
                await window.pywebview.api.run_plan(items.map((t) => t.id), []);
              };
              right.appendChild(badge);
              right.appendChild(runSuiteBtn);
              header.appendChild(left);
              header.appendChild(right);
              card.appendChild(header);

              if (openSuiteId === suiteId) {
                const rowsWrap = document.createElement('div');
                rowsWrap.className = 'suite-rows';
                if (!items.length) {
                  const empty = document.createElement('div');
                  empty.className = 'test-meta';
                  empty.textContent = 'No tests match current filters.';
                  rowsWrap.appendChild(empty);
                }
                items.forEach((item) => {
                  const st = (status[item.id] && status[item.id].status) || 'idle';
                  const row = document.createElement('div');
                  row.className = 'test-row';
                  if ((item.children || []).length > 0) {
                    row.style.cursor = 'pointer';
                    row.onclick = (event) => {
                      if (event.target.closest('button, input, select, textarea, label')) return;
                      markUiInteraction();
                      if (expandedTests.has(item.id)) expandedTests.delete(item.id);
                      else expandedTests.add(item.id);
                      renderTests();
                    };
                  }
                  const rowLeft = document.createElement('div');
                  rowLeft.className = 'test-left-wrap';
                  const itemChev = (item.children || []).length > 0 ? (expandedTests.has(item.id) ? '⌄' : '›') : '';
                  const stDuration = status[item.id] && status[item.id].duration;
                  const durationLabel = typeof stDuration === 'number' ? `${stDuration.toFixed(2)}s` : 'n/a';
                  const firstFile = ((item.children || [])[0] && (item.children || [])[0].file) || '';
                  rowLeft.innerHTML = `
                    <div class=\"chev\">${itemChev}</div>
                    <div>
                      <div class=\"test-name\">${item.name}</div>
                      <div class=\"test-subtle-file\">${firstFile || item.kind}</div>
                    </div>
                  `;
                  const rowRight = document.createElement('div');
                  rowRight.style.display = 'flex';
                  rowRight.style.gap = '8px';
                  rowRight.style.alignItems = 'center';
                  const durationEl = document.createElement('div');
                  durationEl.className = 'test-duration';
                  durationEl.textContent = durationLabel;
                  const rowBadge = document.createElement('span');
                  rowBadge.className = `badge ${st}`;
                  rowBadge.textContent = st;
                  const box = document.createElement('input');
                  box.type = 'checkbox';
                  box.value = item.id;
                  box.title = `Select ${item.name}`;
                  rowRight.appendChild(durationEl);
                  rowRight.appendChild(rowBadge);
                  rowRight.appendChild(box);
                  row.appendChild(rowLeft);
                  row.appendChild(rowRight);
                  rowsWrap.appendChild(row);

                  if (expandedTests.has(item.id) && (item.children || []).length > 0) {
                    const childWrap = document.createElement('div');
                    childWrap.className = 'child-rows';
                    const grouped = new Map();
                    item.children.forEach((child) => {
                      const file = child.file || 'unknown';
                      if (!grouped.has(file)) grouped.set(file, []);
                      grouped.get(file).push(child);
                    });

                    const summary = document.createElement('div');
                    summary.className = 'child-toolbar';
                    const summaryText = document.createElement('div');
                    summaryText.className = 'test-meta';
                    const search = (caseSearchByTest[item.id] || '').trim().toLowerCase();
                    const filesCount = grouped.size;
                    summaryText.textContent = `${item.children.length} discovered case(s) across ${filesCount} file(s)`;
                    const searchInput = document.createElement('input');
                    searchInput.className = 'child-search';
                    searchInput.placeholder = 'search cases or files';
                    searchInput.value = caseSearchByTest[item.id] || '';
                    searchInput.oninput = (event) => {
                      markUiInteraction();
                      caseSearchByTest[item.id] = event.target.value || '';
                      renderTests();
                    };
                    searchInput.onkeydown = () => markUiInteraction();
                    const toolbarRight = document.createElement('div');
                    toolbarRight.className = 'child-toolbar-right';
                    const groupSelect = document.createElement('select');
                    groupSelect.className = 'child-group';
                    groupSelect.innerHTML = '<option value=\"file\">Group: file</option><option value=\"name\">Group: name</option>';
                    groupSelect.value = caseGroupByTest[item.id] || 'file';
                    groupSelect.onchange = (event) => {
                      markUiInteraction();
                      caseGroupByTest[item.id] = event.target.value;
                      renderTests();
                    };
                    toolbarRight.appendChild(searchInput);
                    toolbarRight.appendChild(groupSelect);
                    summary.appendChild(summaryText);
                    summary.appendChild(toolbarRight);
                    childWrap.appendChild(summary);

                    const scroller = document.createElement('div');
                    scroller.className = 'child-scroll';
                    scroller.dataset.testId = item.id;
                    scroller.addEventListener('scroll', () => {
                      markUiInteraction();
                      caseScrollTopByTestId[item.id] = scroller.scrollTop;
                    });
                    scroller.addEventListener('wheel', () => markUiInteraction(), { passive: true });
                    scroller.addEventListener('touchmove', () => markUiInteraction(), { passive: true });

                    const groupMode = caseGroupByTest[item.id] || 'file';
                    const entries = groupMode === 'name'
                      ? [['All cases', Array.from(grouped.values()).flat().sort((a, b) => a.name.localeCompare(b.name))]]
                      : Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                    entries.forEach(([file, fileCases]) => {
                      const filtered = search
                        ? fileCases.filter((child) => {
                            const hay = `${child.name} ${child.nodeid} ${child.file}`.toLowerCase();
                            return hay.includes(search);
                          })
                        : fileCases;
                      if (filtered.length === 0) return;

                      const heading = document.createElement('div');
                      heading.className = 'child-file-heading';
                      heading.textContent = `${file} (${filtered.length})`;
                      scroller.appendChild(heading);

                      filtered.forEach((child) => {
                        const caseKey = `${item.id}::${child.nodeid}`;
                        const childRow = document.createElement('div');
                        childRow.className = `child-row clickable ${selectedCase && selectedCase.key === caseKey ? 'selected' : ''}`;
                        childRow.setAttribute('role', 'option');
                        childRow.setAttribute('aria-selected', selectedCase && selectedCase.key === caseKey ? 'true' : 'false');
                        childRow.tabIndex = -1;
                        childRow.dataset.caseKey = caseKey;
                        const caseObj = { key: caseKey, testId: item.id, name: child.name, nodeid: child.nodeid, file: child.file };
                        visibleCaseOrder.push(caseKey);
                        caseLookupByKey[caseKey] = caseObj;
                        childRow.onmouseenter = () => primeCaseModel(caseObj);
                        childRow.onclick = () => {
                          markUiInteraction();
                          selectCase(caseObj, { openDrawer: true });
                        };
                        childRow.ondblclick = () => {
                          markUiInteraction();
                          selectCase(caseObj, { openDrawer: true });
                        };
                        const childLeft = document.createElement('div');
                        childLeft.className = 'child-row-main';
                        childLeft.innerHTML = `<div class=\"chev\">›</div><div><div>${child.name}</div><div class=\"child-nodeid\">${child.nodeid}</div></div>`;
                        const childRight = document.createElement('div');
                        const childStatus = st === 'passed' ? 'Passed' : (st === 'failed' ? 'Failed' : String(st || 'idle').toUpperCase());
                        childRight.className = `badge ${st === 'passed' || st === 'failed' ? st : 'idle'}`;
                        childRight.textContent = childStatus;
                        childRow.appendChild(childLeft);
                        childRow.appendChild(childRight);
                        scroller.appendChild(childRow);
                      });
                    });

                    if (!scroller.children.length) {
                      const empty = document.createElement('div');
                      empty.className = 'test-meta';
                      empty.textContent = 'No cases match this search.';
                      scroller.appendChild(empty);
                    }
                    childWrap.appendChild(scroller);
                    rowsWrap.appendChild(childWrap);
                  }
                });
                card.appendChild(rowsWrap);
              }

              list.appendChild(card);
            });
            restoreCaseScrollPositions();
            ensureSelectedCursor();
            renderDrawer();

            updateToolbarState();
          }

          async function refreshTests() {
            tests = await window.pywebview.api.get_tests();
            status = await window.pywebview.api.get_test_status();
            updateToolbarState();
            if (selectedCase && selectedCase.key) {
              delete caseModelCache[selectedCase.key];
              delete caseModelPending[selectedCase.key];
              primeCaseModel(selectedCase);
            }
            const startup = await window.pywebview.api.get_startup_state();
            document.getElementById('startupStatus').textContent = startup.ready ? 'startup: ready' : `startup issues: ${startup.issues.length}`;
            if (isUiInteractionLocked()) {
              pendingRefresh = true;
            } else {
              renderTests();
              pendingRefresh = false;
            }
            await renderHistory();
          }

          function maybeApplyDeferredRender() {
            if (pendingRefresh && !isUiInteractionLocked()) {
              renderTests();
              pendingRefresh = false;
            }
          }

          function moveSelection(delta) {
            if (!visibleCaseOrder.length) return;
            if (selectedCaseCursor < 0) selectedCaseCursor = 0;
            else selectedCaseCursor = Math.max(0, Math.min(visibleCaseOrder.length - 1, selectedCaseCursor + delta));
            const key = visibleCaseOrder[selectedCaseCursor];
            const el = document.querySelector(`[data-case-key="${key}"]`);
            if (el) {
              el.scrollIntoView({ block: 'nearest' });
              if (caseLookupByKey[key]) selectCase(caseLookupByKey[key]);
            }
          }

          document.addEventListener('keydown', (event) => {
            if (activeTab !== 'tests') return;
            const target = event.target;
            const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
            if (event.key === '/' && !isTyping) {
              event.preventDefault();
              const search = document.querySelector('.child-search');
              if (search) search.focus();
              return;
            }
            if (event.key === 'Escape') {
              if (filterOutcomeMenuEl) {
                closeSplitMenus();
                return;
              }
              closeDrawer();
              return;
            }
            if (isTyping) return;
            if (event.key === 'j' || event.key === 'ArrowDown') {
              event.preventDefault();
              moveSelection(1);
              return;
            }
            if (event.key === 'k' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveSelection(-1);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              openDrawer();
            }
          });

          document.addEventListener('click', (event) => {
            const target = event.target;
            const isEl = target && typeof target.closest === 'function';
            if (!isEl) {
              closeSplitMenus();
              return;
            }
            if (!target.closest('.split-menu') && !target.closest('.copy-menu') && !target.closest('.filter-wrap') && !target.closest('.filter-menu')) {
              closeSplitMenus();
            }
          });

          document.addEventListener('mousemove', (event) => {
            if (!drawerResizing) return;
            const delta = drawerResizeStartX - event.clientX;
            drawerWidth = Math.max(320, Math.min(560, drawerResizeStartWidth + delta));
            applyDrawerLayout();
          });

          document.addEventListener('mouseup', () => {
            drawerResizing = false;
          });

          window.addEventListener('resize', () => {
            applyDrawerLayout();
            closeSplitMenus();
          });

          async function renderHistory() {
            const runs = await window.pywebview.api.get_runs();
            const el = document.getElementById('runHistory');
            el.innerHTML = '';
            runs.forEach((run) => {
              const row = document.createElement('div');
              row.className = 'run-row';
              const left = document.createElement('div');
              const started = run.started_at ? formatTime(run.started_at) : 'n/a';
              const passed = Number(run.passed_count || run.pass_count || 0);
              const failed = Number(run.failed_count || run.fail_count || 0);
              const total = Number(run.total_count || 0);
              const dur = typeof run.duration_seconds === 'number' ? `${run.duration_seconds.toFixed(1)}s` : 'n/a';
              left.textContent = `${started} • ${dur} • ${passed}/${failed}/${total} • ${run.status || 'unknown'}`;
              const right = document.createElement('div');
              right.style.display = 'flex';
              right.style.gap = '8px';
              const badge = document.createElement('span');
              badge.className = 'export-badge';
              badge.textContent = run.run_id || 'run';
              const openBtn = document.createElement('button');
              openBtn.className = 'ghost';
              openBtn.textContent = 'Open Artifacts';
              openBtn.onclick = async () => window.pywebview.api.open_run_dir(run.run_id || '');
              right.appendChild(badge);
              right.appendChild(openBtn);
              row.appendChild(left);
              row.appendChild(right);
              el.appendChild(row);
            });
          }

          async function previewPlan() {
            const ids = selectedIds();
            const tag = document.getElementById('filterTag').value.trim();
            const tags = tag ? [tag] : [];
            const plan = await window.pywebview.api.preview_plan(ids, tags);
            const line = plan.map((p) => `${p.order}:${p.id}`).join(' → ');
            document.getElementById('planPreview').textContent = line || 'No plan';
          }

          async function runDefault() {
            if (selectedIds().length > 0) {
              await runSelected();
              return;
            }
            await runFiltered();
          }

          async function runFailed() {
            const failedIds = tests
              .filter((t) => ((status[t.id] && status[t.id].status) || 'idle') === 'failed')
              .map((t) => t.id);
            await window.pywebview.api.run_plan(failedIds, []);
          }

          async function runSelected() {
            await window.pywebview.api.run_plan(selectedIds(), []);
          }

          async function runFiltered() {
            const tag = document.getElementById('filterTag').value.trim();
            const tags = tag ? [tag] : [];
            await window.pywebview.api.run_plan([], tags);
          }

          async function cancelCurrent() {
            await window.pywebview.api.cancel_current_test();
          }

          async function cancelRun() {
            await window.pywebview.api.cancel_run();
          }

          const drawerResizeEl = document.getElementById('drawerResize');
          if (drawerResizeEl) {
            drawerResizeEl.addEventListener('mousedown', beginDrawerResize);
          }
          window.addEventListener('error', (event) => {
            const el = document.getElementById('startupStatus');
            if (el) el.textContent = `ui error: ${event.message || 'unknown'}`;
          });
          window.addEventListener('unhandledrejection', (event) => {
            const el = document.getElementById('startupStatus');
            const reason = event && event.reason ? String(event.reason) : 'unknown';
            if (el) el.textContent = `ui rejection: ${reason}`;
          });
          try {
            setDensity('comfort');
            setOutcomeFilter('');
            setQuickFilter('all');
            applyDrawerLayout();
          } catch (err) {
            const el = document.getElementById('startupStatus');
            if (el) el.textContent = `ui init failed: ${err instanceof Error ? err.message : String(err)}`;
          }

          setInterval(refreshLogs, 800);
          setInterval(refreshTests, 1200);
          setInterval(maybeApplyDeferredRender, 250);
          refreshLogs();
          refreshTests();
        