import { useEffect, useMemo, useState } from 'react';
import { processMessage } from '../../chat/chatEngine';
import { TOOLS } from '../../chat/tools';
import {
  clearToolExampleOverrides,
  getExamplesForTool,
  getResolvedExamplesForToolName,
  getToolExampleOverrides,
  PLANNER_TOOL_USAGE_RULES,
  setToolExampleOverrides,
  type ToolCallExample,
} from '../../chat/toolExamples';
import { useRegisterCapabilities } from '../../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../../capabilities/catalog';

type ToolExpectation = {
  tool: string;
  args?: Record<string, unknown>;
};

type PlannerTestCase = {
  id: number;
  input: string;
  expected: ToolExpectation;
};

type PlannerTestResult = {
  id: number;
  input: string;
  passed: boolean;
  actualTool?: string;
  actualArgs?: Record<string, unknown>;
  error?: string;
};

const TEST_CASES: PlannerTestCase[] = [
  { id: 1, input: 'Find Lucas Raza', expected: { tool: 'search_contacts', args: { name: 'Lucas Raza' } } },
  { id: 2, input: 'Find Keven Fuertes', expected: { tool: 'search_contacts', args: { name: 'Keven Fuertes' } } },
  { id: 3, input: 'Find Keven Fuertes from RussElectric', expected: { tool: 'search_contacts', args: { name: 'Keven Fuertes', company: 'RussElectric' } } },
  { id: 4, input: 'Find construction companies', expected: { tool: 'search_companies', args: { vertical: 'Construction' } } },
  { id: 5, input: 'Find vet companies in Texas', expected: { tool: 'search_companies', args: { vertical: 'Veterinary' } } },
  { id: 6, input: 'search salesnavigator for construction companies in nebraska', expected: { tool: 'collect_companies_from_salesnav' } },
  { id: 8, input: 'Send an email to Lucas Raza', expected: { tool: 'search_contacts', args: { name: 'Lucas Raza' } } },
  { id: 9, input: 'add lucas raza to an email campaign', expected: { tool: 'search_contacts', args: { name: 'lucas raza' } } },
  { id: 10, input: 'Show me vet clinics in New Hampshire', expected: { tool: 'search_companies', args: { vertical: 'Veterinary' } } },
  { id: 11, input: 'Find companies in the banking industry', expected: { tool: 'search_companies', args: { vertical: 'Banking' } } },
  { id: 12, input: 'Find construction on LinkedIn SalesNavigator in New England', expected: { tool: 'collect_companies_from_salesnav' } },
];

function isArgSubset(expected: Record<string, unknown> | undefined, actual: Record<string, unknown> | undefined): boolean {
  if (!expected) return true;
  const target = actual || {};
  return Object.entries(expected).every(([k, v]) => {
    const got = target[k];
    if (typeof v === 'string') {
      return String(got || '').toLowerCase().includes(v.toLowerCase());
    }
    return JSON.stringify(got) === JSON.stringify(v);
  });
}

