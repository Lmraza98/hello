const laneChains = new Map<string, Promise<void>>();

export async function enqueueInLane<T>(lane: string, task: () => Promise<T>): Promise<T> {
  const key = lane.trim() || 'default';
  const previous = laneChains.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.then(() => undefined, () => undefined);
  laneChains.set(key, settled);
  try {
    return await run;
  } finally {
    if (laneChains.get(key) === settled) {
      laneChains.delete(key);
    }
  }
}
