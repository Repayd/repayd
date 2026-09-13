import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProcessLock } from "../../demo/src/process-lock.ts";

const directories: string[] = [];
const children: Bun.Subprocess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function lockPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "repayd-ownership-"));
  directories.push(directory);
  return join(directory, "worker.sqlite");
}
const moduleUrl = new URL("../../demo/src/process-lock.ts", import.meta.url)
  .href;
function holder(path: string) {
  let resolve!: (state: "locked" | "busy") => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<"locked" | "busy">((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "--eval",
      `
      import { acquireProcessLock } from ${JSON.stringify(moduleUrl)};
      try {
        const release = acquireProcessLock(process.env.LOCK_PATH, 'test worker');
        process.send({state:'locked'});
        process.on('message', () => { release(); process.disconnect(); });
      } catch (error) {
        if (!String(error).includes('execution lock')) throw error;
        process.send({state:'busy'});
        process.disconnect();
      }
    `,
    ],
    env: { ...process.env, LOCK_PATH: path },
    stdout: "ignore",
    stderr: "inherit",
    stdin: "ignore",
    // A test-runner safeguard for a broken child, not a guessed synchronization delay.
    timeout: 5_000,
    ipc(message: unknown) {
      if (
        message &&
        typeof message === "object" &&
        "state" in message &&
        (message.state === "locked" || message.state === "busy")
      )
        resolve(message.state);
    },
    onExit(_child, code) {
      if (code !== 0 && code !== null)
        reject(new Error(`Lock fixture exited ${code}`));
    },
  });
  children.push(child);
  return { child, ready };
}

test("a live owner cannot be replaced, and release is idempotent", () => {
  const path = lockPath();
  const release = acquireProcessLock(path, "first worker");
  expect(() => acquireProcessLock(path, "second worker")).toThrow(
    "execution lock",
  );
  release();
  release();
  const nextRelease = acquireProcessLock(path, "next worker");
  nextRelease();
});

test("the operating system releases signing ownership after SIGKILL", async () => {
  const path = lockPath();
  const { child, ready } = holder(path);
  expect(await ready).toBe("locked");
  expect(() => acquireProcessLock(path, "competitor")).toThrow(
    "execution lock",
  );
  child.kill("SIGKILL");
  await child.exited;
  const release = acquireProcessLock(path, "recovered worker");
  release();
});

test("two simultaneous recovery contenders cannot both own a prior lock", async () => {
  const path = lockPath();
  const first = holder(path);
  expect(await first.ready).toBe("locked");
  first.child.kill("SIGKILL");
  await first.child.exited;
  const contenders = [holder(path), holder(path)];
  const states = await Promise.all(contenders.map((item) => item.ready));
  expect(states.filter((state) => state === "locked")).toHaveLength(1);
  expect(states.filter((state) => state === "busy")).toHaveLength(1);
});
