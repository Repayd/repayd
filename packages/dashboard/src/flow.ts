/** Run-scoped, read-only receipt evidence. Never scans shared registries or live balances. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  http,
  formatUnits,
  formatEther,
  decodeFunctionData,
  decodeEventLog,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type Transaction,
  erc20Abi,
  type TransactionReceipt,
} from "viem";
import {
  IDENTITY_ABI,
  VALIDATION_ABI,
  REPUTATION_ABI,
} from "../../sdk/src/erc8004/abi.ts";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER,
  type DemoRun,
  type RunTransaction,
} from "../../demo/src/run-types.ts";

type Addr = Address;
type Hash = Hex;

interface FlowChainConfig {
  readonly id: string;
  readonly name: string;
  readonly rpc: string;
  readonly contracts: Record<string, Addr>;
  readonly actors: Record<string, Addr>;
  readonly deployed: boolean;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const abiCache = new Map<string, Abi>();

function artifactAbi(name: string): Abi {
  let abi = abiCache.get(name);
  if (!abi) {
    const path = join(ROOT, "contracts", "out", `${name}.sol`, `${name}.json`);
    const artifact: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !artifact ||
      typeof artifact !== "object" ||
      !("abi" in artifact) ||
      !Array.isArray(artifact.abi)
    ) {
      throw new Error(`Contract artifact ${name} has no ABI.`);
    }
    abi = artifact.abi;
    abiCache.set(name, abi);
  }
  return abi;
}

/** Demo recipient constants (packages/demo/src/protocol.ts). */
const ALICE = "0x328809bc894f92807417d2dad6b7c998c1afdac6" as Addr;
const BOB = "0x1d96f2f6bef1202e4ce1ff6dad0c2cb002861d3e" as Addr;
const FRESH = `0x${ALICE.slice(4)}${ALICE.slice(2, 4)}` as Addr;
const ATTACKER = "0x9f2c8a11b6c4d3e5f7a8b9c0d1e2f3a4b5c6d7e8" as Addr;
const LOOKALIKE = `${ALICE.slice(0, -1)}${
  ALICE.endsWith("1") ? "2" : "1"
}` as Addr;

function chainConfig(run: DemoRun): FlowChainConfig {
  if (run.chainId !== ARC_CHAIN_ID)
    throw new Error(
      `Flow requires an Arc testnet run (chain ${ARC_CHAIN_ID}).`,
    );
  const deployment = run.deployment;
  if (deployment && deployment.chainId !== run.chainId)
    throw new Error("Run deployment chain does not match the run.");
  return {
    id: String(run.chainId),
    name: "Arc testnet",
    rpc: process.env.ARC_DEMO_RPC_URL || "https://rpc.testnet.arc.io",
    contracts: deployment
      ? {
          ...deployment.contracts,
          guard: deployment.contracts.guardAccount,
          identity: deployment.erc8004.identity,
          validation: deployment.erc8004.validation,
          reputation: deployment.erc8004.reputation,
        }
      : {},
    actors: deployment ? { ...deployment.actors } : {},
    deployed: Boolean(deployment),
  };
}

// --------------------------------------------------------------------- //
//                         Labels                                        //
// --------------------------------------------------------------------- //