export default function AdminTests() {
  const [results, setResults] = useState<PlannerTestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [overrideVersion, setOverrideVersion] = useState(0);
  const [selectedTool, setSelectedTool] = useState<string>(TOOLS[0]?.function.name || 'search_contacts');
  const [editorValue, setEditorValue] = useState<string>('');
  const [editorStatus, setEditorStatus] = useState<string>('');
  useRegisterCapabilities(getPageCapability('admin.tests'));

  const passCount = useMemo(() => results.filter((r) => r.passed).length, [results]);
  const toolExamples = useMemo(
    () =>
      TOOLS.map((tool) => ({
        name: tool.function.name,
        examples: getExamplesForTool(tool, 5),
      })),
    [overrideVersion]
  );
  const overrides = useMemo(() => getToolExampleOverrides(), [overrideVersion]);

  useEffect(() => {
    if (!selectedTool) return;
    const existing = overrides[selectedTool];
    const resolved = existing && existing.length > 0
      ? existing
      : getResolvedExamplesForToolName(selectedTool, TOOLS, 5);
    setEditorValue(JSON.stringify(resolved, null, 2));
  }, [selectedTool, overrides]);

  const runSingle = async (testCase: PlannerTestCase): Promise<PlannerTestResult> => {
    try {
      const result = await processMessage(testCase.input, {
        conversationHistory: [],
        phase: 'planning',
        requireToolConfirmation: true,
      });

      const firstCall = result.confirmation?.calls?.[0] ||
        result.debugTrace?.executedCalls?.[0] && {
          name: result.debugTrace.executedCalls[0].name,
          args: result.debugTrace.executedCalls[0].args,
        };

      const actualTool = firstCall?.name;
      const actualArgs = firstCall?.args || {};
      const toolMatches = actualTool === testCase.expected.tool;
      const argsMatch = isArgSubset(testCase.expected.args, actualArgs);

      return {
        id: testCase.id,
        input: testCase.input,
        passed: Boolean(toolMatches && argsMatch),
        actualTool,
        actualArgs,
        error: toolMatches ? undefined : `Expected ${testCase.expected.tool}, got ${actualTool || 'none'}`,
      };
    } catch (err) {
      return {
        id: testCase.id,
        input: testCase.input,
        passed: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  };

  const runAll = async () => {
    setRunning(true);
    const out: PlannerTestResult[] = [];
    for (const testCase of TEST_CASES) {
      // Serial execution keeps traces deterministic and avoids lane contention.
      // eslint-disable-next-line no-await-in-loop
      const row = await runSingle(testCase);
      out.push(row);
      setResults([...out]);
    }
    setRunning(false);
  };

  const loadToolIntoEditor = (toolName: string) => {
    setSelectedTool(toolName);
    const existing = overrides[toolName];
    const resolved = existing && existing.length > 0
      ? existing
      : getResolvedExamplesForToolName(toolName, TOOLS, 5);
    setEditorValue(JSON.stringify(resolved, null, 2));
    setEditorStatus(existing && existing.length > 0 ? `Loaded custom override for ${toolName}.` : `Loaded resolved examples for ${toolName}.`);
  };

  const saveOverride = () => {
    try {
      const parsed = JSON.parse(editorValue) as ToolCallExample[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setEditorStatus('Editor JSON must be a non-empty array of {user,calls}.');
        return;
      }
      const cleaned: ToolCallExample[] = [];
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        const user = typeof row.user === 'string' ? row.user.trim() : '';
        if (!user) continue;
        const calls = Array.isArray(row.calls) ? row.calls : [];
        const safeCalls = calls
          .filter((call) => call && typeof call === 'object')
          .map((call) => {
            const obj = call as Record<string, unknown>;
            const name = String(obj.name || '').trim();
            const args =
              obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
                ? (obj.args as Record<string, unknown>)
                : {};
            return { name, args };
          })
          .filter((call) => Boolean(call.name));
        if (safeCalls.length === 0) continue;
        cleaned.push({ user, calls: safeCalls });
      }
      if (cleaned.length === 0) {
        setEditorStatus('No valid examples found. Nothing saved.');
        return;
      }
      const next = { ...overrides, [selectedTool]: cleaned };
      setToolExampleOverrides(next);
      setOverrideVersion((v) => v + 1);
      setEditorStatus(`Saved ${cleaned.length} override example(s) for ${selectedTool}.`);
    } catch (err) {
      setEditorStatus(err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON.');
    }
  };

  const resetToolOverride = () => {
    const next = { ...overrides };
    delete next[selectedTool];
    setToolExampleOverrides(next);
    setOverrideVersion((v) => v + 1);
    const resolved = getResolvedExamplesForToolName(selectedTool, TOOLS, 5);
    setEditorValue(JSON.stringify(resolved, null, 2));
    setEditorStatus(`Cleared override for ${selectedTool}.`);
  };

  const resetAllOverrides = () => {
    clearToolExampleOverrides();
    setOverrideVersion((v) => v + 1);
    const resolved = getResolvedExamplesForToolName(selectedTool, TOOLS, 5);
    setEditorValue(JSON.stringify(resolved, null, 2));
    setEditorStatus('Cleared all tool example overrides.');
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-text">Planner Test Suite</h2>
          <p className="text-xs text-text-muted">Runs real `processMessage` planner checks against known failure cases.</p>
        </div>
        <button
          type="button"
          onClick={runAll}
          disabled={running}
          className="px-3 py-2 rounded-md text-sm font-medium border border-border bg-surface-hover disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run Tests'}
        </button>
      </div>

      <div className="text-xs text-text-muted mb-3">
        Passed: <span className="text-text font-medium">{passCount}</span> / {TEST_CASES.length}
      </div>

      <details className="mb-4 border border-border rounded-md p-2">
        <summary className="cursor-pointer text-sm font-medium text-text">Planner Rules (user-facing)</summary>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-text-muted">{PLANNER_TOOL_USAGE_RULES}</pre>
      </details>

      <div className="overflow-auto border border-border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover/40 text-text-muted">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Input</th>
              <th className="text-left p-2">Expected Tool</th>
              <th className="text-left p-2">Actual Tool</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {TEST_CASES.map((tc) => {
              const row = results.find((r) => r.id === tc.id);
              return (
                <tr key={tc.id} className="border-t border-border">
                  <td className="p-2 align-top">{tc.id}</td>
                  <td className="p-2 align-top">{tc.input}</td>
                  <td className="p-2 align-top font-mono text-xs">{tc.expected.tool}</td>
                  <td className="p-2 align-top font-mono text-xs">{row?.actualTool || '-'}</td>
                  <td className="p-2 align-top">
                    {!row ? (
                      <span className="text-text-dim">-</span>
                    ) : row.passed ? (
                      <span className="text-green-600">PASS</span>
                    ) : (
                      <span className="text-red-600" title={row.error}>FAIL</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-text mb-2">Tool Call Examples (tuning surface)</h3>
        <p className="text-xs text-text-muted mb-3">
          Each tool includes multiple example prompts and expected tool-call JSON used by planner tuning.
        </p>
        <div className="mb-4 border border-border rounded-md p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select
              value={selectedTool}
              onChange={(e) => loadToolIntoEditor(e.target.value)}
              className="px-2 py-1 text-sm border border-border rounded bg-surface"
            >
              {TOOLS.map((tool) => (
                <option key={tool.function.name} value={tool.function.name}>
                  {tool.function.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => loadToolIntoEditor(selectedTool)} className="px-2 py-1 text-xs border border-border rounded">
              Load
            </button>
            <button type="button" onClick={saveOverride} className="px-2 py-1 text-xs border border-border rounded bg-surface-hover">
              Save Override
            </button>
            <button type="button" onClick={resetToolOverride} className="px-2 py-1 text-xs border border-border rounded">
              Reset Tool
            </button>
            <button type="button" onClick={resetAllOverrides} className="px-2 py-1 text-xs border border-border rounded">
              Reset All
            </button>
          </div>
          <textarea
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            className="w-full min-h-[180px] p-2 font-mono text-xs border border-border rounded bg-bg"
            placeholder={'JSON array of examples [{"user":"...","calls":[{"name":"tool","args":{}}]}]'}
          />
          {editorStatus ? <div className="mt-2 text-xs text-text-muted">{editorStatus}</div> : null}
        </div>
        <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
          {toolExamples.map((row) => (
            <details key={row.name} className="border border-border rounded-md p-2">
              <summary className="cursor-pointer font-mono text-xs text-text">{row.name}</summary>
              <div className="mt-2 space-y-2">
                {row.examples.map((ex, idx) => (
                  <div key={`${row.name}-${idx}`} className="bg-surface-hover/40 rounded p-2">
                    <div className="text-xs text-text mb-1"><strong>User:</strong> {ex.user}</div>
                    <pre className="text-[11px] text-text-muted whitespace-pre-wrap break-words">
{JSON.stringify(ex.calls, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
