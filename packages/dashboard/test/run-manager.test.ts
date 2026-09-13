import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunError, RunManager } from "../src/run-manager.ts";
import type { DemoState } from "../../demo/src/run-types.ts";

const roots: string[] = [];
const managers: RunManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(source: string, env?: string) {
  const root = mkdtempSync(join(tmpdir(), "repayd-run-test-"));
  roots.push(root);
  const worker = join(root, "worker.ts");
  writeFileSync(worker, source);
  if (env) writeFileSync(join(root, ".env"), env);
  const manager = new RunManager(root, {
    command: [process.execPath, worker],
    timeoutMs: 5_000,
  });
  managers.push(manager);
  return { root, manager };
}
function settled(manager: RunManager): Promise<DemoState> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const check = () => {
      const state = manager.state();
      if (state.activeRunId || state.run?.status === "running") return;
      unsubscribe();
      resolve(state);
    };
    unsubscribe = manager.subscribe(check);
    check();
  });
}

const successful = `
const id = process.env.REPAYD_RUN_ID;
const address = (n) => '0x' + n.toString(16).padStart(40, '0');
const hash = (n) => '0x' + n.toString(16).padStart(64, '0');
const emit = (type, value) => console.log('@@DEMO_' + type + '@' + JSON.stringify(value));
const contracts = { usdc:address(1), policyRegistry:address(2), blocklist:address(3), verdicts:address(4), mutualPool:address(5), guardAccount:address(6) };
const deployment = {chainId:5042002,contracts,actors:{amaraPolicyOwner:address(7)},seed:{mockUsdc:true}};
emit('DEPLOYMENT', {deployment,startBlock:10});
const names = ['payroll','containment','policy-block','loss','payout'];
const phases = ['payroll','containment','blocked','recovery','recovery'];
for (let i=0; i<names.length; i++) emit('TX',{hash:hash(i+1),label:names[i],phase:phases[i],blockNumber:11+i,timestamp:1789262000+i,status:i===2?'reverted':'success'});
emit('EVENT',{t:1,kind:'ok',tag:'PAYROLL',text:'Receipt verified',phase:'payroll',source:'chain',txHash:hash(1),verified:true});
const result = {version:1,verified:true,runId:id,chainId:5042002,guard:contracts.guardAccount,usdc:contracts.usdc,
checks:[...names.map((name,i)=>({name,passed:true,detail:name,txHash:hash(i+1)})),{name:'provenance',passed:true,detail:'Local signed instruction'}],
balances:{GuardAccount:3050,Amara:135,'0xA1ice':150},pool:{junior:19865,senior:25000},txHashes:names.map((_,i)=>hash(i+1)),startBlock:10,endBlock:15};
`;

describe("durable demo lifecycle", () => {
  test("exit zero without verified evidence is a failed run", async () => {
    const { manager } = fixture(
      "console.log('child stopped before the final proof');",
    );
    manager.start();
    const state = await settled(manager);
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toContain("Exit code 0 alone is not completion");
  });

  test("only complete verified outcomes plus clean process exit finish a run", async () => {
    const { manager } = fixture(successful + "emit('RESULT',result);");
    manager.start();
    const state = await settled(manager);
    expect(state.run?.status).toBe("completed");
    expect(state.run?.progress).toBe(100);
    expect(state.run?.transactions).toHaveLength(5);
    expect(state.run?.events[0]?.seq).toBe(1);
    expect(state.run?.result?.checks).toHaveLength(6);
  });

  test("a late process error cannot be overwritten by a success marker", async () => {
    const { manager } = fixture(
      successful + "emit('RESULT',result); process.exitCode=7;",
    );
    manager.start();
    const state = await settled(manager);
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toContain("code 7");
    expect(state.run?.transactions).toHaveLength(5);
  });

  test("cross-run evidence is rejected instead of completing the active run", async () => {
    const { manager } = fixture(
      successful + "emit('RESULT',{...result,runId:'another-run'});",
    );
    manager.start();
    const state = await settled(manager);
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toContain("different deployment");
  });

  test("disconnecting subscribers never stops execution, and start/reset are locked", async () => {
    const { manager } = fixture(successful + "emit('RESULT',result);");
    const run = manager.start();
    const unsubscribe = manager.subscribe(() => {});
    unsubscribe();
    expect(() => manager.start()).toThrow(RunError);
    expect(() => manager.reset()).toThrow(RunError);
    const state = await settled(manager);
    expect(state.run?.id).toBe(run.id);
    expect(state.run?.status).toBe("completed");
  });

  test("history survives restart, reset, and a subsequent independent run", async () => {
    const { root, manager } = fixture(successful + "emit('RESULT',result);");
    const original = manager.start();
    await settled(manager);
    await manager.close();
    const restored = new RunManager(root, {
      command: [process.execPath, join(root, "worker.ts")],
      timeoutMs: 5_000,
    });
    managers.push(restored);
    expect(restored.state().run?.id).toBe(original.id);
    expect(restored.state().run?.events).toHaveLength(1);
    expect(restored.reset().run).toBeNull();
    expect(restored.state(original.id).run?.transactions).toHaveLength(5);
    const next = restored.start();
    expect(next.id).not.toBe(original.id);
    const state = await settled(restored);
    expect(state.run?.status).toBe("completed");
    expect(state.runs).toHaveLength(2);
    expect(state.runs[1]?.id).toBe(original.id);
  });

  test("server shutdown preserves an interrupted run rather than marking success", async () => {
    const { root, manager } = fixture("await new Promise(() => {});");
    const run = manager.start();
    await manager.close();
    const saved = JSON.parse(
      readFileSync(join(root, ".repayd", "runs", run.id, "run.json"), "utf8"),
    );
    expect(saved.status).toBe("interrupted");
    expect(saved.error).toContain("stopped before verification");
    expect(saved.result).toBeUndefined();
  });

  test("missing receipts or failed checks cannot produce a completed run", async () => {
    const { manager } = fixture(
      successful +
        "emit('RESULT',{...result,txHashes:result.txHashes.slice(1)});",
    );
    manager.start();
    const state = await settled(manager);
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toContain("omitted confirmed transaction");
  });

  test("secrets from environment never appear in saved failure logs", async () => {
    const key = "test-secret-that-must-never-reach-the-dashboard";
    const { root, manager } = fixture(
      `console.error('Error: ${key}');process.exitCode=1;`,
      `AMARA_PRIVATE_KEY=${key}\n`,
    );
    const run = manager.start();
    const state = await settled(manager);
    expect(state.run?.error).toContain("[redacted]");
    expect(
      readFileSync(join(root, ".repayd", "runs", run.id, "run.json"), "utf8"),
    ).not.toContain(key);
  });
});
