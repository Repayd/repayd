import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadDeployment,
  type DeploymentRecord,
} from "@repayd/api/src/deployment.ts";
import { Repayd, type ChainEntry } from "@repayd/agent-sdk";
import {
  Alibi,
  Outcome,
  judgeBreach,
  judgeHold,
  type BehavioralFacts,
  type InstructionRecord,
} from "@repayd/engine";
import {
  GUARD_ACCOUNT as GUARD,
  MUTUAL_POOL as POOL,
  VERDICT_CONTRACT as VERDICTS,
} from "./protocol.ts";
import {
  ALICE,
  BOB,
  FRESH_WALLET,
  ATTACKER,
  attachProtocol,
  clients,
  confirmedReceipt,
  DEMO_CHAIN_ID,
  deployProtocol,
  requiredKey,
  submitCoveredVerdict,
  submitHoldVerdict,
  type Protocol,
  type ProtocolClients,
} from "./protocol.ts";
import {
  endDemo,
  getTransactions,
  publish,
  publishDeployment,
  publishResult,
  startDemo,
} from "./bus.ts";
import {
  deploymentAccounts,
  deploymentRecord,
  persistDeployment,
  preflight,
} from "./demo-setup.ts";
import {
  isPerTxViolation,
  receiptEvent,
  requireEvidence,
  requireTransfer,
} from "./evidence.ts";
import type { DemoCheck, DemoEvent, RunPhase } from "./run-types.ts";
import type { DeployAccounts } from "./protocol.ts";
import { acquireDemoWorkerLock, requireDemoParent } from "./worker-lock.ts";

export const LOOKALIKE = `${ALICE.slice(0, -1)}1` as Address;
const units = (amount: string) => parseUnits(amount, 6);
const num6 = (amount: bigint) => Number(formatUnits(amount, 6));
const sameAddress = (left: unknown, right: Address) =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase();

interface Snapshot {
  blockNumber: bigint;
  raw: Record<string, bigint>;
  balances: Record<string, number>;
  junior: bigint;
  senior: bigint;
  pool: { junior: number; senior: number };
  daily: readonly [bigint, bigint, bigint];
  spendable: bigint;
  poolBalance: bigint;
}

async function snapshot(
  c: ProtocolClients,
  p: Protocol,
  blockNumber: bigint,
): Promise<Snapshot> {
  const wallets: Record<string, Address> = {
    GuardAccount: p.guard.address,
    Amara: p.policy.owner,
    "0xFresh": FRESH_WALLET,
    Attacker: ATTACKER,
    "0xA1ice": LOOKALIKE,
    Alice: ALICE,
    Bob: BOB,
  };
  // Read sequentially: the public Arc RPCs reject a concurrent burst from a
  // single caller ("Request exceeds defined limit"), which the fan-out below
  // triggered on every deployed run.
  const entries: Array<readonly [string, bigint]> = [];
  for (const [label, address] of Object.entries(wallets)) {
    entries.push([
      label,
      await c.public.readContract({
        address: p.usdc.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      }),
    ] as const);
  }
  const junior = (await p.pool.read.juniorCapital!(
    [],
    { blockNumber },
  )) as bigint;
  const senior = (await p.pool.read.seniorCapital!(
    [],
    { blockNumber },
  )) as bigint;
  const daily = (await p.guard.read.dailyState!([], {
    blockNumber,
  })) as readonly [bigint, bigint, bigint];
  const spendable = (await p.guard.read.spendableUsdc!([], {
    blockNumber,
  })) as bigint;
  const poolBalance = await c.public.readContract({
    address: p.usdc.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [p.pool.address],
    blockNumber,
  });
  return {
    blockNumber,
    raw: Object.fromEntries(entries),
    balances: Object.fromEntries(
      entries.map(([label, value]) => [label, num6(value)]),
    ),
    junior,
    senior,
    pool: { junior: num6(junior), senior: num6(senior) },
    daily,
    spendable,
    poolBalance,
  };
}

function unchanged(before: Snapshot, after: Snapshot): void {
  for (const label of Object.keys(before.raw))
    requireEvidence(
      before.raw[label] === after.raw[label],
      `${label} balance must not change`,
    );
  requireEvidence(
    before.junior === after.junior &&
      before.senior === after.senior &&
      before.poolBalance === after.poolBalance,
    "pool capital and token balance must not change",
  );
  requireEvidence(
    before.daily[0] === after.daily[0] &&
      before.daily[1] === after.daily[1] &&
      before.daily[2] === after.daily[2],
    "daily counters must not change (a UTC-day boundary requires a new run)",
  );
}

