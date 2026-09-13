import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import * as viem from "viem";
import { scanFlow } from "../src/flow.ts";
import type { DeploymentRecord } from "../../api/src/deployment.ts";
import type { DemoRun, RunTransaction } from "../../demo/src/run-types.ts";

const originalViem = { ...viem };
const rpc = {
  getChainId: mock(),
  getBlockNumber: mock(),
  getTransaction: mock(),
  getTransactionReceipt: mock(),
  getBlock: mock(),
  getLogs: mock(),
  readContract: mock(),
};

mock.module("viem", () => ({
  ...originalViem,
  createPublicClient: mock(() => rpc),
}));
afterAll(() => mock.module("viem", () => originalViem));

const address = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
let testSequence = 0;
const hash = (n: number): Hex =>
  `0x${(testSequence * 100_000 + n).toString(16).padStart(64, "0")}`;
const deployment: DeploymentRecord = {
  chainId: 5042002,
  chainIdAnchor: address(90),
  contracts: {
    usdc: address(1),
    policyRegistry: address(2),
    blocklist: address(3),
    verdicts: address(4),
    mutualPool: address(5),
    guardAccount: address(6),
  },
  actors: {
    deployer: address(10),
    amaraPolicyOwner: address(10),
    agentSessionKey: address(11),
    watcher: address(12),
    raviJunior: address(13),
    seniorLP: address(14),
  },
  erc8004: {
    identity: address(20),
    reputation: address(21),
    validation: address(22),
    note: "Shared registries",
  },
  seed: {
    guardBacking: "4000",
    juniorDeposit: "20000",
    seniorDeposit: "25000",
    mockUsdc: true,
  },
};
const tokenAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const wiringAbi = parseAbi(["function setVerdictContract(address vc)"]);
const verdictAbi = parseAbi([
  "event HoldVerdictRouted(uint256 indexed holdId, address indexed agent, bool clean)",
]);

type FixtureTx = Pick<
  Transaction,
  | "hash"
  | "from"
  | "to"
  | "input"
  | "value"
  | "blockHash"
  | "blockNumber"
  | "gasPrice"
>;
type FixtureReceipt = Pick<
  TransactionReceipt,
  | "transactionHash"
  | "blockHash"
  | "blockNumber"
  | "status"
  | "contractAddress"
  | "gasUsed"
  | "effectiveGasPrice"
  | "logs"
>;
const transactions = new Map<Hex, FixtureTx>();
const receipts = new Map<Hex, FixtureReceipt>();
const blocks = new Map<Hex, { hash: Hex; number: bigint; timestamp: bigint }>();

function recorded(
  n: number,
  overrides: Partial<FixtureTx> = {},
  receiptOverrides: Partial<FixtureReceipt> = {},
): RunTransaction {
  const txHash = hash(n);
  const blockHash = hash(1000 + n);
  transactions.set(txHash, {
    hash: txHash,
    from: deployment.actors.amaraPolicyOwner,
    to: deployment.actors.watcher,
    input: "0x",
    value: 0n,
    blockHash,
    blockNumber: BigInt(n),
    gasPrice: 999n,
    ...overrides,
  });
  receipts.set(txHash, {
    transactionHash: txHash,
    blockHash,
    blockNumber: BigInt(n),
    status: "success",
    contractAddress: null,
    gasUsed: 21_000n,
    effectiveGasPrice: 2_000_000_000n,
    logs: [],
    ...receiptOverrides,
  });
  blocks.set(blockHash, {
    hash: blockHash,
    number: BigInt(n),
    timestamp: BigInt(1_700_000_000 + n),
  });
  return {
    hash: txHash,
    label: `Recorded action ${n}`,
    phase: "deploying",
    blockNumber: n,
    timestamp: 1,
    status: "success",
  };
}

function run(overrides: Partial<DemoRun> = {}): DemoRun {
  return {
    id: "run-a",
    label: "Arc run",
    chainId: 5042002,
    status: "running",
    phase: "deploying",
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_030_000,
    heartbeatAt: 1_700_000_030_000,
    progress: 10,
    deployment,
    events: [],
    transactions: [],
    logTail: [],
    ...overrides,
  };
}