function labelFor(addr: Addr, cfg: FlowChainConfig): string {
  const a = addr.toLowerCase();
  const c = cfg.contracts;
  const ac = cfg.actors;
  if (a === c.guard?.toLowerCase()) return "GuardAccount (Atlas)";
  if (a === c.usdc?.toLowerCase()) return "Demo USDC (mintable)";
  if (a === c.verdicts?.toLowerCase()) return "VerdictContract";
  if (a === c.mutualPool?.toLowerCase()) return "MutualPool";
  if (a === c.policyRegistry?.toLowerCase()) return "PolicyRegistry";
  if (a === c.blocklist?.toLowerCase()) return "Blocklist";
  if (a === c.identity?.toLowerCase()) return "ERC-8004 Identity";
  if (a === c.validation?.toLowerCase()) return "ERC-8004 Validation";
  if (a === c.reputation?.toLowerCase()) return "ERC-8004 Reputation";
  if (a === ac.amaraPolicyOwner?.toLowerCase()) return "Amara (owner)";
  if (a === ac.agentSessionKey?.toLowerCase()) return "Agent key (Atlas)";
  if (a === ac.watcher?.toLowerCase()) return "Watcher (local demo signer)";
  if (a === ac.raviJunior?.toLowerCase()) return "Ravi (junior LP)";
  if (a === ac.seniorLP?.toLowerCase()) return "Senior LP";
  if (a === ac.deployer?.toLowerCase()) return "Deployer (Amara)";
  if (/^0x0{40}$/.test(a)) return "Mint / burn address";
  if (a === ALICE.toLowerCase()) return "Alice (contractor)";
  if (a === BOB.toLowerCase()) return "Bob (contractor)";
  if (a === FRESH.toLowerCase()) return "0xFresh (attacker wallet)";
  if (a === ATTACKER.toLowerCase()) return "Attacker (override target)";
  if (a === LOOKALIKE.toLowerCase()) return "0xA1ice (look-alike scam)";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// --------------------------------------------------------------------- //
//                         Event decoding                                //
// --------------------------------------------------------------------- //

interface DecodedEvent {
  readonly name: string;
  readonly text: string;
  readonly address: string;
}

function usd(v: bigint | number): string {
  return `$${Number(formatUnits(BigInt(v), 6)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

const LANES = ["ROUTINE", "ELEVATED", "VIOLATION"];

function tagStr(v: unknown): string {
  const n = BigInt((v as bigint) ?? 0);
  if (!n) return "?";
  const hex = n.toString(16).padStart(8, "0");
  return Buffer.from(hex, "hex")
    .toString("latin1")
    .replace(/[^\x20-\x7e]/g, "");
}

/** All ABIs that can appear, per address (first match decodes the log). */
function abisFor(addr: Addr, cfg: FlowChainConfig): Abi[] {
  const c = cfg.contracts;
  const a = addr.toLowerCase();
  if (c.guard?.toLowerCase() === a) return [artifactAbi("GuardAccount")];
  if (c.mutualPool?.toLowerCase() === a) return [artifactAbi("MutualPool")];
  if (c.verdicts?.toLowerCase() === a) return [artifactAbi("VerdictContract")];
  if (c.policyRegistry?.toLowerCase() === a)
    return [artifactAbi("PolicyRegistry")];
  if (c.blocklist?.toLowerCase() === a) return [artifactAbi("Blocklist")];
  if (c.usdc?.toLowerCase() === a) return [artifactAbi("USDCMock")];
  if (c.identity?.toLowerCase() === a) return [IDENTITY_ABI as Abi];
  if (c.validation?.toLowerCase() === a) return [VALIDATION_ABI as Abi];
  if (c.reputation?.toLowerCase() === a) return [REPUTATION_ABI as Abi];
  return cfg.deployed
    ? []
    : [
        "GuardAccount",
        "MutualPool",
        "VerdictContract",
        "PolicyRegistry",
        "Blocklist",
        "USDCMock",
      ].map(artifactAbi);
}

function fmtArgs(
  args: Record<string, unknown> | undefined,
  cfg: FlowChainConfig,
): string {
  if (!args) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (/^\d+$/.test(k)) continue; // positional duplicates
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
      parts.push(`${k}=${labelFor(v as Addr, cfg)}`);
    else if (typeof v === "bigint") parts.push(`${k}=${v.toString()}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" · ");
}

/** Decode a log into plain words; unknown → generic. */
function decodeEvent(
  addr: Addr,
  data: Hex,
  topics: readonly Hex[],
  cfg: FlowChainConfig,
): DecodedEvent {
  for (const abi of abisFor(addr, cfg)) {
    try {
      const d = decodeEventLog<Abi, string, Hex[], Hex>({
        abi,
        data,
        topics: [...topics] as [Hex, ...Hex[]],
      });
      const name = d.eventName;
      const args = d.args as unknown as Record<string, unknown>;
      if (
        name === "Transfer" &&
        addr.toLowerCase() !== cfg.contracts.usdc?.toLowerCase()
      ) {
        return {
          name,
          text: `Token transfer of ${String(
            args.value,
          )} base units; token decimals are not recorded yet`,
          address: addr,
        };
      }
      return { name, text: plainEvent(name, args, cfg), address: addr };
    } catch {
      /* try next */
    }
  }
  return {
    name: "Unknown event",
    text: `Undecoded event ${topics[0] ?? "(no signature)"} on ${labelFor(
      addr,
      cfg,
    )}; data ${data}`,
    address: addr,
  };
}

