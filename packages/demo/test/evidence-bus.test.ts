import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endDemo,
  publishResult,
  publishTransaction,
  startDemo,
} from "../src/bus.ts";
import {
  DEMO_RESULT_MARKER,
  DEMO_TX_MARKER,
  type DemoResult,
  type RunTransaction,
} from "../src/run-types.ts";

const transaction: RunTransaction = {
  hash: `0x${"ab".repeat(32)}`,
  label: "Confirmed transfer",
  phase: "payroll",
  blockNumber: 42,
  timestamp: 1_700_000_000,
  status: "success",
};
const result: DemoResult = {
  version: 1,
  verified: true,
  runId: "isolated-test",
  chainId: 5042002,
  guard: "0x1111111111111111111111111111111111111111",
  usdc: "0x2222222222222222222222222222222222222222",
  checks: [
    "payroll",
    "containment",
    "policy-block",
    "loss",
    "payout",
    "provenance",
  ].map((name) => ({
    name: name as DemoResult["checks"][number]["name"],
    passed: true,
    detail: "Verified test evidence",
    txHash: transaction.hash,
  })),
  balances: { GuardAccount: 3050, Amara: 135, "0xFresh": 0, "0xA1ice": 150 },
  pool: { junior: 19865, senior: 25000 },
  txHashes: [transaction.hash],
  startBlock: 42,
  endBlock: 42,
};

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  startDemo();
});
afterEach(() => {
  endDemo();
  vi.restoreAllMocks();
});

describe("stdout evidence lifecycle", () => {
  it("never equates stopping with successful completion", () => {
    endDemo();
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it("publishes only one result after every required distinct check and exact transaction list", () => {
    publishTransaction(transaction);
    publishTransaction(transaction);
    publishResult(result);
    expect(() => publishResult(result)).toThrow("only once");
    expect(process.stdout.write).toHaveBeenCalledTimes(2);
    expect(process.stdout.write).toHaveBeenNthCalledWith(
      1,
      `${DEMO_TX_MARKER}${JSON.stringify(transaction)}\n`,
    );
    expect(process.stdout.write).toHaveBeenNthCalledWith(
      2,
      `${DEMO_RESULT_MARKER}${JSON.stringify(result)}\n`,
    );
  });

  it("rejects missing, failed and duplicate checks without publishing completion", () => {
    publishTransaction(transaction);
    expect(() =>
      publishResult({ ...result, checks: result.checks.slice(1) }),
    ).toThrow("six distinct passed");
    expect(() =>
      publishResult({
        ...result,
        checks: result.checks.map((check) =>
          check.name === "loss" ? { ...check, passed: false } : check,
        ),
      }),
    ).toThrow("six distinct passed");
    expect(() =>
      publishResult({
        ...result,
        checks: [...result.checks.slice(1), result.checks[1]!],
      }),
    ).toThrow("six distinct passed");
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
  });

  it("does not let deployment or reverted receipts disappear from the final proof", () => {
    publishTransaction(transaction);
    const reverted: RunTransaction = {
      ...transaction,
      hash: `0x${"cd".repeat(32)}`,
      phase: "blocked",
      status: "reverted",
    };
    publishTransaction(reverted);
    expect(() => publishResult(result)).toThrow(
      "every confirmed run transaction",
    );
    publishResult({ ...result, txHashes: [transaction.hash, reverted.hash] });
    expect(process.stdout.write).toHaveBeenCalledTimes(3);
  });

  it("permits another isolated run without carrying the previous receipts", () => {
    publishTransaction(transaction);
    publishResult(result);
    endDemo();
    startDemo();
    const next: RunTransaction = {
      ...transaction,
      hash: `0x${"ef".repeat(32)}`,
    };
    publishTransaction(next);
    publishResult({ ...result, runId: "second-test", txHashes: [next.hash] });
    expect(process.stdout.write).toHaveBeenCalledTimes(4);
  });
});