function eventLog(
  n: number,
  token: Address,
  encodedTopics: (Hex | Hex[] | null)[],
  data: Hex,
): TransactionReceipt["logs"][number] {
  const [signature, ...indexed] = encodedTopics.map((topic) => {
    if (typeof topic !== "string")
      throw new Error("Receipt fixtures require scalar event topics.");
    return topic;
  });
  if (!signature)
    throw new Error("Receipt fixture requires an event signature.");
  return {
    address: token,
    topics: [signature, ...indexed],
    data,
    blockHash: hash(1000 + n),
    blockNumber: BigInt(n),
    transactionHash: hash(n),
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

beforeEach(() => {
  testSequence += 1;
  transactions.clear();
  receipts.clear();
  blocks.clear();
  rpc.getChainId.mockReset().mockResolvedValue(5042002);
  rpc.getBlockNumber.mockReset().mockResolvedValue(9_000_000n);
  rpc.getTransaction
    .mockReset()
    .mockImplementation(async ({ hash: txHash }: { hash: Hex }) => {
      const tx = transactions.get(txHash);
      if (!tx) throw new Error("transaction unavailable");
      return tx;
    });
  rpc.getTransactionReceipt
    .mockReset()
    .mockImplementation(async ({ hash: txHash }: { hash: Hex }) => {
      const receipt = receipts.get(txHash);
      if (!receipt) throw new Error("receipt unavailable");
      return receipt;
    });
  rpc.getBlock
    .mockReset()
    .mockImplementation(async ({ blockHash }: { blockHash: Hex }) => {
      const block = blocks.get(blockHash);
      if (!block) throw new Error("block unavailable");
      return block;
    });
  rpc.getLogs.mockReset().mockImplementation(async () => {
    throw new Error("Global scans are forbidden");
  });
  rpc.readContract.mockReset().mockImplementation(async () => {
    throw new Error("Live balances are forbidden");
  });
});

describe("run-scoped Flow evidence", () => {
  it("retains funding, deployment, wiring, token transfers and reverted receipts without scanning registry history", async () => {
    const funding = recorded(1, { value: 1_000_000_000_000_000_000n });
    const creation = recorded(
      2,
      { to: null, input: "0x60006000" },
      { contractAddress: deployment.contracts.guardAccount },
    );
    const wiring = recorded(3, {
      to: deployment.contracts.guardAccount,
      input: encodeFunctionData({
        abi: wiringAbi,
        functionName: "setVerdictContract",
        args: [deployment.contracts.verdicts],
      }),
    });
    const transferLog = eventLog(
      4,
      deployment.contracts.usdc,
      encodeEventTopics({
        abi: tokenAbi,
        eventName: "Transfer",
        args: { from: deployment.contracts.guardAccount, to: address(30) },
      }),
      encodeAbiParameters([{ type: "uint256" }], [180_000_000n]),
    );
    const transfer = recorded(
      4,
      {
        to: deployment.contracts.usdc,
        input: encodeFunctionData({
          abi: tokenAbi,
          functionName: "transfer",
          args: [address(30), 180_000_000n],
        }),
      },
      { logs: [transferLog] },
    );
    const reverted = recorded(
      5,
      {
        to: deployment.contracts.guardAccount,
        input: "0x12345678",
        value: 10n,
      },
      { status: "reverted" },
    );
    recorded(99, { to: deployment.erc8004.identity }); // Same registry, not in this run.

    const result = await scanFlow(
      run({
        transactions: [reverted, transfer, creation, funding, wiring, funding],
      }),
    );

    expect(result.txs.map((tx) => tx.hash)).toEqual([
      hash(1),
      hash(2),
      hash(3),
      hash(4),
      hash(5),
    ]);
    expect(result.scanned).toEqual({
      fromBlock: 1,
      toBlock: 5,
      truncated: false,
    });
    expect(result.txs[0]).toMatchObject({
      timestamp: 1_700_000_001,
      value: "1",
      gas: "0.000042",
      fromAddress: deployment.actors.amaraPolicyOwner,
      toAddress: deployment.actors.watcher,
      status: "success",
      events: [],
    });
    expect(result.txs[0]?.transfers).toEqual([
      {
        from: deployment.actors.amaraPolicyOwner,
        to: deployment.actors.watcher,
        amount: "1",
        token: "Arc native USDC",
      },
    ]);
    expect(result.txs[1]).toMatchObject({
      category: "deployment",
      toAddress: deployment.contracts.guardAccount,
    });
    expect(result.txs[2]).toMatchObject({
      category: "setup",
      fn: "setVerdictContract",
      events: [],
    });
    expect(result.txs[3]?.events[0]).toMatchObject({
      name: "Transfer",
      address: deployment.contracts.usdc,
    });
    expect(result.txs[3]?.transfers).toEqual([
      {
        from: deployment.contracts.guardAccount,
        to: address(30),
        amount: "180",
        token: deployment.contracts.usdc,
      },
    ]);
    expect(result.txs[4]).toMatchObject({
      status: "reverted",
      events: [],
      transfers: [],
    });
    expect(result.txs[4]?.plain).toContain(
      "no contract state changes or token transfers persisted",
    );
    for (const tx of result.txs)
      expect(tx.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${tx.hash}`);
    expect(rpc.getTransactionReceipt).toHaveBeenCalledTimes(5);
    expect(rpc.getLogs).not.toHaveBeenCalled();
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("reuses receipt evidence but sees appended hashes and newly recorded deployment labels", async () => {
    const funding = recorded(1);

    const early = await scanFlow(
      run({ deployment: undefined, transactions: [funding] }),
    );
    expect(early.message).toContain("Deployment is not yet recorded");
    expect(early.txs).toHaveLength(1);
    expect(early.txs[0]?.from).not.toBe("Amara (owner)");
    const later = await scanFlow(run({ transactions: [funding, recorded(2)] }));
    expect(later.txs).toHaveLength(2);
    expect(later.txs[0]?.from).toBe("Amara (owner)");
    expect(rpc.getTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(rpc.getTransaction).toHaveBeenCalledTimes(2);
    expect(rpc.getBlock).toHaveBeenCalledTimes(2);
  });

  it("returns an explicit predeployment state without querying the network or fabricating balances", async () => {
    const result = await scanFlow(run({ deployment: undefined }));
    expect(result).toMatchObject({
      runId: "run-a",
      txs: [],
      wallets: [],
      scanned: { fromBlock: 0, toBlock: 0, truncated: false },
    });
    expect(result.message).toContain("No confirmed transaction hashes");
    expect(rpc.getChainId).not.toHaveBeenCalled();
    expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it.each(["getTransaction", "getTransactionReceipt", "getBlock"] as const)(
    "rejects a %s failure instead of partial success, and retries failed evidence on the next request",
    async (method) => {
      const selected = run({ transactions: [recorded(1)] });
      rpc[method].mockImplementationOnce(async () => {
        throw new Error("temporary RPC failure");
      });

      await expect(scanFlow(selected)).rejects.toThrow(
        `Unable to load receipt evidence for recorded transaction ${hash(1)}`,
      );
      const recovered = await scanFlow(selected);
      expect(recovered.txs.map((tx) => tx.hash)).toEqual([hash(1)]);
    },
  );

  it("does not let cached evidence conceal a wrong RPC chain", async () => {
    const selected = run({ transactions: [recorded(1)] });

    await scanFlow(selected);
    rpc.getChainId.mockResolvedValueOnce(31337);
    await expect(scanFlow(selected)).rejects.toThrow(
      "Cannot read this run from Arc testnet",
    );
  });

  it("uses only the last verified snapshot or final result for historical wallet values", async () => {
    const events: DemoRun["events"] = [
      {
        t: 1,
        kind: "ok",
        text: "Confirmed balances",
        seq: 1,
        emittedAt: 1_700_000_001_000,
        verified: true,
        source: "chain",
        viz: { balances: { GuardAccount: 3200, Amara: 0 } },
      },
      {
        t: 2,
        kind: "info",
        text: "Unverified illustration",
        seq: 2,
        emittedAt: 1_700_000_002_000,
        viz: { balances: { GuardAccount: 999999 } },
      },
    ];
    const historical = run({
      status: "failed",
      events,
      endedAt: 1_700_000_003_000,
    });

    const previous = await scanFlow(historical);
    expect(previous.wallets.map((wallet) => wallet.usdc)).toEqual([3200, 0]);
    expect(previous.wallets[0]?.note).toContain("2023-11-14T22:13:21.000Z");
    expect(previous.message).toContain("Historical failed run");
    const completed = await scanFlow(
      run({
        ...historical,
        status: "completed",
        result: {
          version: 1,
          verified: true,
          runId: historical.id,
          chainId: 5042002,
          guard: deployment.contracts.guardAccount,
          usdc: deployment.contracts.usdc,
          balances: { GuardAccount: 3050, Amara: 135 },
          pool: { junior: 19865, senior: 25000 },
          txHashes: [],
          checks: [],
          startBlock: 1,
          endBlock: 20,
        },
      }),
    );
    expect(completed.wallets.map((wallet) => wallet.usdc)).toEqual([3050, 135]);
    expect(completed.wallets[0]?.address).toBe(
      deployment.contracts.guardAccount,
    );
    expect(completed.wallets[0]?.note).toContain("Verified final run snapshot");
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("reads the ABI's clean flag correctly instead of labelling a released hold as frozen", async () => {
    const log = eventLog(
      1,
      deployment.contracts.verdicts,
      encodeEventTopics({
        abi: verdictAbi,
        eventName: "HoldVerdictRouted",
        args: { holdId: 7n, agent: deployment.contracts.guardAccount },
      }),
      encodeAbiParameters([{ type: "bool" }], [true]),
    );
    const selected = run({
      transactions: [
        recorded(1, { to: deployment.contracts.verdicts }, { logs: [log] }),
      ],
    });

    const result = await scanFlow(selected);
    expect(result.txs[0]?.events[0]?.text).toContain("RELEASE (clean)");
    expect(result.txs[0]?.events[0]?.address).toBe(
      deployment.contracts.verdicts,
    );
  });

  it("retains predeployment token amounts without inventing decimals, then enriches the same cached receipt", async () => {
    const log = eventLog(
      1,
      deployment.contracts.usdc,
      encodeEventTopics({
        abi: tokenAbi,
        eventName: "Transfer",
        args: { from: address(0), to: deployment.contracts.guardAccount },
      }),
      encodeAbiParameters([{ type: "uint256" }], [4_000_000_000n]),
    );
    const tx = recorded(1, { to: deployment.contracts.usdc }, { logs: [log] });
    const early = await scanFlow(
      run({ deployment: undefined, transactions: [tx] }),
    );
    expect(early.txs[0]?.transfers[0]?.amount).toBe(
      "4000000000 base units (token decimals not recorded)",
    );
    const ready = await scanFlow(run({ transactions: [tx] }));
    expect(ready.txs[0]?.transfers[0]?.amount).toBe("4000");
    expect(rpc.getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("does not turn registry NFT transfers into USDC and keeps failed creation receipts", async () => {
    const nftAbi = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ]);
    const log = eventLog(
      1,
      deployment.erc8004.identity,
      encodeEventTopics({
        abi: nftAbi,
        eventName: "Transfer",
        args: {
          from: address(0),
          to: deployment.actors.amaraPolicyOwner,
          tokenId: 17n,
        },
      }),
      "0x",
    );
    const registry = recorded(
      1,
      { to: deployment.erc8004.identity },
      { logs: [log] },
    );
    const failedCreation = recorded(
      2,
      { to: null, input: "0x60006000" },
      { status: "reverted" },
    );
    const result = await scanFlow(
      run({ transactions: [registry, failedCreation] }),
    );
    expect(result.txs[0]?.events).toHaveLength(1);
    expect(result.txs[0]?.transfers).toEqual([]);
    expect(result.txs[1]).toMatchObject({
      status: "reverted",
      category: "deployment",
      toAddress: "",
      events: [],
      transfers: [],
    });
    expect(result.txs[1]?.explorerUrl).toBe(
      `https://testnet.arcscan.app/tx/${failedCreation.hash}`,
    );
  });
});
