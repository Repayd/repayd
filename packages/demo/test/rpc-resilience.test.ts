/**
 * RPC resilience for the demo runner.
 *
 * The demo previously built every client with `http(url, { retryCount: 0 })`,
 * so the first throttled call aborted a run that had already broadcast 19
 * transactions. Arc's public RPCs throttle bursts and answer with
 * provider-specific text — notably "Request exceeds defined limit" — which is
 * not a JSON-RPC code viem retries on its own.
 *
 * These tests pin the four properties the fix depends on, against a local fake
 * RPC (no testnet traffic):
 *
 *   1. A transient provider error is retried and the call still succeeds.
 *   2. A permanent error (a revert) fails immediately — no retry storm.
 *   3. Simultaneous distinct reads are capped at RPC_MAX_CONCURRENT.
 *   4. The cap is process-wide: separate transports share one budget.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicClient } from "viem";
import { anvil } from "viem/chains";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deferred, resilientTransport } from "../src/protocol.ts";

const CAP = 4;

let inFlight = 0;
let maxInFlight = 0;
let attempts = 0;
let failFirst = 0;
let failMessage = "Request exceeds defined limit";

// The fake server holds every request open until `release()` runs. A working
// concurrency gate therefore never shows more than CAP in flight at once,
// while an unbounded one shows all of them — no timers required.
let held = false;
const waiters: Array<() => void> = [];
let capReached = deferred<void>();

const release = (): void => {
  held = true;
  while (waiters.length) waiters.shift()?.();
};

/**
 * Yield to the event loop without a duration. Request delivery is a socket
 * round trip, so proving that a 5th request never arrives requires letting the
 * loop run — setImmediate, not a sleep.
 */
const tick = async (): Promise<void> => {
  const t = deferred<void>();
  setImmediate(() => t.resolve());
  await t.promise;
};

const server: Server = createServer(async (req, res) => {
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  attempts += 1;
  if (inFlight === CAP) capReached.resolve();
  try {
    if (!held) {
      const blocker = deferred<void>();
      waiters.push(blocker.resolve);
      await blocker.promise;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
    };
    const id = body.id ?? 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        attempts <= failFirst
          ? { jsonrpc: "2.0", id, error: { code: -32602, message: failMessage } }
          : { jsonrpc: "2.0", id, result: "0x64" },
      ),
    );
  } finally {
    inFlight -= 1;
  }
});

const listening = deferred<void>();
server.listen(0, "127.0.0.1", () => listening.resolve());
await listening.promise;
const { port } = server.address() as AddressInfo;

const url = (): string => `http://127.0.0.1:${port}`;
const client = () =>
  createPublicClient({ chain: anvil, transport: resilientTransport(url()) });
const address = (i: number) => `0x${i.toString(16).padStart(40, "0")}` as const;

beforeEach(() => {
  attempts = 0;
  failFirst = 0;
  failMessage = "Request exceeds defined limit";
  inFlight = 0;
  maxInFlight = 0;
  held = true; // retry tests must not block on the hold
  waiters.length = 0;
  capReached = deferred<void>();
});

afterAll(() => {
  release();
  server.close();
});

describe("resilient RPC transport", () => {
  it("retries a throttled call instead of failing the run", async () => {
    failFirst = 2;
    const balance = await client().getBalance({ address: address(1) });
    expect(balance).toBe(100n);
    expect(attempts).toBe(3);
  });

  it("does not retry a permanent failure", async () => {
    failFirst = 99;
    failMessage = "execution reverted";
    await expect(client().getBalance({ address: address(2) })).rejects.toThrow(
      /reverted/,
    );
    expect(attempts).toBe(1);
  });

  it("caps simultaneous requests at the concurrency limit", async () => {
    held = false;
    const c = client();
    const all = Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        c.getBalance({ address: address(i + 3) }),
      ),
    );
    await capReached.promise;
    // Let the loop drain: with no gate the remaining 8 requests land here.
    for (let i = 0; i < 8; i += 1) await tick();
    expect(maxInFlight).toBe(CAP);
    release();
    await expect(all).resolves.toHaveLength(12);
    expect(maxInFlight).toBe(CAP);
  });

  it("shares one request budget across separate transports", async () => {
    held = false;
    const clients = Array.from({ length: 6 }, () => client());
    const all = Promise.all(
      clients.map((c, i) => c.getBalance({ address: address(i + 100) })),
    );
    await capReached.promise;
    for (let i = 0; i < 8; i += 1) await tick();
    expect(maxInFlight).toBe(CAP);
    release();
    await expect(all).resolves.toHaveLength(6);
    expect(maxInFlight).toBe(CAP);
  });
});
