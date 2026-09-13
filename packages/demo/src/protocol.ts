/**
 * Protocol access for the demo — any EVM chain with a deployed stack.
 * Two paths, one deploy path:
 *  - deployProtocol: deploys the five contracts + USDC mock, wires them,
 *    funds the pool, attaches Atlas's policy (the forge script mirrors this).
 *  - attachProtocol: binds to a PRE-DEPLOYED stack from
 *    contracts/deployments/<chainId>.json (Deploy.s.sol output) — address
 *    consumption only, no redeploy.
 * Both hand back typed contract handles.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  publicActions,
  getContract,
  encodeAbiParameters,
  keccak256,
  toBytes,
  type PublicClient,
  type WalletClient,
  type Address,
  type GetContractReturnType,
  type Abi,
  type Hash,
  type TransactionReceipt,
  type PublicActions,
  type Transport,
} from "viem";
import { anvil } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy } from "@repayd/engine";
import { toOnChainPolicy } from "@repayd/engine";
import type { DeploymentRecord } from "@repayd/api/src/deployment.ts";
import { publishTransaction } from "./bus.ts";
import type { RunPhase } from "./run-types.ts";

interface ProtocolArtifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: string };
}
const artifactNames: Record<string, string> = {
  PolicyRegistry: "PolicyRegistry",
  GuardAccount: "GuardAccount",
  VerdictContract: "VerdictContract",
  MutualPool: "MutualPool",
  Blocklist: "Blocklist",
  USDCMock: "Usdc",
};
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadArtifact(name: string): ProtocolArtifact {
  const candidates = [
    join(repoRoot, "contracts", "out", `${name}.sol`, `${name}.json`),
    join(repoRoot, "packages", "subgraph", "abis", `${artifactNames[name]}.json`),
  ];
  for (const path of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      const object =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as {
              abi?: Abi;
              bytecode?: { object?: string };
            })
          : undefined;
      const abi = Array.isArray(parsed) ? (parsed as Abi) : object?.abi;
      if (Array.isArray(abi))
        return {
          abi,
          bytecode: { object: object?.bytecode?.object ?? "0x" },
        };
    } catch {
      // Try the next source. The committed ABIs cover attach mode.
    }
  }
  throw new Error(
    `Missing ${name} ABI. Run forge build or restore packages/subgraph/abis.`,
  );
}
const POLICY_REGISTRY = loadArtifact("PolicyRegistry");
export const GUARD_ACCOUNT = loadArtifact("GuardAccount");
export const VERDICT_CONTRACT = loadArtifact("VerdictContract");
export const MUTUAL_POOL = loadArtifact("MutualPool");
const BLOCKLIST = loadArtifact("Blocklist");
const USDC_MOCK = loadArtifact("USDCMock");

export const ALICE = "0x328809bc894f92807417d2dad6b7c998c1afdac6";
export const BOB = "0x1d96f2f6bef1202e4ce1ff6dad0c2cb002861d3e";
export const CAROL = "0xa4d4c1f8a763ef6a0140d04291eceef913ffc272";
/**
 * A recipient never seen before (GASP ONE's injected payee). Purely a
 * stand-in address — no key exists for it; derived from ALICE by rotating
 * the first two hex chars to the end so nothing is hardcoded and it can
 * never collide with the allowlist entries.
 */
export const FRESH_WALLET = `0x${ALICE.slice(4)}${ALICE.slice(
  2,
  4,
)}` as `0x${string}`;
export const ATTACKER = "0x9f2c8a11b6c4d3e5f7a8b9c0d1e2f3a4b5c6d7e8";

/** Resolve a REQUIRED actor key from the environment; names the var, no fallback. */
export function requiredKey(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `missing env var ${name} — export the demo actor's private key (0x + 64 hex) before running`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(v))
    throw new Error(`invalid env var ${name}: expected 0x + 64 hex characters`);
  return v as `0x${string}`;
}

/** Demo actor accounts — env key names mirror Deploy.s.sol (WATCHER_PRIVATE_KEY, …).
 *  Lazy so importing this module (tests: digest math only) never needs secrets. */
