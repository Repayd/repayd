import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER,
  DEMO_DEPLOYMENT_MARKER,
  DEMO_EVENT_MARKER,
  DEMO_RESULT_MARKER,
  DEMO_TX_MARKER,
  type DemoEvent,
  type DemoResult,
  type DemoRun,
  type DemoState,
  type RunPhase,
  type RunSummary,
  type RunTransaction,
  type StoredDemoEvent,
} from "../../demo/src/run-types.ts";
import type { DeploymentRecord } from "../../api/src/deployment.ts";
import { acquireProcessLock } from "../../demo/src/process-lock.ts";

const PHASES: RunPhase[] = [
  "preflight",
  "deploying",
  "payroll",
  "containment",
  "blocked",
  "recovery",
  "provenance",
  "complete",
];
const PROGRESS = [2, 10, 30, 48, 62, 74, 92, 98];
const CHECKS = [
  "payroll",
  "containment",
  "policy-block",
  "loss",
  "payout",
  "provenance",
] as const;
const ADDRESS = /^0x[\da-fA-F]{40}$/;
const HASH = /^0x[\da-fA-F]{64}$/;
const CONTRACTS = [
  "usdc",
  "policyRegistry",
  "blocklist",
  "verdicts",
  "mutualPool",
  "guardAccount",
] as const;
const EVENT_KINDS = new Set(["info", "ok", "warn", "bad", "payout", "title"]);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Run = Omit<Mutable<DemoRun>, "events" | "transactions" | "logTail"> & {
  events: StoredDemoEvent[];
  transactions: RunTransaction[];
  logTail: string[];
};
interface Manifest {
  version: 1;
  selectedRunId: string | null;
  ids: string[];
}

export class RunError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Disk-backed presentation state. A browser connection never owns a run. */
export class RunManager {
  readonly directory: string;
  private readonly runs = new Map<string, Run>();
  private readonly ids: string[] = [];
  private selectedRunId: string | null = null;
  private activeRunId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private child: Bun.Subprocess | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private readonly releaseOwnership: () => void;
  private readonly secrets: string[];
  private readonly timeoutMs: number;
  private readonly command?: string[];

  constructor(
    private readonly root: string,
    options: {
      directory?: string;
      command?: string[];
      timeoutMs?: number;
    } = {},
  ) {
    this.directory = options.directory ?? join(root, ".repayd");
    this.command = options.command;
    this.timeoutMs = options.timeoutMs ?? 12 * 60_000;
    mkdirSync(join(this.directory, "runs"), { recursive: true, mode: 0o700 });
    this.releaseOwnership = acquireProcessLock(
      join(this.directory, "manager.sqlite"),
      "dashboard manager",
    );
    this.secrets = this.secretValues();
    try {
      this.restore();
    } catch (error) {
      this.releaseOwnership();
      throw error;
    }
  }

  get(id: string): DemoRun | undefined {
    return this.runs.get(id);
  }

  state(id?: string): DemoState {
    if (id && !this.runs.has(id))
      throw new RunError(404, "This demo run was not found.");
    const selected = id ?? this.activeRunId ?? this.selectedRunId;
    return {
      activeRunId: this.activeRunId,
      selectedRunId: selected,
      run: selected ? this.runs.get(selected) ?? null : null,
      runs: this.ids.map((key) => this.summary(this.runs.get(key)!)),
      environment: {
        chainId: ARC_CHAIN_ID,
        network: "Arc testnet",
        explorerUrl: ARC_EXPLORER,
        token: "Demo USDC (mintable)",
        watcher: "Local demo signer (not a live TEE)",
      },
    };
  }

