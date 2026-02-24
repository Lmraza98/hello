import assert from "node:assert/strict";
import {
  canonicalChildId,
  createIdsForRun,
  normalizeChildSelectionId,
} from "./ids.js";
import {
  pickActiveAggregateFromGraph,
  pickActiveChildFromAggregateNode,
  pickAggregateForActiveChild,
  pickPreferredAggregateId,
} from "./runPickers.js";
import { sameProgressRows } from "./comparisons.js";

function run(name, fn) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok - ${name}`);
}

run("canonicalChildId and normalizeChildSelectionId keep canonical parent::child shape", () => {
  assert.equal(canonicalChildId("agg-a", "test_mod::test_case"), "agg-a::test_mod::test_case");
  assert.equal(canonicalChildId("agg-a", "agg-a::test_mod::test_case"), "agg-a::test_mod::test_case");
  assert.equal(normalizeChildSelectionId("agg-a", "test_mod::test_case"), "agg-a::test_mod::test_case");
  assert.equal(normalizeChildSelectionId("agg-a", "agg-a::test_mod::test_case"), "agg-a::test_mod::test_case");
});

run("idsForRun normalization resolves placeholders and child ids", () => {
  const idsForRun = createIdsForRun({
    tests: [{ id: "agg-a" }, { id: "python-tests-all" }],
    graphNodesWithPlayback: [
      {
        id: "agg-a",
        aggregateSummary: {},
        aggregateChildren: [{ id: "agg-a::tests/foo.py::test_x", rawChildKey: "tests/foo.py::test_x" }],
      },
    ],
    graphSelectedRunTargetId: "placeholder:node",
    graphScope: { level: "child", childId: "agg-a::tests/foo.py::test_x", aggregateId: "agg-a" },
    manualGraphChildId: "",
    graphDetailChildId: "",
    graphState: { selectedNodeId: "" },
    selectedCaseId: "",
    selectedCaseIds: new Set(),
    selectedTestId: "agg-a",
    aggregateScopedSuites: [{ cases: [{ id: "agg-a" }] }],
  });
  assert.deepEqual(idsForRun("selected"), ["agg-a::tests/foo.py::test_x"]);
  assert.deepEqual(idsForRun("all"), ["agg-a"]);
});

run("pickers select preferred aggregate and child mapping", () => {
  const graphNodes = [
    { id: "agg-a", aggregateSummary: {}, aggregateChildren: [{ id: "agg-a::c1", status: "queued" }] },
    { id: "python-tests-all", aggregateSummary: {}, aggregateChildren: [{ id: "python-tests-all::c2", status: "running" }] },
  ];
  assert.equal(
    pickPreferredAggregateId({ selected_test_ids: ["python-tests-all"] }, graphNodes),
    "python-tests-all"
  );
  assert.equal(
    pickActiveAggregateFromGraph(
      [{ ...graphNodes[0], status: "queued" }, { ...graphNodes[1], status: "running" }],
      {}
    ),
    "python-tests-all"
  );
  assert.equal(pickAggregateForActiveChild("agg-a::c1", graphNodes, ""), "agg-a");
  assert.equal(
    pickActiveChildFromAggregateNode({ id: "agg-a", aggregateSummary: { activeChildId: "c9" }, aggregateChildren: [] }),
    "agg-a::c9"
  );
});

run("sameProgressRows compares row content not references", () => {
  const a = [{ childId: "c1", status: "running", attemptId: 1, startedAt: "1", finishedAt: "", message: "" }];
  const b = [{ childId: "c1", status: "running", attemptId: 1, startedAt: "1", finishedAt: "", message: "" }];
  const c = [{ childId: "c1", status: "failed", attemptId: 1, startedAt: "1", finishedAt: "", message: "" }];
  assert.equal(sameProgressRows(a, b), true);
  assert.equal(sameProgressRows(a, c), false);
});