function transferDelta(
  before: Snapshot,
  after: Snapshot,
  label: string,
  amount: bigint,
): void {
  requireEvidence(
    after.raw[label]! - before.raw[label]! === amount,
    `${label} must receive ${amount} token units`,
  );
  requireEvidence(
    before.raw.GuardAccount! - after.raw.GuardAccount! === amount,
    "guard debit must equal recipient credit",
  );
  requireEvidence(
    before.daily[0] === after.daily[0] &&
      after.daily[1] - before.daily[1] === amount &&
      after.daily[2] - before.daily[2] === 1n,
    "exact daily amount/count delta (do not run across UTC midnight)",
  );
}

async function holdState(
  p: Protocol,
  holdId: bigint,
  expected: number,
  blockNumber: bigint,
): Promise<void> {
  const hold = (await p.guard.read.holds!([holdId], {
    blockNumber,
  })) as readonly [Address, bigint, bigint, bigint, bigint, number];
  requireEvidence(
    Number(hold[5]) === expected,
    `hold ${holdId} status must be ${expected}, got ${hold[5]}`,
  );
}

function heldId(receipt: TransactionReceipt, p: Protocol, to: Address): bigint {
  const held = receiptEvent(receipt, p.guard.address, GUARD.abi, "Held");
  requireEvidence(
    sameAddress(held.to, to) &&
      held.amount === units("150") &&
      typeof held.holdId === "bigint",
    "held event must name the actual recipient and amount",
  );
  return held.holdId;
}

function instruction(
  entry: ChainEntry,
  ownerSigned: boolean,
): InstructionRecord {
  return {
    digest: entry.digest,
    origin: entry.origin,
    ownerSigned,
    timestamp: entry.timestamp,
    teeCosigned: entry.teeCosigned,
    prev: entry.prev,
  };
}

async function verifySetup(
  c: ProtocolClients,
  p: Protocol,
  dep: DeploymentRecord,
  initial: Snapshot,
): Promise<void> {
  const read = { blockNumber: initial.blockNumber };
  // Sequential for the same reason as snapshot(): concurrent reads trip the
  // public Arc RPC request cap.
  const owner = await p.guard.read.OWNER!([], read);
  const agent = await p.guard.read.agentKey!([], read);
  const watcher = await p.verdicts.read.watcher!([], read);
  const guardVerdicts = await p.guard.read.verdictContract!([], read);
  const poolVerdicts = await p.pool.read.verdictContract!([], read);
  const verdictPool = await p.verdicts.read.pool!([], read);
  const authority = await p.guard.read.authorityRevoked!([], read);
  const nextHoldId = await p.guard.read.nextHoldId!([], read);
  requireEvidence(
    sameAddress(owner, c.amara.account!.address) &&
      sameAddress(agent, c.agent.account!.address) &&
      sameAddress(watcher, c.watcher.account!.address),
    "deployed owner, agent and watcher must match the configured role keys",
  );
  requireEvidence(
    sameAddress(guardVerdicts, p.verdicts.address) &&
      sameAddress(poolVerdicts, p.verdicts.address) &&
      sameAddress(verdictPool, p.pool.address) &&
      authority === false,
    "guard, pool and verdict wiring must be live",
  );
  requireEvidence(
    dep.seed.mockUsdc,
    "this scripted run only spends the mintable demo token",
  );
  const policy = p.policy;
  requireEvidence(
    policy.perTxLimit === units("200") &&
      policy.dailyLimit === units("1000") &&
      policy.velocityLimit === 5 &&
      policy.coverageCap === units("2500") &&
      policy.deductibleBps === 1000 &&
      policy.holdWindowSec === 120 &&
      policy.sdkInstalled,
    "installed policy must match the demo's stated terms",
  );
  requireEvidence(
    policy.curfewStartMinute === 1440 && policy.curfewEndMinute === 1440,
    "demo policy must have no on-chain curfew",
  );
  requireEvidence(
    policy.allowlist.length === 2 &&
      policy.allowlist.some(
        (entry) =>
          sameAddress(entry.recipient, ALICE) && entry.cap === units("200"),
      ) &&
      policy.allowlist.some(
        (entry) =>
          sameAddress(entry.recipient, BOB) && entry.cap === units("400"),
      ),
    "only Alice and Bob may be allowlisted",
  );
  requireEvidence(
    initial.raw.GuardAccount === units("4000") &&
      initial.junior === units("20000") &&
      initial.senior === units("25000") &&
      initial.poolBalance === units("45000"),
    "requires pristine funded stack; use DEMO_FRESH=1 to repeat",
  );
  for (const [label, balance] of Object.entries(initial.raw))
    if (label !== "GuardAccount")
      requireEvidence(
        balance === 0n,
        `${label} must start with zero demo tokens; use DEMO_FRESH=1 to repeat`,
      );
  requireEvidence(
    initial.spendable === initial.raw.GuardAccount &&
      initial.daily[1] === 0n &&
      initial.daily[2] === 0n,
    "initial guard must have no pending holds or daily spend",
  );
  requireEvidence(
    nextHoldId === 1n,
    "attach mode requires an unused hold history; use DEMO_FRESH=1 to repeat",
  );
}