export function watcherAccount(): PrivateKeyAccount {
  return privateKeyToAccount(requiredKey("WATCHER_PRIVATE_KEY"));
}
export function agentKeyAccount(): PrivateKeyAccount {
  return privateKeyToAccount(requiredKey("AGENT_KEY_PRIVATE_KEY"));
}
export function amaraAccount(): PrivateKeyAccount {
  return privateKeyToAccount(requiredKey("AMARA_PRIVATE_KEY"));
}

const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

/** A wallet client that can also read. */
export type ReadWriteClient = WalletClient<
  Transport,
  typeof anvil,
  PrivateKeyAccount,
  undefined,
  undefined
> &
  PublicActions<Transport, typeof anvil, PrivateKeyAccount, undefined>;

/** Typed contract handle from viem's getContract. */
export type Contract<TAbi extends Abi> = GetContractReturnType<
  TAbi,
  { public: PublicClient; wallet: ReadWriteClient }
>;

export interface ProtocolClients {
  readonly public: PublicClient;
  readonly amara: ReadWriteClient;
  readonly agent: ReadWriteClient;
  readonly watcher: ReadWriteClient;
}

export interface Protocol {
  readonly usdc: Contract<typeof USDC_MOCK.abi>;
  readonly registry: Contract<typeof POLICY_REGISTRY.abi>;
  readonly guard: Contract<typeof GUARD_ACCOUNT.abi>;
  readonly verdicts: Contract<typeof VERDICT_CONTRACT.abi>;
  readonly pool: Contract<typeof MUTUAL_POOL.abi>;
  readonly blocklist: Contract<typeof BLOCKLIST.abi>;
  /** Atlas's policy, engine-view form (mirrors the on-chain attach). */
  readonly policy: Policy;
}

export interface DeployAccounts {
  readonly amara: PrivateKeyAccount;
  readonly ravi: PrivateKeyAccount;
  readonly senior: PrivateKeyAccount;
}

/**
 * DEMO_RPC_URL is REQUIRED — no localhost fallback (the demo attaches to any
 * chain instance; an accidental default would silently point at the wrong one).
 * DEMO_CHAIN_ID (or ARC_TESTNET_CHAIN_ID) selects the chain the clients and
 * EIP-712 digests are bound to — it MUST match the chain the VerdictContract
 * is deployed on, because the on-chain DOMAIN_SEPARATOR embeds block.chainid.
 * Hardcoding 31337 here would make every demo-signed verdict fail on-chain
 * ecrecover on any other chain (reopens the H2 cross-domain signature bug).
 */
export function rpcUrl(): string {
  const v = process.env.DEMO_RPC_URL;
  if (!v) {
    throw new Error(
      "missing env var DEMO_RPC_URL — export the RPC endpoint before running",
    );
  }
  return v;
}
export const DEMO_CHAIN_ID = Number(
  process.env.DEMO_CHAIN_ID ?? process.env.ARC_TESTNET_CHAIN_ID ?? anvil.id,
);

