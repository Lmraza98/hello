import { useGraphRuntimeModel } from "./useGraphRuntimeModel";
import { useGraphRuntimeEffects } from "./useGraphRuntimeEffects";
import type { UseGraphRuntimeModelParams } from "./useGraphRuntimeModel";
import type { UseGraphRuntimeEffectsParams } from "./useGraphRuntimeEffects";

type GraphRuntimeCtx = UseGraphRuntimeModelParams & Omit<
  UseGraphRuntimeEffectsParams,
  | "graphNodesWithPlayback"
  | "artifactReplayMode"
  | "graphDetailsNode"
  | "graphActiveChildId"
  | "graphDetailChildId"
  | "graphSelectedEvent"
  | "childAttemptById"
  | "activeChildProgressRows"
  | "pathPlaybackState"
  | "activeAggregateNode"
  | "detailsAggregateNode"
  | "playbackActiveNodeId"
  | "suppressLiveGraphAutotrack"
  | "activeRunRow"
>;

export function useGraphRuntime(ctx: GraphRuntimeCtx) {
  const model = useGraphRuntimeModel(ctx);
  const { selectGraphNode, updateGraphPlayback } = useGraphRuntimeEffects({
    ...ctx,
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
