export interface TestRow {
  id: string;
  suite_id?: string;
  name?: string;
  status?: string;
  children?: Array<{ id?: string; nodeid?: string; name?: string; status?: string }>;
}

export interface SuiteRow {
  suiteId: string;
  cases: TestRow[];
}

export interface StatusRow {
  status?: string;
  duration?: number | null;
  attempt?: number | string | null;
  lastRun?: number | string | null;
  message?: string;
  started_at?: number | string | null;
  finished_at?: number | string | null;
}

export interface RunRow {
  run_id?: string;
  status?: string;
  tests?: Array<{
    id?: string;
    status?: string;
    children?: Array<{ id?: string; nodeid?: string; name?: string; status?: string }>;
  }>;
  selected_test_ids?: string[];
  selected_step_ids?: string[];
}

export interface ChildProgressRow {
  childId?: string;
  status?: string;
  attemptId?: number | string | null;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  message?: string;
}

export interface ChildEventRow {
  id?: string;
  ts?: string | number;
  type?: string;
  nodeId?: string;
  message?: string;
}