/** viem clients shared by the demo, bound to DEMO_CHAIN_ID's chain. */
export function clients(): ProtocolClients {
  const chain = { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil;
  const pub = createPublicClient({
    chain,
    transport: http(rpcUrl(), { retryCount: 0, timeout: 30_000 }),
  });
  const rw = (account: PrivateKeyAccount): ReadWriteClient =>
    createWalletClient({
      account,
      chain,
      transport: http(rpcUrl(), { retryCount: 0, timeout: 30_000 }),
    }).extend(publicActions);
  return {
    public: pub,
    amara: rw(amaraAccount()),
    agent: rw(agentKeyAccount()),
    watcher: rw(watcherAccount()),
  };
}

/** Deploy the full protocol, wire it, seed the pool, attach Atlas's policy. */
export async function deployProtocol(
  c: ProtocolClients,
  accounts: DeployAccounts,
): Promise<Protocol> {
  const deployArtifacts = [
    ["USDCMock", USDC_MOCK],
    ["PolicyRegistry", POLICY_REGISTRY],
    ["Blocklist", BLOCKLIST],
    ["VerdictContract", VERDICT_CONTRACT],
    ["MutualPool", MUTUAL_POOL],
    ["GuardAccount", GUARD_ACCOUNT],
  ] as const;
  const missingBytecode = deployArtifacts
    .filter(([, artifact]) => artifact.bytecode.object === "0x")
    .map(([name]) => name);
  if (missingBytecode.length)
    throw new Error(
      `fresh demo deployment requires Foundry bytecode artifacts for ${missingBytecode.join(
        ", ",
      )}; run forge build before starting a new testnet run`,
    );
  const deployer = c.amara;
  const amaraAddr = accounts.amara.address;

  // --- Deploy (bytecode lives in the forge artifacts). ---
  const usdcAddr = await deployContract(
    deployer,
    USDC_MOCK.abi,
    USDC_MOCK.bytecode.object,
    [],
  );
  const registryAddr = await deployContract(
    deployer,
    POLICY_REGISTRY.abi,
    POLICY_REGISTRY.bytecode.object,
    [],
  );
  const blocklistAddr = await deployContract(
    deployer,
    BLOCKLIST.abi,
    BLOCKLIST.bytecode.object,
    [],
  );
  const verdictsAddr = await deployContract(
    deployer,
    VERDICT_CONTRACT.abi,
    VERDICT_CONTRACT.bytecode.object,
    [registryAddr, blocklistAddr],
  );
  const poolAddr = await deployContract(
    deployer,
    MUTUAL_POOL.abi,
    MUTUAL_POOL.bytecode.object,
    [usdcAddr, amaraAddr],
  );
  const guardAddr = await deployContract(
    deployer,
    GUARD_ACCOUNT.abi,
    GUARD_ACCOUNT.bytecode.object,
    [
      amaraAddr,
      agentKeyAccount().address,
      registryAddr,
      blocklistAddr,
      usdcAddr,
    ],
  );

  // --- Wire. ---
  await tx(deployer, verdictsAddr, VERDICT_CONTRACT.abi, "setWatcher", [
    watcherAccount().address,
  ]);
  await tx(deployer, verdictsAddr, VERDICT_CONTRACT.abi, "setPool", [poolAddr]);
  await tx(deployer, poolAddr, MUTUAL_POOL.abi, "setVerdictContract", [
    verdictsAddr,
  ]);
  await tx(deployer, blocklistAddr, BLOCKLIST.abi, "setReporter", [
    verdictsAddr,
    true,
  ]);
  await tx(deployer, guardAddr, GUARD_ACCOUNT.abi, "setVerdictContract", [
    verdictsAddr,
  ]);

  // --- Fund. ---
  await tx(deployer, usdcAddr, USDC_MOCK.abi, "mint", [
    guardAddr,
    parseUnits("4000", 6),
  ]);
  await tx(deployer, usdcAddr, USDC_MOCK.abi, "mint", [
    accounts.ravi.address,
    parseUnits("20000", 6),
  ]);
  await tx(deployer, usdcAddr, USDC_MOCK.abi, "mint", [
    accounts.senior.address,
    parseUnits("25000", 6),
  ]);
  const ravi = asRw(accounts.ravi);
  const senior = asRw(accounts.senior);
  await tx(ravi, usdcAddr, USDC_MOCK.abi, "approve", [poolAddr, MAX_UINT256]);
  await tx(ravi, poolAddr, MUTUAL_POOL.abi, "deposit", [
    1,
    parseUnits("20000", 6),
  ]);
  await tx(senior, usdcAddr, USDC_MOCK.abi, "approve", [poolAddr, MAX_UINT256]);
  await tx(senior, poolAddr, MUTUAL_POOL.abi, "deposit", [
    0,
    parseUnits("25000", 6),
  ]);

  // --- Attach policy v1 (single source: the engine-typed Policy, converted
  //     to the on-chain shape by toOnChainPolicy — no hand-duplicated
  //     literals; review H5). ---
  const policy: Policy = {
    version: 1,
    agent: guardAddr,
    owner: amaraAddr,
    coverageCap: parseUnits("2500", 6),
    deductibleBps: 1000,
    perTxLimit: parseUnits("200", 6),
    dailyLimit: parseUnits("1000", 6),
    velocityLimit: 5,
    allowlist: [
      { recipient: ALICE as `0x${string}`, cap: parseUnits("200", 6) },
      { recipient: BOB as `0x${string}`, cap: parseUnits("400", 6) },
    ],
    curfewStartMinute: 1440, // NO_CURFEW
    curfewEndMinute: 1440,
    holdWindowSec: 120,
    sdkInstalled: true,
  };
  await tx(deployer, registryAddr, POLICY_REGISTRY.abi, "attach", [
    guardAddr,
    toOnChainPolicy(policy),
  ]);

  // --- Contract handles. ---
  const handle = <TAbi extends Abi>(
    address: Address,
    abi: TAbi,
  ): Contract<TAbi> =>
    getContract({
      address,
      abi,
      client: { public: c.public, wallet: c.amara },
    });

  return {
    usdc: handle(usdcAddr, USDC_MOCK.abi),
    registry: handle(registryAddr, POLICY_REGISTRY.abi),
    guard: handle(guardAddr, GUARD_ACCOUNT.abi),
    verdicts: handle(verdictsAddr, VERDICT_CONTRACT.abi),
    pool: handle(poolAddr, MUTUAL_POOL.abi),
    blocklist: handle(blocklistAddr, BLOCKLIST.abi),
    policy,
  };
}

/**
 * Attach to a PRE-DEPLOYED stack (Deploy.s.sol → deployments/<chainId>.json).
 * Reads the live on-chain policy (source of truth) back into the engine's
 * Policy form — so attach and fresh-deploy produce identical demo inputs.
 */
export async function attachProtocol(
  c: ProtocolClients,
  record: DeploymentRecord,
): Promise<Protocol> {
  const a = record.contracts;
  const handle = (address: Address, abi: Abi): Contract<Abi> =>
    getContract({
      address,
      abi,
      client: { public: c.public, wallet: c.amara },
    });
  const registry = handle(a.policyRegistry, POLICY_REGISTRY.abi);
  const guard = handle(a.guardAccount, GUARD_ACCOUNT.abi);

  // The artifact ABI is dynamic; describe the policy tuple at its read boundary.
  type RawPolicy = {
    version: bigint;
    agent: Address;
    owner: Address;
    coverageCap: bigint;
    deductibleBps: bigint;
    perTxLimit: bigint;
    dailyLimit: bigint;
    velocityLimit: bigint;
    allowlist: readonly { recipient: Address; cap: bigint }[];
    curfewStart: bigint;
    curfewEnd: bigint;
    holdWindowSec: bigint;
    sdkInstalled: boolean;
  };
  const version = (await registry.read.latestVersion!([
    a.guardAccount as Address,
  ]))!;
  if (version === 0n) {
    throw new Error(
      `no policy attached to guard ${a.guardAccount} on chain ${record.chainId} — ` +
        `rerun: cd contracts && forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast`,
    );
  }
  const p = (await registry.read.getPolicy!([a.guardAccount])) as RawPolicy;
  const policy: Policy = {
    version: Number(p.version),
    agent: p.agent,
    owner: p.owner,
    coverageCap: p.coverageCap,
    deductibleBps: Number(p.deductibleBps),
    perTxLimit: p.perTxLimit,
    dailyLimit: p.dailyLimit,
    velocityLimit: Number(p.velocityLimit),
    allowlist: p.allowlist.map((r) => ({ recipient: r.recipient, cap: r.cap })),
    curfewStartMinute: Number(p.curfewStart),
    curfewEndMinute: Number(p.curfewEnd),
    holdWindowSec: Number(p.holdWindowSec),
    sdkInstalled: p.sdkInstalled,
  };
  return {
    usdc: handle(a.usdc, USDC_MOCK.abi),
    registry,
    guard,
    verdicts: handle(a.verdicts, VERDICT_CONTRACT.abi),
    pool: handle(a.mutualPool, MUTUAL_POOL.abi),
    blocklist: handle(a.blocklist, BLOCKLIST.abi),
    policy,
  };
}

/** Submit a signed COVERED verdict; the pool pays the claimant same tx. */
export async function submitCoveredVerdict(
  p: Protocol,
  c: ProtocolClients,
  claim: { txHash: string; destination: string; loss: bigint; payout: bigint },
): Promise<TransactionReceipt> {
  // EIP-712 domain-bound digest: the watcher signs the typed digest for THIS
  // VerdictContract deployment (chainid + address). Mirrors
  // VerdictContract.verdictDigest712 exactly.
  const policyHash = (await p.registry.read.policyHashAt!([
    p.policy.agent,
    p.policy.version,
  ])) as Hash;
  const timestamp = (await c.public.getBlock()).timestamp; // chain clock: freshness window is chain-relative
  const reasons: Array<{
    tag: `0x${string}`;
    provenance: number;
    detail: string;
  }> = [];
  const digest = verdictDigest712(p.verdicts.address, {
    policyHash,
    agent: p.policy.agent,
    claimant: p.policy.owner,
    txHash: claim.txHash as `0x${string}`,
    destination: claim.destination as `0x${string}`,
    lossAmount: claim.loss,
    payoutAmount: claim.payout,
    alibi: 1, // EXTERNAL
    outcome: 1, // COVERED
    reasons,
    timestamp,
  });
  // Raw ECDSA over the typed digest (no EIP-191 wrapper — matches the
  // contract's ecrecover(digest, v, r, s)).
  const watcher = watcherAccount();
  const signature = signRawDigest(digest, requiredKey("WATCHER_PRIVATE_KEY"));

  const hash = await c.watcher.writeContract({
    address: p.verdicts.address,
    abi: VERDICT_CONTRACT.abi,
    functionName: "submitVerdict",
    args: [
      {
        policyHash,
        agent: p.policy.agent,
        claimant: p.policy.owner,
        txHash: claim.txHash as `0x${string}`,
        destination: claim.destination as `0x${string}`,
        lossAmount: claim.loss,
        payoutAmount: claim.payout,
        alibi: 1,
        outcome: 1,
        reasons,
        timestamp,
      },
      signature,
    ],
    chain: { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil,
    account: watcher,
  });
  return confirmedReceipt(
    c.public,
    hash,
    "Covered verdict and pool payout",
    "recovery",
  );
}

/** Submit a signed hold verdict (clean=0 / suspicious=1) via VerdictContract. */
export async function submitHoldVerdict(
  p: Protocol,
  c: ProtocolClients,
  holdId: bigint,
  tier: 0 | 1,
): Promise<TransactionReceipt> {
  const policyHash = (await p.registry.read.policyHashAt!([
    p.policy.agent,
    p.policy.version,
  ])) as Hash;
  // EIP-712 over this deployment's domain (mirrors holdVerdictDigest712).
  const digest = holdVerdictDigest712(
    p.verdicts.address,
    holdId,
    p.policy.agent,
    policyHash,
    tier,
  );
  // Raw ECDSA over the typed digest (matches ecrecover on-chain).
  const watcher = watcherAccount();
  const signature = signRawDigest(digest, requiredKey("WATCHER_PRIVATE_KEY"));
  const hash = await c.watcher.writeContract({
    address: p.verdicts.address,
    abi: VERDICT_CONTRACT.abi,
    functionName: "submitHoldVerdict",
    args: [holdId, p.policy.agent, policyHash, tier, signature],
    chain: { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil,
    account: watcher,
  });
  return confirmedReceipt(
    c.public,
    hash,
    tier === 0
      ? "Controlled watcher clean release"
      : "Watcher suspicious hold freeze",
    tier === 0 ? "recovery" : "containment",
  );
}

// ------------------------------------------------------------------ //
//                        Internals                                   //
// ------------------------------------------------------------------ //

// ------------------------------------------------------------------ //
//                     EIP-712 digest mirroring                       //
// ------------------------------------------------------------------ //

/**
 * Keccak of the EIP-712 domain, mirroring VerdictContract's constructor.
 * The chain ID is an explicit argument — the caller resolves it from
 * DEMO_CHAIN_ID (env) so a digest is always bound to the chain the target
 * contract is actually deployed on. Never hardcode a chain ID here: the
 * on-chain DOMAIN_SEPARATOR embeds block.chainid, and a mismatched domain
 * makes every signature fail on-chain ecrecover (H2 replay protection).
 */
export function domainSeparator(
  verifyingContract: `0x${string}`,
  chainId: bigint,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "nameHash", type: "bytes32" },
        { name: "versionHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
        { name: "salt", type: "bytes32" },
      ],
      [
        // Every slot is keccak(string) — toHexBytes IS that keccak. The old
        // code wrapped slots in another keccak256 (double-hash), silently
        // breaking every demo signature against the contract.
        toHexBytes(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)",
        ),
        toHexBytes("BULWARK VerdictContract"),
        toHexBytes("1"),
        chainId,
        verifyingContract,
        toHexBytes("BULWARK.verdict-domain.v1"),
      ],
    ),
  );
}

