import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Load Bun's OS-backed lock only when an executable run acquires it. */
export async function acquireDemoWorkerLock(
  runId: string,
): Promise<() => void> {
  const { acquireProcessLock } = await import("./process-lock.ts");
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.repayd/demo-worker.sqlite",
  );
  return acquireProcessLock(path, `demo-run:${runId}`);
}

/** ESRCH alone proves death; permission failures never justify taking over. */
function confirmedDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Managed children require the expected live parent and an actual IPC pipe. */
export function requireDemoParent(): boolean {
  const configured = process.env.REPAYD_PARENT_PID;
  if (!configured) {
    if (process.env.REPAYD_RUN_ID)
      throw new Error(
        "Managed demo requires REPAYD_PARENT_PID and an IPC parent channel",
      );
    return false;
  }
  const parent = Number(configured);
  if (
    !Number.isSafeInteger(parent) ||
    parent <= 0 ||
    process.ppid !== parent ||
    confirmedDead(parent) ||
    process.connected !== true ||
    typeof process.send !== "function"
  ) {
    throw new Error(
      "Managed demo parent or IPC channel is unavailable; refusing to start a signer",
    );
  }
  return true;
}
