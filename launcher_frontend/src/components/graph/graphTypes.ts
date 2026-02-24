import type { NodeStatus, RunEvent, TestNode } from "../../lib/graph/types";
import type { PathStep } from "../../lib/graph/playback/GraphPlaybackEngine";
import type { NodeTransition } from "../../lib/graph/playback/transitions";

export type GraphScope = {
  level: "suite" | "aggregate" | "child";
  aggregateId?: string;
  childId?: string;
};

export type GraphEdgeLike = {
  from: string;
  to: string;
  semantic?: boolean;
  synthetic?: boolean;
  bundle?: boolean;
};

export type GraphNodeLike = TestNode & {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bundle?: boolean;
  rawChildKey?: string;
};

export type GraphPlaybackMode = "timeline" | "path";

export type GraphTransition = NodeTransition;
export type GraphPathStep = PathStep;

export type GraphPlaybackState = {
  mode?: GraphPlaybackMode;
  transitions?: NodeTransition[];
  pathSteps?: PathStep[];
  cursor?: number;
  isPlaying?: boolean;
  speed?: number;
  pathExplanation?: string;
};

export type GraphStateLike = {
  nodes: TestNode[];
  edges: GraphEdgeLike[];
  events: RunEvent[];
  selectedNodeId?: string;
  highlightMode?: "upstream" | "downstream" | "both" | "none";
  playback?: GraphPlaybackState;
};

export type ChildProgressRow = {
  childId: string;
  status: NodeStatus | string;
};

export type ChildDagGraphModel = {
  childId: string;
  rawChildId: string;
  runId: string;
  attemptId: string | number;
  source: "real" | "derived" | "placeholder";
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  eventsMatchedCount: number;
};
