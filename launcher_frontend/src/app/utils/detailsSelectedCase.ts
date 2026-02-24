type DetailsCaseLike = {
  id: string;
  testId?: string;
  name?: string;
  nodeid?: string;
  file_path?: string;
  suite_id?: string;
  tags?: string[];
};

type GraphDetailNodeLike = {
  id: string;
  name?: string;
  filePath?: string;
  suiteId?: string;
  tags?: string[];
  aggregateSummary?: unknown;
  aggregateChildren?: Array<{ id: string; name?: string; filePath?: string }>;
};

export function toDetailsSelectedCase(
  tab: string,
  graphDetailsNode: GraphDetailNodeLike | null,
  graphDetailChildId: string,
  selectedCase: DetailsCaseLike | null
) {
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