function plainEvent(
  name: string,
  a: Record<string, unknown>,
  cfg: FlowChainConfig,
): string {
  const who = (x: unknown): string =>
    typeof x === "string" ? labelFor(x as Addr, cfg) : "?";
  const amt = (x: unknown): string => usd((x as bigint) ?? 0n);
  switch (name) {
    // ---- GuardAccount ----
    case "Classified": {
      const lane = LANES[Number(a.tier ?? 0)] ?? "?";
      return `policy lane check → ${lane} (${tagStr(a.tag)}): ${amt(
        a.amount,
      )} toward ${who(a.to)}`;
    }
    case "ExecutedRoutine":
      return `ROUTINE transfer EXECUTED instantly: ${amt(a.amount)} → ${who(
        a.to,
      )} — allowlisted, under caps, zero delay`;
    case "Held":
      return `transfer entered hold #${String(a.holdId)}: ${amt(
        a.amount,
      )} toward ${who(a.to)}; releaseAt ${String(
        a.releaseAt,
      )} (Unix seconds), no transfer yet`;
    case "Released":
      return `hold #${String(a.holdId)} cleared → released ${amt(
        a.amount,
      )} to ${who(a.to)}`;
    case "OwnerDecision": {
      const d = ["APPROVE once", "FREEZE & ignore", "FREEZE + rotate keys"][
        Number(a.decision ?? -1)
      ];
      return `owner decision on hold #${String(a.holdId)}: ${
        d ?? `code ${String(a.decision)}`
      } (by ${who(a.actor)})`;
    }
    case "ViolationBlocked":
      return `policy violation recorded: ${tagStr(a.tag)}, ${amt(
        a.amount,
      )} toward ${who(a.to)}`;
    case "AttemptedBreach":
      return `attempted-breach signal recorded — ${tagStr(
        a.tag,
      )}; this event does not itself change a premium`;
    case "Withdrawn":
      return `owner withdrew ${amt(a.amount)} — custody is never locked`;
    case "AgentKeyRotated":
      return `agent key rotated → ${who(
        a.newAgentKey,
      )} (old key can no longer spend)`;
    case "AuthorityRevoked":
      return `agent authority revoked (freeze + rotate) — agent is now read-only`;
    case "HoldLapsed":
      return `hold #${String(a.holdId)} window lapsed → fail-safe extension`;
    case "Received":
      return `native value received: ${formatEther((a.value as bigint) ?? 0n)}`;
    // ---- MutualPool ----
    case "Deposited":
      return `capital DEPOSITED into ${
        Number(a.tranche) === 1 ? "senior" : "junior"
      } tranche: ${amt(a.assets)} from ${who(a.depositor)}`;
    case "Redeemed":
      return `depositor ${who(a.depositor)} redeemed tranche shares`;
    case "Payout":
      return `CLAIM PAID: ${amt(a.amount)} → ${who(
        a.claimant,
      )} — in the same transaction as the verdict`;
    case "PremiumRecorded":
      return `premium ${amt(
        a.amount,
      )} entered the pool waterfall (fees → junior carry → senior)`;
    case "LossApplied":
      return `loss waterfall applied: ${amt(a.amount)} absorbed (junior ${amt(
        a.juniorLoss,
      )}, senior ${amt(a.seniorLoss)}, reinsurance ${amt(a.reinsuranceLoss)})`;
    // ---- VerdictContract ----
    case "VerdictAccepted": {
      const outcomes = ["CLEAN", "COVERED", "DENIED", "ATTEMPTED"];
      const o = outcomes[Number(a.outcome ?? 0)] ?? String(a.outcome);
      const alibi =
        ["EXTERNAL", "OWNER-SIGNED", "UNKNOWN"][Number(a.alibi ?? 0)] ?? "?";
      return `watcher verdict ACCEPTED: ${o} · payout ${amt(
        a.payout,
      )} · alibi ${alibi} — signature + policy hash verified on-chain`;
    }
    case "HoldVerdictRouted":
      return `hold #${String(a.holdId)} verdict routed → ${
        a.clean ? "RELEASE (clean)" : "FREEZE (suspicious)"
      }`;
    case "StrikeRecorded":
      return `blocklist strike recorded against ${who(a.destination)}`;
    case "AttemptedBreachSignal":
      return `attempted-breach signal mirrored for pricing`;
    // ---- PolicyRegistry ----
    case "PolicyUpdated":
      return `policy v${String(a.version)} attached for ${who(
        a.agent,
      )} — rules and policy hash recorded on-chain`;
    case "PolicyRevoked":
      return `policy v${String(a.version)} revoked for ${who(a.agent)}`;
    // ---- Blocklist ----
    case "Reported":
      return `destination ${who(
        a.destination,
      )} reported to this deployment's blocklist (strike ${String(a.strikes)})`;
    case "Cleared":
      return `blocklist entry cleared: ${who(a.destination)}`;
    // ---- USDC ----
    case "Transfer": {
      const from = String(a.from ?? "");
      if (/^0x0{40}$/.test(from))
        return `${amt(a.value)} demo tokens minted to ${who(a.to)}`;
      return `${amt(a.value)} demo tokens moved: ${who(a.from)} → ${who(a.to)}`;
    }
    case "Approval":
      return `token spending allowance set (${who(a.owner)} → ${who(
        a.spender,
      )})`;
    default:
      return fmtArgs(a, cfg) || name;
  }
}
// --------------------------------------------------------------------- //
//                         Call decoding                                 //
// --------------------------------------------------------------------- //