/** One finite, server-independent run. Importing this module never executes it. */
export async function main(
  runId = process.env.REPAYD_RUN_ID ?? randomUUID(),
): Promise<void> {
  startDemo();
  const started = Date.now();
  const fresh = process.env.DEMO_FRESH === "1";
  requireEvidence(
    !process.env.REPAYD_RUN_ID || !fresh || process.env.REPAYD_RUN_DIR,
    "managed fresh run requires REPAYD_RUN_DIR",
  );
  const stepMs = Number(process.env.REPAYD_DEMO_STEP_MS ?? 900);
  requireEvidence(
    Number.isFinite(stepMs) && stepMs >= 0 && stepMs <= 10_000,
    "REPAYD_DEMO_STEP_MS must be between 0 and 10000",
  );
  const beat = async (
    event: Omit<DemoEvent, "t">,
    state?: Snapshot,
    receipt?: TransactionReceipt,
  ) => {
    publish({
      ...event,
      t: (Date.now() - started) / 1000,
      ...(state
        ? {
            blockNumber: Number(state.blockNumber),
            viz: { ...event.viz, balances: state.balances, pool: state.pool },
          }
        : {}),
      ...(receipt
        ? {
            txHash: receipt.transactionHash,
            blockNumber: Number(receipt.blockNumber),
          }
        : {}),
    });
    if (stepMs > 0) await sleep(stepMs);
  };
  await beat({
    kind: "title",
    phase: "preflight",
    source: "system",
    title: "A real testnet run",
    text: "Existing actor keys · mintable demo USDC · confirmed transactions",
    why: "This is a scripted demonstration. Watcher signatures and SDK evidence are local, not a live TEE. Behavioral histories and instruction scenarios are supplied demo inputs, not live reputation or external attacks.",
  });
  const amaraKey = requiredKey("AMARA_PRIVATE_KEY");
  const nunoKey = requiredKey("NUNO_PRIVATE_KEY");
  const c = clients();
  const accounts = fresh
    ? deploymentAccounts()
    : { amara: privateKeyToAccount(amaraKey) };
  let dep = fresh ? undefined : await loadDeployment(DEMO_CHAIN_ID);
  if (dep)
    requireEvidence(
      dep.seed.mockUsdc,
      "attach mode refuses real USDC for scripted scenarios",
    );
  await preflight(c, accounts, fresh);
  await beat({
    kind: "ok",
    phase: "preflight",
    source: "chain",
    verified: true,
    text: `Chain ${DEMO_CHAIN_ID} checked; existing transaction-signing roles have native gas`,
    why: "Amara reserves deployment gas before conservative one-time role top-ups. No generated or externally funded identities are used.",
  });
  let p: Protocol;
  if (fresh) {
    await beat({
      kind: "title",
      phase: "deploying",
      source: "system",
      title: "A fresh isolated stack",
      text: "Deploying six contracts, wiring authority, seeding capital, attaching policy",
    });
    const deployed = await deployProtocol(c, accounts as DeployAccounts);
    dep = deploymentRecord(deployed, accounts as DeployAccounts, c);
    p = await attachProtocol(c, dep);
  } else {
    p = await attachProtocol(c, dep!);
  }
  const initial = await snapshot(
    c,
    p,
    await c.public.getBlockNumber({ cacheTime: 0 }),
  );
  await verifySetup(c, p, dep!, initial);
  const startBlock =
    getTransactions()[0]?.blockNumber ?? Number(initial.blockNumber);
  if (fresh) await persistDeployment(dep!, runId);
  publishDeployment(dep!, startBlock);
  await beat(
    {
      kind: "ok",
      tag: "POLICY",
      phase: "deploying",
      source: "chain",
      verified: true,
      text: "Installed policy: 200 per transfer · Bob sub-cap 400 · daily 1,000 · 5 transfers/day",
      why: "All amounts are mintable demo USDC. Coverage cap 2,500; deductible 10%; hold window 120 seconds. Alice and Bob alone are allowlisted. Guard backing 4,000; junior capital 20,000; senior capital 25,000. These values and role wiring were read back after confirmed setup. No ENS, World ID or ERC-8004 registration is performed.",
    },
    initial,
  );
  const checks: DemoCheck[] = [];
  const propose = async (
    to: Address,
    amount: string,
    label: string,
    phase: RunPhase,
  ) => {
    const hash = await c.agent.writeContract({
      address: p.guard.address,
      abi: GUARD.abi,
      functionName: "propose",
      args: [p.usdc.address, to, units(amount)],
      account: c.agent.account,
      chain: c.agent.chain,
    });
    return confirmedReceipt(c.public, hash, label, phase);
  };

  const payroll = [
    { to: ALICE, label: "Alice", amount: "180" },
    { to: BOB, label: "Bob", amount: "310" },
    { to: ALICE, label: "Alice", amount: "90" },
    { to: BOB, label: "Bob", amount: "220" },
  ] as const;
  let current = initial;
  let payrollReceipt: TransactionReceipt | undefined;
  for (const [index, payment] of payroll.entries()) {
    const receipt = await propose(
      payment.to,
      payment.amount,
      `Payroll ${index + 1} · ${payment.label} ${payment.amount}`,
      "payroll",
    );
    receiptEvent(receipt, p.guard.address, GUARD.abi, "ExecutedRoutine");
    requireTransfer(
      receipt,
      p.usdc.address,
      p.guard.address,
      payment.to,
      units(payment.amount),
      erc20Abi,
    );
    const after = await snapshot(c, p, receipt.blockNumber);
    transferDelta(current, after, payment.label, units(payment.amount));
    await beat(
      {
        kind: "ok",
        tag: "PAYROLL",
        phase: "payroll",
        source: "chain",
        verified: true,
        text: `Payroll ${index + 1}/4: ${payment.amount} → ${
          payment.label
        }, confirmed`,
        why: "Allowlisted recipient, applicable per-recipient cap, daily limit and velocity all pass. Token Transfer log, recipient credit, guard debit and daily counters agree.",
        viz: {
          tx: {
            lane: "routine",
            from: "GuardAccount",
            to: payment.label,
            amount: Number(payment.amount),
          },
          flash: "routine",
        },
      },
      after,
      receipt,
    );
    current = after;
    payrollReceipt = receipt;
  }
  requireEvidence(
    current.daily[1] === units("800") &&
      current.daily[2] === 4n &&
      current.raw.Alice === units("270") &&
      current.raw.Bob === units("530"),
    "four payrolls must total 800",
  );
  checks.push({
    name: "payroll",
    passed: true,
    detail:
      "Four actual payroll transfers total 800; Alice 270, Bob 530; daily count 4.",
    txHash: payrollReceipt!.transactionHash,
  });

  const sdk = new Repayd({
    agentName: "Atlas local demo",
    sessionKey: amaraKey,
  });
  await sdk.commit("DEMO web instruction: pay a fresh destination 150", {
    origin: "web",
  });
  const held = await propose(
    FRESH_WALLET,
    "150",
    "Fresh destination held · 150",
    "containment",
  );
  const freshHold = heldId(held, p, FRESH_WALLET);
  let after = await snapshot(c, p, held.blockNumber);
  unchanged(current, after);
  requireEvidence(
    after.spendable === after.raw.GuardAccount! - units("150"),
    "fresh hold must lock 150 without transferring",
  );
  await holdState(p, freshHold, 0, held.blockNumber);
  await beat(
    {
      kind: "warn",
      tag: "HELD",
      phase: "containment",
      source: "chain",
      verified: true,
      text: "Fresh destination: 150 held, zero tokens transferred",
      why: "The destination is not allowlisted. The hold ID comes from this receipt's Held log; no guessed nextHoldId and no successful-proposal-as-payment assumption.",
      viz: {
        tx: {
          lane: "elevated",
          from: "GuardAccount",
          to: "0xFresh",
          amount: 150,
        },
        flash: "elevated",
      },
    },
    after,
    held,
  );
  const holdTimestamp = Number(
    (await c.public.getBlock({ blockNumber: held.blockNumber })).timestamp,
  );
  const dayStart = holdTimestamp - (holdTimestamp % 86_400);
  const facts: BehavioralFacts = {
    recipientFirstSeen: null,
    recipientOnBlocklistStrikes: 0,
    knownDrainerCalldata: false,
    hourOfDayHistory: [9, 10, 11, 12, 13, 14, 15, 16, 17],
    amountHistory: payroll.map((payment) => units(payment.amount)),
  };
  const suspicious = judgeHold(
    p.policy,
    {
      to: FRESH_WALLET,
      amount: units("150"),
      txHash: held.transactionHash,
      blockTimestamp: dayStart + 4 * 3600,
      calldata: "0x",
    },
    facts,
  );
  requireEvidence(
    suspicious.holdAction === "FREEZE",
    "supplied suspicious demo facts must yield FREEZE",
  );
  await beat({
    kind: "warn",
    tag: "LOCAL WATCHER",
    phase: "containment",
    source: "local",
    verified: true,
    text: "Simulated 04:00 context + supplied history → FREEZE",
    why: `Deterministic local evaluation, not live chain time or a TEE: ${suspicious.reasons
      .map((reason) => reason.tag)
      .join(", ")}. These behavioral inputs are explicitly simulated.`,
  });
  const frozen = await submitHoldVerdict(p, c, freshHold, 1);
  await holdState(p, freshHold, 2, frozen.blockNumber);
  const freezeState = await snapshot(c, p, frozen.blockNumber);
  unchanged(current, freezeState);
  requireEvidence(
    freezeState.spendable === freezeState.raw.GuardAccount,
    "watcher freeze must remove the pending lock",
  );
  await beat(
    {
      kind: "ok",
      tag: "FROZEN",
      phase: "containment",
      source: "chain",
      verified: true,
      text: "Local watcher signature accepted; hold is frozen",
      why: "A confirmed VerdictContract transaction changed the guard's hold to FROZEN. The signer is the configured local demo watcher key.",
    },
    freezeState,
    frozen,
  );
  const decisionHash = await c.amara.writeContract({
    address: p.guard.address,
    abi: GUARD.abi,
    functionName: "decide",
    args: [freshHold, 1],
    account: c.amara.account,
    chain: c.amara.chain,
  });
  const decision = await confirmedReceipt(
    c.public,
    decisionHash,
    "Scripted owner FREEZE decision",
    "containment",
  );
  await holdState(p, freshHold, 4, decision.blockNumber);
  after = await snapshot(c, p, decision.blockNumber);
  unchanged(current, after);
  requireEvidence(
    after.raw["0xFresh"] === 0n && after.spendable === after.raw.GuardAccount,
    "containment must leave no loss or pending lock",
  );
  await beat(
    {
      kind: "ok",
      tag: "CONTAINED",
      phase: "containment",
      source: "chain",
      verified: true,
      text: "Scripted owner FREEZE confirmed; fresh destination received 0",
      why: "The script uses Amara's existing owner key to cancel the frozen hold. There is no live phone notification or human tap in this demo.",
    },
    after,
    decision,
  );
  checks.push({
    name: "containment",
    passed: true,
    detail:
      "Fresh 150 proposal held, watcher froze, scripted owner cancelled; balances unchanged and hold resolved.",
    txHash: decision.transactionHash,
  });
  current = after;

  const violationCall = {
    address: p.guard.address,
    abi: GUARD.abi,
    functionName: "propose",
    args: [p.usdc.address, ATTACKER, units("900")],
    account: c.agent.account!.address,
  } as const;
  let correctRevert = false;
  try {
    await c.public.simulateContract(violationCall);
  } catch (error) {
    if (!isPerTxViolation(error)) throw error;
    correctRevert = true;
  }
  requireEvidence(
    correctRevert,
    "900 proposal simulation must decode Violation(OVER_PER_TX)",
  );
  const violationHash = await c.agent.writeContract({
    ...violationCall,
    account: c.agent.account,
    chain: c.agent.chain,
    gas: 300_000n,
  });
  const blocked = await confirmedReceipt(
    c.public,
    violationHash,
    "Policy block · 900 over per-transfer cap",
    "blocked",
    "reverted",
  );
  after = await snapshot(c, p, blocked.blockNumber);
  unchanged(current, after);
  requireEvidence(
    blocked.logs.length === 0 && after.spendable === current.spendable,
    "reverted attempt must leave no logs or balance effect",
  );
  await beat(
    {
      kind: "ok",
      tag: "POLICY BLOCK",
      phase: "blocked",
      source: "chain",
      verified: true,
      text: "900 transfer broadcast and mined REVERTED; no tokens moved",
      why: "Simulation decoded the exact Violation(OVER_PER_TX) custom error. Explicit gas allowed broadcasting the real reverting transaction. Network failures are not policy decisions; reverted contract logs do not persist.",
      viz: {
        tx: {
          lane: "violation",
          from: "GuardAccount",
          to: "Attacker",
          amount: 900,
        },
        flash: "violation",
      },
    },
    after,
    blocked,
  );
  checks.push({
    name: "policy-block",
    passed: true,
    detail:
      "Exact per-transfer Violation decoded; mined reverted receipt; all balances, pool and daily counters unchanged.",
    txHash: blocked.transactionHash,
  });
  current = after;

  const lookEntry = await sdk.commit(
    "DEMO poisoned payroll: pay lookalike destination 150",
    { origin: "web" },
  );
  const lookAlibi = sdk.alibiFor(lookEntry.digest);
  requireEvidence(
    lookAlibi.found &&
      !lookAlibi.ownerSigned &&
      !lookEntry.teeCosigned &&
      sdk.verifyChain(),
    "local external instruction chain must be intact and honestly uncosigned",
  );
  const lookHeld = await propose(
    LOOKALIKE,
    "150",
    "Lookalike destination held · 150",
    "recovery",
  );
  const lookHold = heldId(lookHeld, p, LOOKALIKE);
  after = await snapshot(c, p, lookHeld.blockNumber);
  unchanged(current, after);
  await holdState(p, lookHold, 0, lookHeld.blockNumber);
  requireEvidence(
    after.spendable === after.raw.GuardAccount! - units("150"),
    "lookalike must first be held, not paid",
  );
  await beat(
    {
      kind: "warn",
      tag: "LOOKALIKE HELD",
      phase: "recovery",
      source: "chain",
      verified: true,
      text: "Lookalike is not allowlisted: 150 held, not paid",
      why: "The address differs from Alice by one hex character. The guard correctly treats it as unknown. This demo does not weaken the classifier or pretend a successful proposal receipt means funds left.",
    },
    after,
    lookHeld,
  );
  const normalHour = dayStart + 12 * 3600;
  const benignFacts: BehavioralFacts = {
    ...facts,
    recipientFirstSeen: normalHour - 30 * 86_400,
  };
  const clean = judgeHold(
    p.policy,
    {
      to: LOOKALIKE,
      amount: units("150"),
      txHash: lookHeld.transactionHash,
      blockTimestamp: normalHour,
      calldata: "0x",
    },
    benignFacts,
  );
  requireEvidence(
    clean.holdAction === "RELEASE",
    "controlled false-negative inputs must evaluate below the freeze threshold",
  );
  await beat({
    kind: "warn",
    tag: "CONTROLLED FALSE NEGATIVE",
    phase: "recovery",
    source: "local",
    verified: true,
    text: "Supplied benign history + simulated noon → watcher RELEASE",
    why: "This is a deliberately controlled watcher false negative to demonstrate residual insured loss. The claimed 30-day recipient history is a supplied fixture, not a live oracle fact. The local signer accepts that evaluation; the guard's unknown-recipient rule remains unchanged.",
  });
  const released = await submitHoldVerdict(p, c, lookHold, 0);
  const releasedLog = receiptEvent(
    released,
    p.guard.address,
    GUARD.abi,
    "Released",
  );
  requireEvidence(
    releasedLog.holdId === lookHold &&
      sameAddress(releasedLog.to, LOOKALIKE) &&
      releasedLog.amount === units("150"),
    "release log must resolve the actual lookalike hold",
  );
  requireTransfer(
    released,
    p.usdc.address,
    p.guard.address,
    LOOKALIKE,
    units("150"),
    erc20Abi,
  );
  await holdState(p, lookHold, 1, released.blockNumber);
  after = await snapshot(c, p, released.blockNumber);
  transferDelta(current, after, "0xA1ice", units("150"));
  requireEvidence(
    after.raw["0xA1ice"] === units("150") &&
      after.raw.GuardAccount === units("3050") &&
      after.spendable === after.raw.GuardAccount,
    "loss must really settle before any payout",
  );
  await beat(
    {
      kind: "bad",
      tag: "VERIFIED LOSS",
      phase: "recovery",
      source: "chain",
      verified: true,
      text: "Clean release settled: lookalike received 150; guard is 3,050",
      why: "Loss evidence is this clean-release transaction, not the held proposal. The token transfer, both balance deltas, Released event, hold status and daily counters have been checked.",
      viz: {
        tx: {
          lane: "elevated",
          from: "GuardAccount",
          to: "0xA1ice",
          amount: 150,
        },
        flash: "violation",
      },
    },
    after,
    released,
  );
  checks.push({
    name: "loss",
    passed: true,
    detail:
      "Unknown lookalike first held; controlled false-negative clean release actually transferred 150 before claim submission.",
    txHash: released.transactionHash,
  });
  current = after;
  const releaseTimestamp = Number(
    (await c.public.getBlock({ blockNumber: released.blockNumber })).timestamp,
  );
  const breach = judgeBreach(
    p.policy,
    {
      to: LOOKALIKE,
      amount: units("150"),
      txHash: released.transactionHash,
      blockTimestamp: releaseTimestamp,
      calldata: "0x",
      instruction: instruction(lookEntry, lookAlibi.ownerSigned),
    },
    facts,
  );
  requireEvidence(
    breach.outcome === Outcome.COVERED &&
      breach.alibi === Alibi.EXTERNAL &&
      breach.lossAmount === units("150") &&
      breach.payoutAmount === units("135"),
    "local breach adjudication must cover real 150 loss with 135 payout",
  );
  await beat({
    kind: "info",
    tag: "LOCAL CLAIM REVIEW",
    phase: "recovery",
    source: "local",
    verified: true,
    text: "Local external-origin evidence + non-allowlisted settled transfer → COVERED, 135",
    why: "SDK history is local and not TEE-cosigned or committed to ENS. Deterministic judgeBreach evaluates that supplied instruction provenance against the installed policy; 150 less the 10% deductible is 135.",
  });
  const paid = await submitCoveredVerdict(p, c, {
    txHash: released.transactionHash,
    destination: LOOKALIKE,
    loss: units("150"),
    payout: breach.payoutAmount,
  });
  const accepted = receiptEvent(
    paid,
    p.verdicts.address,
    VERDICTS.abi,
    "VerdictAccepted",
  );
  requireEvidence(
    Number(accepted.outcome) === Outcome.COVERED &&
      Number(accepted.alibi) === Alibi.EXTERNAL &&
      accepted.payout === units("135") &&
      sameAddress(accepted.agent, p.guard.address),
    "covered verdict must accept this guard's external-origin 135 claim",
  );
  const payout = receiptEvent(paid, p.pool.address, POOL.abi, "Payout");
  requireEvidence(
    sameAddress(payout.claimant, p.policy.owner) &&
      payout.amount === units("135"),
    "pool payout log must credit the owner 135",
  );
  requireTransfer(
    paid,
    p.usdc.address,
    p.pool.address,
    p.policy.owner,
    units("135"),
    erc20Abi,
  );
  after = await snapshot(c, p, paid.blockNumber);
  requireEvidence(
    after.raw.Amara! - current.raw.Amara! === units("135") &&
      current.junior - after.junior === units("135") &&
      after.senior === current.senior,
    "payout must credit Amara 135, debit junior 135, leave senior unchanged",
  );
  requireEvidence(
    after.raw.GuardAccount === current.raw.GuardAccount &&
      after.raw["0xA1ice"] === current.raw["0xA1ice"],
    "claim payment must not fabricate reversal of the loss",
  );
  await beat(
    {
      kind: "payout",
      tag: "PAID",
      phase: "recovery",
      source: "chain",
      verified: true,
      text: "135 paid to Amara in the verdict transaction; junior absorbs the claim",
      why: "VerdictAccepted, Payout and the ERC-20 Transfer appear in the same confirmed receipt. Amara's balance increased by 135; junior capital decreased by 135; senior capital stayed 25,000.",
      viz: {
        tx: { lane: "payout", from: "Pool", to: "Amara", amount: 135 },
        flash: "payout",
      },
    },
    after,
    paid,
  );
  checks.push({
    name: "payout",
    passed: true,
    detail:
      "Accepted covered verdict and actual 135 owner payout share one receipt; junior loses 135, senior unchanged.",
    txHash: paid.transactionHash,
  });

  const nuno = new Repayd({
    agentName: "Nuno local demo",
    sessionKey: nunoKey,
  });
  const ownerEntry = await nuno.commit(
    "LOCAL DEMO: owner directs payment of 1800 to a third party",
    { origin: "owner-console" },
  );
  const alibi = nuno.alibiFor(ownerEntry.digest);
  requireEvidence(
    alibi.found &&
      alibi.ownerSigned &&
      nuno.verifyChain() &&
      !ownerEntry.teeCosigned,
    "local Nuno entry must have a verified owner signature and no fake TEE cosignature",
  );
  const denial = judgeBreach(
    { ...p.policy, owner: privateKeyToAccount(nunoKey).address },
    {
      to: ATTACKER,
      amount: units("1800"),
      txHash: ownerEntry.digest,
      blockTimestamp: ownerEntry.timestamp,
      calldata: "0x",
      instruction: instruction(ownerEntry, alibi.ownerSigned),
    },
    facts,
  );
  requireEvidence(
    denial.outcome === Outcome.DENIED_OWNER_ORIGIN &&
      denial.alibi === Alibi.OWNER_SIGNED &&
      denial.payoutAmount === 0n,
    "owner-signed local scenario must be DENIED with zero payout",
  );
  await beat({
    kind: "ok",
    tag: "LOCAL OWNER ORIGIN",
    phase: "provenance",
    source: "local",
    verified: true,
    text: "Nuno signature verified locally: ownerSigned=true → DENIED, payout 0",
    why: "This is an SDK/engine demonstration only. No Nuno transfer, denial transaction, World ID link, reputation scar, ENS update or premium adjustment was sent on chain. The engine input uses the local entry digest, not a claimed transaction hash.",
  });
  checks.push({
    name: "provenance",
    passed: true,
    detail:
      "LOCAL: SDK verifies Nuno owner signature and chain integrity; judgeBreach returns DENIED_OWNER_ORIGIN and zero payout. No on-chain denial claimed.",
  });

  const final = await snapshot(
    c,
    p,
    await c.public.getBlockNumber({ cacheTime: 0 }),
  );
  const expected: Record<string, bigint> = {
    GuardAccount: units("3050"),
    Amara: units("135"),
    "0xFresh": 0n,
    Attacker: 0n,
    "0xA1ice": units("150"),
    Alice: units("270"),
    Bob: units("530"),
  };
  for (const [label, amount] of Object.entries(expected))
    requireEvidence(
      final.raw[label] === amount,
      `final ${label} balance must equal ${amount}`,
    );
  requireEvidence(
    final.junior === units("19865") &&
      final.senior === units("25000") &&
      final.poolBalance === units("44865"),
    "final pool capital and backing must be junior 19865 / senior 25000 / tokens 44865",
  );
  requireEvidence(
    final.daily[1] === units("950") &&
      final.daily[2] === 5n &&
      final.spendable === final.raw.GuardAccount,
    "final daily spend/count must be 950/5 with no pending holds",
  );
  await Promise.all([
    holdState(p, freshHold, 4, final.blockNumber),
    holdState(p, lookHold, 1, final.blockNumber),
  ]);
  await beat(
    {
      kind: "ok",
      tag: "VERIFIED",
      phase: "complete",
      source: "chain",
      verified: true,
      text: "Six checks passed; final balances verified; no pending holds",
      why: "Four payrolls, containment, a mined policy revert, a real controlled residual loss, an actual pool payout and a local owner-origin denial. Completion is published only after these final chain reads. This is testnet demo USDC, not a production insurance claim.",
    },
    final,
  );
  publishResult({
    version: 1,
    verified: true,
    runId,
    chainId: DEMO_CHAIN_ID,
    guard: p.guard.address,
    usdc: p.usdc.address,
    checks,
    balances: final.balances,
    pool: final.pool,
    txHashes: getTransactions().map((tx) => tx.hash),
    startBlock,
    endBlock: Number(final.blockNumber),
  });
  endDemo();
}

