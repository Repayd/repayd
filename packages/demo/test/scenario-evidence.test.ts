import { describe, expect, it } from "vitest";
import {
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  erc20Abi,
  parseAbi,
  toEventSelector,
  type Address,
  type TransactionReceipt,
} from "viem";
import {
  isPerTxViolation,
  OVER_PER_TX_TAG,
  receiptEvent,
  requireTransfer,
} from "../src/evidence.ts";

const guard: Address = "0x1111111111111111111111111111111111111111";
const recipient: Address = "0x2222222222222222222222222222222222222222";
const token: Address = "0x3333333333333333333333333333333333333333";
const abi = parseAbi([
  "error Violation(bytes4 tag)",
  "error NotAgent()",
  "event Held(uint256 indexed holdId, address indexed to, uint96 amount, uint64 releaseAt)",
]);
const hash = `0x${"ab".repeat(32)}` as const;

function receipt(
  logs: TransactionReceipt["logs"],
  status: "success" | "reverted" = "success",
): TransactionReceipt {
  return {
    transactionHash: hash,
    blockHash: hash,
    blockNumber: 12n,
    transactionIndex: 0,
    contractAddress: null,
    cumulativeGasUsed: 100_000n,
    effectiveGasPrice: 1n,
    from: guard,
    to: token,
    gasUsed: 100_000n,
    logs,
    logsBloom: "0x",
    status,
    type: "eip1559",
  };
}

const heldLog: TransactionReceipt["logs"][number] = {
  address: guard,
  topics: [
    toEventSelector("Held(uint256,address,uint96,uint64)"),
    encodeAbiParameters([{ type: "uint256" }], [17n]),
    encodeAbiParameters([{ type: "address" }], [recipient]),
  ],
  data: encodeAbiParameters(
    [{ type: "uint96" }, { type: "uint64" }],
    [150_000_000n, 1_700_000_120n],
  ),
  blockHash: hash,
  blockNumber: 12n,
  transactionHash: hash,
  transactionIndex: 0,
  logIndex: 0,
  removed: false,
};

describe("scenario proof guards", () => {
  it("recognizes only the decoded per-transfer custom error, not network failures", () => {
    const correct = new ContractFunctionRevertedError({
      abi,
      functionName: "propose",
      data: encodeErrorResult({
        abi,
        errorName: "Violation",
        args: [OVER_PER_TX_TAG as `0x${string}`],
      }),
    });
    const otherTag = new ContractFunctionRevertedError({
      abi,
      functionName: "propose",
      data: encodeErrorResult({
        abi,
        errorName: "Violation",
        args: ["0x12345678"],
      }),
    });
    const wrongRole = new ContractFunctionRevertedError({
      abi,
      functionName: "propose",
      data: encodeErrorResult({ abi, errorName: "NotAgent" }),
    });
    expect(isPerTxViolation(correct)).toBe(true);
    expect(isPerTxViolation(otherTag)).toBe(false);
    expect(isPerTxViolation(wrongRole)).toBe(false);
    expect(isPerTxViolation(new Error("RPC timeout: OVER_PER_TX"))).toBe(false);
    expect(isPerTxViolation(new Error("execution reverted"))).toBe(false);
  });

  it("derives hold identity from the receipt and refuses another contract's identical log", () => {
    expect(receiptEvent(receipt([heldLog]), guard, abi, "Held")).toMatchObject({
      holdId: 17n,
      to: recipient,
      amount: 150_000_000n,
    });
    expect(() =>
      receiptEvent(
        receipt([{ ...heldLog, address: token }]),
        guard,
        abi,
        "Held",
      ),
    ).toThrow("exactly one Held");
    expect(() =>
      receiptEvent(receipt([heldLog, heldLog]), guard, abi, "Held"),
    ).toThrow("exactly one Held");
    expect(() =>
      receiptEvent(receipt([heldLog], "reverted"), guard, abi, "Held"),
    ).toThrow("successful receipt");
  });

  it("never treats a successful hold proposal as proof of settled loss", () => {
    expect(() =>
      requireTransfer(
        receipt([heldLog]),
        token,
        guard,
        recipient,
        150_000_000n,
        erc20Abi,
      ),
    ).toThrow("must transfer exactly");
    const transferLog: TransactionReceipt["logs"][number] = {
      ...heldLog,
      address: token,
      topics: [
        toEventSelector("Transfer(address,address,uint256)"),
        encodeAbiParameters([{ type: "address" }], [guard]),
        encodeAbiParameters([{ type: "address" }], [recipient]),
      ],
      data: encodeAbiParameters([{ type: "uint256" }], [150_000_000n]),
    };
    expect(() =>
      requireTransfer(
        receipt([transferLog]),
        token,
        guard,
        recipient,
        150_000_000n,
        erc20Abi,
      ),
    ).not.toThrow();
    expect(() =>
      requireTransfer(
        receipt([transferLog]),
        token,
        guard,
        recipient,
        135_000_000n,
        erc20Abi,
      ),
    ).toThrow("must transfer exactly");
    expect(() =>
      requireTransfer(
        receipt([{ ...transferLog, address: guard }]),
        token,
        guard,
        recipient,
        150_000_000n,
        erc20Abi,
      ),
    ).toThrow("must transfer exactly");
  });
});