  start(): DemoRun {
    if (this.closed) throw new RunError(503, "The dashboard is shutting down.");
    if (this.activeRunId || this.child)
      throw new RunError(
        409,
        "A demo is already running. You can follow it from any page.",
      );
    const now = Date.now();
    const id = crypto.randomUUID();
    const run: Run = {
      id,
      label: `Run ${String(this.ids.length + 1).padStart(2, "0")}`,
      chainId: ARC_CHAIN_ID,
      status: "running",
      phase: "preflight",
      startedAt: now,
      updatedAt: now,
      heartbeatAt: now,
      progress: PROGRESS[0]!,
      events: [],
      transactions: [],
      logTail: [],
    };
    mkdirSync(join(this.directory, "runs", id), {
      recursive: true,
      mode: 0o700,
    });
    this.runs.set(id, run);
    this.ids.unshift(id);
    this.activeRunId = id;
    this.selectedRunId = id;
    this.persist(run);
    this.saveManifest();
    this.notify();
    // Acquiring the in-memory run lock above is synchronous, before spawning.
    void this.execute(run).catch((error: unknown) => this.fail(run, error));
    return run;
  }

  reset(): DemoState {
    if (this.activeRunId || this.child)
      throw new RunError(
        409,
        "A running demo cannot be reset. Let it finish; navigation is safe.",
      );
    this.selectedRunId = null;
    this.saveManifest();
    this.notify();
    return this.state();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by the server's signal handlers, never by an SSE disconnect. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    if (this.activeRunId) {
      const run = this.runs.get(this.activeRunId)!;
      this.fail(
        run,
        new Error(
          "Dashboard server stopped before verification finished. Start a fresh run to retry.",
        ),
        "interrupted",
      );
    }
    const child = this.child;
    if (child) {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1_500);
      await child.exited;
      clearTimeout(force);
    }
    this.releaseOwnership();
  }

  private async execute(run: Run): Promise<void> {
    const envFile = join(this.root, ".env");
    const cmd = this.command ?? [
      process.execPath,
      ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []),
      "run",
      join(this.root, "packages", "demo", "src", "demo.ts"),
    ];
    const child = Bun.spawn({
      cmd,
      cwd: this.root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ipc: (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "worker-ready" &&
          "runId" in message &&
          message.runId === run.id &&
          run.status === "running"
        ) {
          run.heartbeatAt = Date.now();
          this.persist(run);
          this.notify();
        }
      },
      env: {
        ...process.env,
        DEMO_CHAIN_ID: String(ARC_CHAIN_ID),
        DEMO_RPC_URL:
          process.env.ARC_DEMO_RPC_URL ?? "https://rpc.testnet.arc.io",
        DEMO_FRESH: "1",
        REPAYD_RUN_ID: run.id,
        REPAYD_RUN_DIR: join(this.directory, "runs", run.id),
        REPAYD_PARENT_PID: String(process.pid),
        REPAYD_DEMO_STEP_MS: process.env.REPAYD_DEMO_STEP_MS ?? "900",
        REPAYD_THEATER_INGEST: "",
        FORCE_COLOR: "0",
      },
    });
    this.child = child;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let streamFailure: unknown;
    this.timer = setInterval(() => {
      if (run.status !== "running") return;
      run.heartbeatAt = Date.now();
      this.persist(run);
      this.notify();
    }, 5_000);
    timeout = setTimeout(() => {
      this.fail(
        run,
        new Error(
          "The Arc run exceeded its execution deadline. Confirmed transactions are preserved; inspect Flow before starting a fresh run.",
        ),
      );
      child.kill("SIGTERM");
      const force = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1_500);
      force.unref();
    }, this.timeoutMs);
    const consume = (stream: ReadableStream<Uint8Array>, stdout: boolean) =>
      this.readLines(stream, (line) => {
        if (run.status !== "running") return;
        if (stdout && this.consumeMarker(run, line)) return;
        this.appendLog(run, line);
      }).catch((error: unknown) => {
        streamFailure ??= error;
        child.kill("SIGTERM");
      });
    try {
      const [, , exit] = await Promise.all([
        consume(child.stdout, true),
        consume(child.stderr, false),
        child.exited,
      ]);
      if (run.status !== "running") return;
      if (streamFailure) throw streamFailure;
      if (exit !== 0)
        throw new Error(
          `Demo process exited with code ${exit}. ${this.lastError(run)}`,
        );
      if (!run.result)
        throw new Error(
          "Demo exited without a verified result. Exit code 0 alone is not completion.",
        );
      this.assertResult(run, run.result);
      run.status = "completed";
      run.phase = "complete";
      run.progress = 100;
      run.endedAt = Date.now();
      run.updatedAt = run.endedAt;
      run.endBlock = run.result.endBlock;
      this.activeRunId = null;
      this.persist(run);
      this.saveManifest();
      this.notify();
    } finally {
      clearTimeout(timeout);
      clearInterval(this.timer);
      this.timer = undefined;
      this.child = null;
      if (this.activeRunId === run.id && run.status !== "running") {
        this.activeRunId = null;
        this.notify();
      }
    }
  }

  private consumeMarker(run: Run, line: string): boolean {
    if (line.startsWith(DEMO_EVENT_MARKER)) {
      const event = JSON.parse(
        line.slice(DEMO_EVENT_MARKER.length),
      ) as DemoEvent;
      if (
        !event ||
        typeof event.text !== "string" ||
        !EVENT_KINDS.has(event.kind) ||
        !Number.isFinite(event.t)
      ) {
        throw new Error("Demo emitted an invalid presentation event.");
      }
      if (event.txHash && !HASH.test(event.txHash))
        throw new Error("Demo event contains an invalid transaction hash.");
      run.events.push({
        ...event,
        seq: run.events.length + 1,
        emittedAt: Date.now(),
      });
      if (event.phase) this.advance(run, event.phase);
    } else if (line.startsWith(DEMO_TX_MARKER)) {
      const tx = JSON.parse(
        line.slice(DEMO_TX_MARKER.length),
      ) as RunTransaction;
      if (
        !tx ||
        !HASH.test(tx.hash) ||
        !Number.isSafeInteger(tx.blockNumber) ||
        tx.blockNumber < 0 ||
        !Number.isFinite(tx.timestamp) ||
        typeof tx.label !== "string" ||
        !PHASES.includes(tx.phase) ||
        !["success", "reverted"].includes(tx.status)
      )
        throw new Error("Demo emitted an invalid receipt record.");
      const existing = run.transactions.find(
        (item) => item.hash.toLowerCase() === tx.hash.toLowerCase(),
      );
      if (
        existing &&
        (existing.blockNumber !== tx.blockNumber ||
          existing.status !== tx.status)
      ) {
        throw new Error("Conflicting evidence for the same transaction.");
      }
      if (!existing) run.transactions.push(tx);
      run.startBlock = Math.min(
        run.startBlock ?? tx.blockNumber,
        tx.blockNumber,
      );
      run.endBlock = Math.max(run.endBlock ?? tx.blockNumber, tx.blockNumber);
      this.advance(run, tx.phase);
    } else if (line.startsWith(DEMO_DEPLOYMENT_MARKER)) {
      if (run.deployment)
        throw new Error(
          "Demo attempted to publish two deployments in one run.",
        );
      const value = JSON.parse(line.slice(DEMO_DEPLOYMENT_MARKER.length)) as {
        deployment: DeploymentRecord;
        startBlock: number;
      };
      const dep = value.deployment;
      if (
        dep?.chainId !== ARC_CHAIN_ID ||
        !CONTRACTS.every((key) => ADDRESS.test(dep.contracts?.[key] ?? "")) ||
        !dep.actors ||
        !ADDRESS.test(dep.actors.amaraPolicyOwner) ||
        !dep.seed?.mockUsdc ||
        !Number.isSafeInteger(value.startBlock)
      ) {
        throw new Error(
          "Demo deployment does not describe a confirmed Arc testnet demo-token stack.",
        );
      }
      run.deployment = dep;
      run.guard = dep.contracts.guardAccount;
      run.startBlock = Math.min(
        run.startBlock ?? value.startBlock,
        value.startBlock,
      );
      this.advance(run, "deploying");
    } else if (line.startsWith(DEMO_RESULT_MARKER)) {
      if (run.result)
        throw new Error("Demo emitted its terminal result more than once.");
      const result = JSON.parse(
        line.slice(DEMO_RESULT_MARKER.length),
      ) as DemoResult;
      this.assertResult(run, result);
      run.result = result;
      // Still running: the child's clean exit must follow its verified result.
    } else {
      return false;
    }
    run.updatedAt = Date.now();
    this.persist(run);
    this.notify();
    return true;
  }

  private assertResult(run: Run, result: DemoResult): void {
    const dep = run.deployment;
    if (
      !dep ||
      result?.version !== 1 ||
      result.verified !== true ||
      result.runId !== run.id ||
      result.chainId !== ARC_CHAIN_ID ||
      result.guard?.toLowerCase() !==
        dep.contracts.guardAccount.toLowerCase() ||
      result.usdc?.toLowerCase() !== dep.contracts.usdc.toLowerCase()
    )
      throw new Error(
        "Verified result is missing or belongs to a different deployment.",
      );
    if (
      !Array.isArray(result.checks) ||
      !CHECKS.every((name) =>
        result.checks.some(
          (check) => check.name === name && check.passed === true,
        ),
      ) ||
      result.checks.some((check) => check.passed !== true)
    )
      throw new Error("Not all required demo outcomes were verified.");
    if (
      !Number.isSafeInteger(result.startBlock) ||
      !Number.isSafeInteger(result.endBlock) ||
      result.endBlock < result.startBlock ||
      result.endBlock < (run.endBlock ?? 0)
    )
      throw new Error("Demo result has an inconsistent receipt window.");
    if (
      !Array.isArray(result.txHashes) ||
      result.txHashes.length !== run.transactions.length ||
      new Set(result.txHashes.map((hash) => hash.toLowerCase())).size !==
        run.transactions.length ||
      !run.transactions.every((tx) =>
        result.txHashes.some(
          (hash) => hash.toLowerCase() === tx.hash.toLowerCase(),
        ),
      )
    ) {
      throw new Error("Demo result omitted confirmed transaction evidence.");
    }
    for (const check of result.checks) {
      if (!check.txHash) continue;
      const tx = run.transactions.find(
        (item) => item.hash.toLowerCase() === check.txHash!.toLowerCase(),
      );
      if (!tx || (check.name !== "policy-block" && tx.status !== "success"))
        throw new Error(
          `No confirmed receipt supports the ${check.name} check.`,
        );
    }
    for (const name of [
      "payroll",
      "containment",
      "policy-block",
      "loss",
      "payout",
    ] as const) {
      if (!result.checks.find((check) => check.name === name)?.txHash)
        throw new Error(`The ${name} check has no transaction evidence.`);
    }
    if (
      !result.balances ||
      Object.values(result.balances).some(
        (value) => !Number.isFinite(value) || value < 0,
      ) ||
      !result.pool ||
      !Number.isFinite(result.pool.junior) ||
      !Number.isFinite(result.pool.senior)
    ) {
      throw new Error("Demo result has invalid balance evidence.");
    }
  }

  private advance(run: Run, phase: RunPhase): void {
    const next = PHASES.indexOf(phase);
    if (next < 0) throw new Error(`Unknown demo phase: ${phase}`);
    if (next >= PHASES.indexOf(run.phase)) {
      run.phase = phase;
      run.progress = PROGRESS[next]!;
    }
  }

  private fail(
    run: Run,
    error: unknown,
    status: "failed" | "interrupted" = "failed",
  ): void {
    if (run.status !== "running") return;
    run.status = status;
    run.error = this.redact(
      error instanceof Error ? error.message : String(error),
    );
    run.endedAt = Date.now();
    run.updatedAt = run.endedAt;
    if (this.activeRunId === run.id && !this.child) this.activeRunId = null;
    this.persist(run);
    this.saveManifest();
    this.notify();
  }

  private appendLog(run: Run, line: string): void {
    const text = this.redact(line.replace(/\x1b\[[0-9;]*m/g, "").trim());
    if (!text) return;
    run.logTail.push(text.slice(0, 1_200));
    if (run.logTail.length > 40) run.logTail.splice(0, run.logTail.length - 40);
  }

  private lastError(run: Run): string {
    for (let i = run.logTail.length - 1; i >= 0; i--) {
      const line = run.logTail[i]!;
      if (/DEMO FAILED|error:|Error:|insufficient|blocked address/i.test(line))
        return line;
    }
    return (
      run.logTail.at(-1) ??
      "Inspect the run's preserved logs and confirmed transactions."
    );
  }

  private async readLines(
    stream: ReadableStream<Uint8Array>,
    consume: (line: string) => void,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 2_000_000)
          throw new Error("Demo output exceeded the structured message limit.");
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          consume(pending.slice(0, newline).replace(/\r$/, ""));
          pending = pending.slice(newline + 1);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) consume(pending);
    } finally {
      reader.releaseLock();
    }
  }

  private persist(run: Run): void {
    this.atomic(join(this.directory, "runs", run.id, "run.json"), run);
  }
  private saveManifest(): void {
    this.atomic(join(this.directory, "state.json"), {
      version: 1,
      selectedRunId: this.selectedRunId,
      ids: this.ids,
    } satisfies Manifest);
  }
  private atomic(path: string, value: unknown): void {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, path);
  }

  private restore(): void {
    const file = join(this.directory, "state.json");
    if (!existsSync(file)) return;
    const state = JSON.parse(readFileSync(file, "utf8")) as Manifest;
    if (state.version !== 1 || !Array.isArray(state.ids))
      throw new Error(
        "Unsupported demo history format; existing history was not overwritten.",
      );
    for (const id of state.ids) {
      if (!/^[\da-f-]{36}$/i.test(id))
        throw new Error("Invalid run ID in stored demo history.");
      const run = JSON.parse(
        readFileSync(join(this.directory, "runs", id, "run.json"), "utf8"),
      ) as Run;
      if (
        run.id !== id ||
        !Array.isArray(run.events) ||
        !Array.isArray(run.transactions)
      )
        throw new Error(`Corrupt history for run ${id}.`);
      if (run.status === "running") {
        run.status = "interrupted";
        run.error =
          "The dashboard restarted before this run was verified. Confirmed transactions remain in Flow; start a fresh run to retry.";
        run.endedAt = Date.now();
        run.updatedAt = run.endedAt;
        this.persist(run);
      }
      this.ids.push(id);
      this.runs.set(id, run);
    }
    this.selectedRunId =
      state.selectedRunId && this.runs.has(state.selectedRunId)
        ? state.selectedRunId
        : null;
    this.saveManifest();
  }

  private secretValues(): string[] {
    const values = Object.entries(process.env)
      .filter(([name]) =>
        /PRIVATE_KEY|SECRET|TOKEN|SERVICE_KEY|OPERATOR_KEY/.test(name),
      )
      .map(([, value]) => value ?? "");
    const file = join(this.root, ".env");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const match = line.match(
          /^\s*(?:export\s+)?[A-Z\d_]*(?:PRIVATE_KEY|SECRET|TOKEN|SERVICE_KEY|OPERATOR_KEY)\s*=\s*["']?([^\s"'#]+)/,
        );
        if (match) values.push(match[1]!);
      }
    }
    return [...new Set(values.filter((value) => value.length >= 12))];
  }
  private redact(text: string): string {
    for (const secret of this.secrets)
      text = text.replaceAll(secret, "[redacted]");
    return text.slice(0, 4_000);
  }
  private summary(run: Run): RunSummary {
    const {
      id,
      label,
      chainId,
      status,
      phase,
      startedAt,
      endedAt,
      error,
      guard,
    } = run;
    return {
      id,
      label,
      chainId,
      status,
      phase,
      startedAt,
      endedAt,
      error,
      guard,
    };
  }
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a disconnected subscriber does not own execution */
      }
    }
  }
}