function toHexBytes(text: string): `0x${string}` {
  // keccak256 of UTF-8 text — viem's keccak256 accepts a string and encodes
  // it as UTF-8 bytes (toBytes semantics).
  return keccak256(toBytes(text));
}

/** Mirrors VerdictContract.verdictDigest712 (reasons hashed struct-wise). */
export function verdictDigest712(
  verifyingContract: `0x${string}`,
  v: {
    policyHash: `0x${string}`;
    agent: `0x${string}`;
    claimant: `0x${string}`;
    txHash: `0x${string}`;
    destination: `0x${string}`;
    lossAmount: bigint;
    payoutAmount: bigint;
    alibi: number;
    outcome: number;
    reasons: ReadonlyArray<{
      tag: `0x${string}`;
      provenance: number;
      detail: string;
    }>;
    timestamp: bigint;
  },
  chainId: bigint = BigInt(DEMO_CHAIN_ID),
): `0x${string}` {
  const reasonTypeHash = keccak256(
    toBytes("Reason(bytes4 tag,uint8 provenance,string detail)"),
  );
  const verdictTypeHash = keccak256(
    toBytes(
      "Verdict(bytes32 policyHash,address agent,address claimant,bytes32 txHash,address destination,uint96 lossAmount,uint96 payoutAmount,uint8 alibi,uint8 outcome,Reason[] reasons,uint64 timestamp)Reason(bytes4 tag,uint8 provenance,string detail)",
    ),
  );
  const reasonHashes = v.reasons.map((r) =>
    keccak256(
      encodeAbiParameters(
        [
          { name: "tag", type: "bytes4" },
          { name: "provenance", type: "uint8" },
          { name: "detail", type: "string" },
        ],
        [r.tag, r.provenance, r.detail],
      ),
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "policyHash", type: "bytes32" },
        { name: "agent", type: "address" },
        { name: "claimant", type: "address" },
        { name: "txHash", type: "bytes32" },
        { name: "destination", type: "address" },
        { name: "lossAmount", type: "uint96" },
        { name: "payoutAmount", type: "uint96" },
        { name: "alibi", type: "uint8" },
        { name: "outcome", type: "uint8" },
        { name: "reasonsHash", type: "bytes32" },
        { name: "timestamp", type: "uint64" },
      ],
      [
        verdictTypeHash,
        v.policyHash,
        v.agent,
        v.claimant,
        v.txHash,
        v.destination,
        v.lossAmount,
        v.payoutAmount,
        v.alibi,
        v.outcome,
        keccak256(concatHexBytes(reasonHashes)),
        v.timestamp,
      ],
    ),
  );
  return keccak256(
    concatHexBytes([
      "0x1901",
      domainSeparator(verifyingContract, chainId),
      structHash,
    ]),
  );
}