interface DecodedCall {
  readonly fn: string;
  readonly plain: string;
  readonly category: string;
}

function decodeCall(
  to: Addr | undefined,
  input: Hex,
  cfg: FlowChainConfig,
): DecodedCall {
  if (!input || input === "0x")
    return {
      fn: "Native value transfer",
      plain: "native Arc USDC transfer / gas funding",
      category: "value",
    };
  for (const abi of to ? abisFor(to, cfg) : []) {
    try {
      const d = decodeFunctionData({ abi, data: input });
      return describeCall(
        String(d.functionName),
        (d.args ?? []) as unknown[],
        cfg,
      );
    } catch {
      /* try next ABI */
    }
  }
  return {
    fn: input.slice(0, 10),
    plain: `unknown call ${input.slice(0, 10)}`,
    category: "other",
  };
}

function describeCall(
  fn: string,
  args: unknown[],
  cfg: FlowChainConfig,
): DecodedCall {
  const addrArg = args.find(
    (x) => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x),
  ) as Addr | undefined;
  const bigArg = args.find((x) => typeof x === "bigint") as bigint | undefined;
  const who = (x: Addr | undefined): string => (x ? labelFor(x, cfg) : "?");
  switch (fn) {
    case "propose":
      // propose(token, to, amount): args[1] is the recipient, args[2] the
      // amount — addrArg would otherwise pick the token contract.
      return {
        fn: "propose · GuardAccount",
        plain: `the agent proposed ${usd(bigArg ?? 0n)} to ${who(
          typeof args[1] === "string" ? (args[1] as Addr) : addrArg,
        )} — the GuardAccount checked it against the policy and picked a lane`,
        category: "spend",
      };
    case "decide":
      return {
        fn: "decide · GuardAccount",
        plain: `owner resolved a frozen hold: ${
          ["APPROVE once", "FREEZE", "FREEZE + rotate keys"][
            Number(args[1] ?? 0)
          ] ?? "?"
        }`,
        category: "decision",
      };
    case "submitVerdict": {
      const verdict = args[0] as { outcome?: number; payoutAmount?: bigint };
      const outcome =
        ["CLEAN", "COVERED", "DENIED (owner origin)", "ATTEMPTED"][
          Number(verdict?.outcome)
        ] ?? "unknown";
      return {
        fn: "submitVerdict · VerdictContract",
        plain: `local demo signer submitted a ${outcome} verdict with ${usd(
          verdict?.payoutAmount ?? 0n,
        )} requested payout; receipt events show acceptance and settlement`,
        category: Number(verdict?.outcome) === 1 ? "payout" : "verdict",
      };
    }
    case "submitHoldVerdict":
      return {
        fn: "submitHoldVerdict · VerdictContract",
        plain: `local demo signer routed a hold verdict → ${
          Number(args[3] ?? 1) === 0 ? "RELEASE (clean)" : "FREEZE (suspicious)"
        }`,
        category: "verdict",
      };
    case "attach":
    case "update":
      return {
        fn: `${fn} · PolicyRegistry`,
        plain: "policy attached/updated — the rules of normal went on-chain",
        category: "policy",
      };
    case "report":
      return {
        fn: "report · Blocklist",
        plain: `destination ${who(addrArg)} flagged on the shared blocklist`,
        category: "blocklist",
      };
    case "deposit":
      return {
        fn: "deposit · MutualPool",
        plain: `capital entered the pool: ${usd(bigArg ?? 0n)} into tranche ${
          Number(args[0] ?? 0) === 1 ? "senior" : "junior"
        }`,
        category: "capital",
      };
    case "transfer":
      return {
        fn: "transfer · USDC",
        plain: `USDC moved: ${usd(bigArg ?? 0n)}`,
        category: "transfer",
      };
    case "transferFrom":
      return {
        fn: "transferFrom · USDC",
        plain: `USDC pulled by a contract: ${usd(bigArg ?? 0n)}`,
        category: "transfer",
      };
    case "approve":
      return {
        fn: "approve · Demo USDC",
        plain: "token spending allowance set for the specified spender",
        category: "setup",
      };
    case "mint":
      return {
        fn: "mint · Demo USDC",
        plain: `${usd(bigArg ?? 0n)} mintable demo tokens created for ${who(
          addrArg,
        )}; not faucet or production USDC`,
        category: "setup",
      };
    case "setVerdictContract":
    case "setPool":
    case "setWatcher":
    case "setReporter":
      return {
        fn,
        plain: `${fn} configured ${who(addrArg)} on this run's deployment`,
        category: "setup",
      };
    case "reportAttempt":
      return {
        fn: "reportAttempt · GuardAccount",
        plain: `attempted transfer of ${usd(bigArg ?? 0n)} toward ${who(
          addrArg,
        )} recorded as a policy signal; no funds moved by this call`,
        category: "policy",
      };
    case "register":
      return {
        fn: "register · ERC-8004 Identity",
        plain:
          "agent registered on the canonical ERC-8004 identity registry (token = agentId)",
        category: "identity",
      };
    case "setAgentWallet":
      return {
        fn: "setAgentWallet · ERC-8004 Identity",
        plain: "wallet binding posted to the agent's canonical identity",
        category: "identity",
      };
    case "validationRequest":
      return {
        fn: "validationRequest · ERC-8004 Validation",
        plain:
          "a validation request was posted to the registry; a request alone does not establish validation",
        category: "identity",
      };
    case "validationResponse":
      return {
        fn: "validationResponse · ERC-8004 Validation",
        plain: `validator response posted: ${String(
          args[1],
        )}; this is demo provenance, not independent attestation`,
        category: "identity",
      };
    case "giveFeedback":
      return {
        fn: "giveFeedback · ERC-8004 Reputation",
        plain: `reputation feedback posted with value ${formatUnits(
          BigInt(args[1] as bigint),
          Number(args[2]),
        )}; tags ${String(args[3])}, ${String(args[4])}`,
        category: "identity",
      };
    default:
      return { fn, plain: `${fn}()`, category: "admin" };
  }
}

