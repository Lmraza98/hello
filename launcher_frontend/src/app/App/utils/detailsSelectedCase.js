export function toDetailsSelectedCase(tab, graphDetailsNode, graphDetailChildId, selectedCase) {
  if (tab !== "graph" || !graphDetailsNode) return selectedCase;
  const hasAggregate = Boolean(graphDetailsNode.aggregateSummary && Array.isArray(graphDetailsNode.aggregateChildren));
  const activeChild = hasAggregate ? (graphDetailsNode.aggregateChildren || []).find((c) => c.id === graphDetailChildId) : null;
  if (activeChild) {
    return {
      id: activeChild.id,
      testId: graphDetailsNode.id,
      name: activeChild.name,
      nodeid: activeChild.id,
      file_path: activeChild.filePath,
      suite_id: graphDetailsNode.suiteId,
      tags: graphDetailsNode.tags || [],
    };
  }
  return {
    id: graphDetailsNode.id,
    testId: graphDetailsNode.id,
    name: graphDetailsNode.name,
    nodeid: graphDetailsNode.id,
    file_path: graphDetailsNode.filePath,
    suite_id: graphDetailsNode.suiteId,
    tags: graphDetailsNode.tags || [],
  };
}