/** Mirrors VerdictContract.holdVerdictDigest712. */
function holdVerdictDigest712(
  verifyingContract: `0x${string}`,
  holdId: bigint,
  agent: `0x${string}`,
  policyHash: `0x${string}`,
  tier: number,
  chainId: bigint = BigInt(DEMO_CHAIN_ID),
): `0x${string}` {
  const typeHash = keccak256(
    toBytes(
      "HoldVerdict(uint256 holdId,address agent,bytes32 policyHash,uint8 tier)",
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "holdId", type: "uint256" },
        { name: "agent", type: "address" },
        { name: "policyHash", type: "bytes32" },
        { name: "tier", type: "uint8" },
      ],
      [typeHash, holdId, agent, policyHash, tier],
    ),
  );
  return keccak256(
    concatHexBytes([
      "0x1901",
      domainSeparator(verifyingContract, chainId),
      structHash,
    ]),
  );
}

function concatHexBytes(parts: ReadonlyArray<`0x${string}`>): `0x${string}` {
  return ("0x" + parts.map((p) => p.slice(2)).join("")) as `0x${string}`;
}
function asRw(account: PrivateKeyAccount): ReadWriteClient {
  const chain = { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil;
  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl(), { retryCount: 0, timeout: 30_000 }),
  }).extend(publicActions);
}
async function deployContract(
  client: ReadWriteClient,
  abi: Abi,
  bytecode: string,
  args: readonly unknown[],
): Promise<Address> {
  const chain = { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil;
  const hash = await client.deployContract({
    abi,
    bytecode: bytecode as `0x${string}`,
    args: args as never[],
    account: client.account,
    chain,
  });
  const receipt = await confirmedReceipt(
    client,
    hash,
    "Deploy protocol contract",
    "deploying",
  );
  if (!receipt.contractAddress)
    throw new Error("deploy failed: no contract address");
  return receipt.contractAddress;
}
async function tx(
  client: ReadWriteClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): Promise<TransactionReceipt> {
  const chain = { ...anvil, id: DEMO_CHAIN_ID } as typeof anvil;
  const hash = await client.writeContract({
    address,
    abi,
    functionName,
    args: args as never[],
    account: client.account,
    chain,
  });
  return confirmedReceipt(
    client,
    hash,
    `${functionName} · ${address}`,
    "deploying",
  );
}

/** Record the exact mined receipt before rejecting an unexpected status. */
export async function confirmedReceipt(
  client: Pick<PublicClient, "waitForTransactionReceipt" | "getBlock">,
  hash: Hash,
  label: string,
  phase: RunPhase,
  expectedStatus: "success" | "reverted" = "success",
): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  publishTransaction({
    hash: receipt.transactionHash,
    label,
    phase,
    blockNumber: Number(receipt.blockNumber),
    timestamp: Number(block.timestamp),
    status: receipt.status,
  });
  if (receipt.status !== expectedStatus)
    throw new Error(
      `${label}: expected ${expectedStatus}, receipt is ${receipt.status} (${hash})`,
    );
  return receipt;
}

/**
 * Raw ECDSA (secp256k1) over a 32-byte digest — r ‖ s ‖ v, v ∈ {27, 28}.
 * Matches the on-chain `_recoverSigner`, which calls ecrecover directly on
 * the EIP-712 typed digest (no EIP-191 "Ethereum Signed Message" prefix).
 */
export function signRawDigest(
  digest: `0x${string}`,
  privateKey: `0x${string}`,
): `0x${string}` {
  const sig = secp256k1.sign(toBytes(digest), toBytes(privateKey));
  const v = sig.recovery + 27;
  return `0x${sig.r.toString(16).padStart(64, "0")}${sig.s
    .toString(16)
    .padStart(64, "0")}${v.toString(16).padStart(2, "0")}` as `0x${string}`;
}