// --------------------------------------------------------------------- //
//                         Scan                                          //
// --------------------------------------------------------------------- //

export interface FlowTx {
  readonly hash: string;
  readonly block: number;
  readonly timestamp: number;
  readonly status: "success" | "reverted";
  readonly from: string;
  readonly to: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly fn: string;
  readonly plain: string;
  readonly category: string;
  /** Native Arc USDC, using the EVM's 18-decimal representation. */
  readonly value: string;
  readonly gas: string;
  readonly explorerUrl: string;
  readonly events: DecodedEvent[];
  readonly transfers: {
    from: string;
    to: string;
    amount: string;
    token: string;
  }[];
}

export interface FlowResult {
  readonly runId: string | null;
  readonly chain: { id: string; name: string; head: number; rpc: string };
  readonly scanned: { fromBlock: number; toBlock: number; truncated: boolean };
  readonly wallets: {
    address: string;
    label: string;
    usdc: number;
    note: string;
  }[];
  readonly txs: FlowTx[];
  readonly message?: string;
}

interface ReceiptEvidence {
  readonly tx: Transaction;
  readonly receipt: TransactionReceipt;
  readonly timestamp: number;
}

// Only immutable RPC evidence is cached. Labels, snapshots, and the list of hashes
// are rebuilt from the selected run on every request, including active deployments.
const receiptCache = new Map<string, Promise<ReceiptEvidence>>();