async function executeDemo(): Promise<void> {
  const runId = process.env.REPAYD_RUN_ID ?? randomUUID();
  const release = await acquireDemoWorkerLock(runId);
  const onParentLoss = () => {
    console.error(
      "DEMO FAILED: parent IPC disconnected; stopping signer immediately",
    );
    process.exit(1);
  };
  const onTerminate = () => {
    process.exit(143);
  };
  const onInterrupt = () => {
    process.exit(130);
  };
  let managed = false;
  try {
    managed = requireDemoParent();
    if (managed) {
      process.once("disconnect", onParentLoss);
      process.send!({ type: "worker-ready", runId, pid: process.pid });
    }
    process.once("SIGTERM", onTerminate);
    process.once("SIGINT", onInterrupt);
    await main(runId);
  } finally {
    process.removeListener("disconnect", onParentLoss);
    process.removeListener("SIGTERM", onTerminate);
    process.removeListener("SIGINT", onInterrupt);
    try {
      if (managed && process.connected) process.disconnect?.();
    } finally {
      release();
    }
  }
}

if (import.meta.main) {
  executeDemo().catch((error: unknown) => {
    // Avoid serializing provider request objects, environment, or key material.
    const message = (
      error instanceof Error
        ? "shortMessage" in error
          ? String(error.shortMessage)
          : error.message
        : "Unknown demo failure"
    )
      .replace(/https?:\/\/\S+/g, "[RPC endpoint]")
      .replace(/0x[0-9a-fA-F]{64}/g, "[32-byte value]");
    publish({
      t: 0,
      kind: "bad",
      source: "system",
      text: `Demo failed: ${message}`,
    });
    // viem nests the failing method and the raw RPC response under
    // details/metaMessages/cause; shortMessage alone hides the cause.
    const e = error as {
      name?: string;
      details?: unknown;
      metaMessages?: unknown;
      request?: { method?: string };
      cause?: { shortMessage?: string; message?: string };
    };
    const scrub = (s: string) =>
      s
        .replace(/https?:\/\/\S+/g, "[RPC endpoint]")
        .replace(/0x[0-9a-fA-F]{64}/g, "[32-byte value]");
    const extra = scrub(
      [
        e?.name ? `name=${e.name}` : "",
        e?.request?.method ? `method=${e.request.method}` : "",
        e?.details ? `details=${String(e.details)}` : "",
        ...(Array.isArray(e?.metaMessages) ? e.metaMessages.map(String) : []),
        e?.cause
          ? `cause=${String(e.cause.shortMessage ?? e.cause.message ?? "")}`
          : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
    console.error(`DEMO FAILED: ${message}${extra ? ` [${extra}]` : ""}`);
    endDemo();
    process.exitCode = 1;
  });
}
