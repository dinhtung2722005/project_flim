// Keep in-flight player teardown reachable after its component has unmounted.
const pending = new Map<string, () => Promise<void>>();

export function registerPlaybackCleanup(
  id: string,
  cleanup: () => Promise<void>,
) {
  pending.set(id, cleanup);
  return () => {
    if (pending.get(id) === cleanup) pending.delete(id);
  };
}

export async function settlePlaybackCleanup(timeoutMs = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...pending.values()].map((cleanup) => cleanup())),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