function receiptEvidence(
  client: PublicClient,
  chainId: number,
  hash: Hash,
): Promise<ReceiptEvidence> {
  const key = `${chainId}:${hash.toLowerCase()}`;
  const cached = receiptCache.get(key);
  if (cached) return cached;
  const pending = (async (): Promise<ReceiptEvidence> => {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    if (
      tx.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      tx.blockHash !== receipt.blockHash ||
      tx.blockNumber !== receipt.blockNumber
    ) {
      throw new Error("RPC returned inconsistent transaction evidence.");
    }
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    if (
      block.hash !== receipt.blockHash ||
      block.number !== receipt.blockNumber
    ) {
      throw new Error("RPC returned an inconsistent receipt block.");
    }
    return { tx, receipt, timestamp: Number(block.timestamp) };
  })().catch((cause: unknown) => {
    receiptCache.delete(key);
    // Do not leak an authenticated RPC URL through viem's transport error text.
    throw new Error(
      `Unable to load receipt evidence for recorded transaction ${hash}. Try again when the Arc RPC is available.`,
      { cause },
    );
  });
  receiptCache.set(key, pending);
  return pending;
}

function snapshotWallets(
  run: DemoRun,
  cfg: FlowChainConfig,
): FlowResult["wallets"] {
  if (!run.deployment) return [];
  let balances = run.result?.verified ? run.result.balances : undefined;
  let at = run.endedAt ?? run.updatedAt;
  const final = Boolean(balances);
  if (!balances) {
    for (let i = run.events.length - 1; i >= 0; i--) {
      const event = run.events[i];
      if (event?.verified && event.viz?.balances) {
        balances = event.viz.balances;
        at = event.emittedAt;
        break;
      }
    }
  }
  if (!balances) return [];
  const addresses: Record<string, Addr> = {
    GuardAccount: run.deployment.contracts.guardAccount,
    Amara: run.deployment.actors.amaraPolicyOwner,
    Alice: ALICE,
    Bob: BOB,
    "0xFresh": FRESH,
    Attacker: ATTACKER,
    "0xA1ice": LOOKALIKE,
  };
  const wallets: FlowResult["wallets"] = [];
  for (const [name, usdc] of Object.entries(balances)) {
    const address =
      addresses[name] ??
      (/^0x[0-9a-fA-F]{40}$/.test(name) ? (name as Addr) : undefined);
    if (!address || !Number.isFinite(usdc)) continue;
    wallets.push({
      address,
      label: labelFor(address, cfg),
      usdc,
      note: `${
        final ? "Verified final run snapshot" : "Last verified run snapshot"
      } recorded ${new Date(
        at,
      ).toISOString()}; mintable demo token, not a live balance.`,
    });
  }
  return wallets;
}

