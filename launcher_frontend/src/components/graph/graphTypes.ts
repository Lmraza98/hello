import type { NodeStatus, RunEvent, TestNode } from "../../lib/graph/types";

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

export type GraphPlaybackState = {
  mode?: GraphPlaybackMode;
  transitions?: any[];
  pathSteps?: any[];
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
