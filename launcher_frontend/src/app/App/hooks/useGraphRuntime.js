import { useGraphRuntimeModel } from "./useGraphRuntimeModel";
import { useGraphRuntimeEffects } from "./useGraphRuntimeEffects";

export function useGraphRuntime(params) {
  const model = useGraphRuntimeModel(params);
  const { selectGraphNode, updateGraphPlayback } = useGraphRuntimeEffects({
    ...params,
    ...model,
  });

  return {
    graphScreenshotsById: model.graphScreenshotsById,
    graphNodesWithPlayback: model.graphNodesWithPlayback,
    artifactReplayMode: model.artifactReplayMode,
    graphDetailsNode: model.graphDetailsNode,
    graphActiveChildId: model.graphActiveChildId,
    graphDetailChildId: model.graphDetailChildId,
    graphSelectedEvent: model.graphSelectedEvent,
    childAttemptById: model.childAttemptById,
    childScopeProgress: model.childScopeProgress,
    runInspector: model.runInspector,
    activeRunRow: model.activeRunRow,
    anyRunActive: model.anyRunActive,
    idsForRun: model.idsForRun,
    selectGraphNode,
    updateGraphPlayback,
  };
}