function flowTransaction(
  record: RunTransaction,
  evidence: ReceiptEvidence,
  cfg: FlowChainConfig,
): FlowTx {
  const { tx, receipt, timestamp } = evidence;
  const created = !tx.to;
  const target = tx.to ?? receipt.contractAddress;
  const call = created
    ? {
        fn: "Contract deployment",
        plain: `contract creation${target ? `: ${labelFor(target, cfg)}` : ""}`,
        category: "deployment",
      }
    : decodeCall(tx.to ?? undefined, tx.input, cfg);
  const events = receipt.logs.map((log) =>
    decodeEvent(log.address, log.data, log.topics, cfg),
  );
  const transfers: FlowTx["transfers"] = [];
  if (receipt.status === "success") {
    if (tx.value > 0n && target)
      transfers.push({
        from: tx.from,
        to: target,
        amount: formatEther(tx.value),
        token: "Arc native USDC",
      });
    // ERC-20 transfers have exactly two indexed addresses. ERC-8004 NFT
    // Transfers use an extra indexed token id and must not be treated as USDC.
    for (const log of receipt.logs) {
      if (log.topics.length !== 3) continue;
      try {
        const decoded = decodeEventLog({
          abi: erc20Abi,
          eventName: "Transfer",
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args;
        if (decoded.eventName === "Transfer") {
          const amount =
            log.address.toLowerCase() === cfg.contracts.usdc?.toLowerCase()
              ? formatUnits(args.value, 6)
              : `${args.value.toString()} base units (token decimals not recorded)`;
          transfers.push({
            from: args.from,
            to: args.to,
            amount,
            token: log.address,
          });
        }
      } catch {
        /* Unknown log remains visible in events; it is not a verified token movement. */
      }
    }
  }
  return {
    hash: receipt.transactionHash,
    block: Number(receipt.blockNumber),
    timestamp,
    status: receipt.status,
    from: labelFor(tx.from, cfg),
    to: target
      ? labelFor(target, cfg)
      : "Contract creation (no contract created)",
    fromAddress: tx.from,
    // Failed contract creation has no destination address; never invent one.
    toAddress: target ?? "",
    fn: call.fn,
    plain:
      receipt.status === "reverted"
        ? `${record.label} — REVERTED on-chain. Attempted ${call.fn}; no contract state changes or token transfers persisted. Gas was still spent.`
        : `${record.label} — ${call.plain}`,
    category: call.category,
    value: formatEther(tx.value),
    gas: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
    explorerUrl: `${ARC_EXPLORER}/tx/${receipt.transactionHash}`,
    events,
    transfers,
  };
}

export async function scanFlow(run: DemoRun): Promise<FlowResult> {
  const cfg = chainConfig(run);
  const records = new Map<string, RunTransaction>();
  for (const tx of run.transactions) records.set(tx.hash.toLowerCase(), tx);
  const wallets = snapshotWallets(run, cfg);
  const messages = [
    run.status === "running"
      ? "Run in progress. Only recorded, confirmed transactions are shown; refresh for newly confirmed hashes."
      : `Historical ${run.status} run. Only this run's recorded transactions are shown; balances are stored snapshots, not current wallet values.`,
  ];
  if (!run.deployment)
    messages.push(
      "Deployment is not yet recorded; available funding and creation receipts remain visible without inferred contract identities.",
    );
  if (!wallets.length)
    messages.push("No verified wallet snapshot is available for this run yet.");
  if (!records.size) {
    messages.push(
      "No confirmed transaction hashes have been recorded for this run. No RPC scan has been performed.",
    );
    return {
      runId: run.id,
      chain: {
        id: cfg.id,
        name: cfg.name,
        head: 0,
        rpc: new URL(cfg.rpc).origin,
      },
      scanned: { fromBlock: 0, toBlock: 0, truncated: false },
      wallets,
      txs: [],
      message: messages.join(" "),
    };
  }
  const client = createPublicClient({
    transport: http(cfg.rpc, { retryCount: 0, timeout: 15_000 }),
  });
  let head: bigint;
  try {
    const [chainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    if (chainId !== run.chainId) throw new Error("RPC chain mismatch.");
    head = blockNumber;
  } catch (cause) {
    throw new Error(
      `Cannot read this run from Arc testnet (chain ${run.chainId}); check the configured RPC connection and chain.`,
      { cause },
    );
  }
  const txs: FlowTx[] = [];
  const entries = [...records.values()];
  // Bounded reads avoid a burst of every deployment receipt against the public RPC.
  for (let i = 0; i < entries.length; i += 4) {
    const wave = await Promise.all(
      entries
        .slice(i, i + 4)
        .map(async (record) =>
          flowTransaction(
            record,
            await receiptEvidence(client, run.chainId, record.hash),
            cfg,
          ),
        ),
    );
    txs.push(...wave);
  }
  txs.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.block - b.block ||
      a.hash.localeCompare(b.hash),
  );
  const firstTx = txs[0];
  if (!firstTx)
    throw new Error("Recorded transaction evidence is unexpectedly empty.");
  let fromBlock = firstTx.block;
  let toBlock = fromBlock;
  for (const tx of txs) {
    fromBlock = Math.min(fromBlock, tx.block);
    toBlock = Math.max(toBlock, tx.block);
  }
  return {
    runId: run.id,
    chain: {
      id: cfg.id,
      name: cfg.name,
      head: Number(head),
      rpc: new URL(cfg.rpc).origin,
    },
    scanned: { fromBlock, toBlock, truncated: false },
    wallets,
    txs,
    message: messages.join(" "),
  };
}
