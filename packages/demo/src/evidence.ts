import {
  BaseError,
  ContractFunctionRevertedError,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type TransactionReceipt,
} from "viem";

export const OVER_PER_TX_TAG = keccak256(toBytes("OVER_PER_TX")).slice(0, 10);

export function requireEvidence(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Evidence check failed: ${message}`);
}

/** Match the decoded custom error, never transport text or a generic revert. */
export function isPerTxViolation(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const reverted = error.walk(
    (cause) => cause instanceof ContractFunctionRevertedError,
  );
  if (!(reverted instanceof ContractFunctionRevertedError)) return false;
  return (
    reverted.data?.errorName === "Violation" &&
    reverted.data.args?.[0] === OVER_PER_TX_TAG
  );
}

/** Only logs emitted by the expected contract may establish a scenario fact. */
export function receiptEvent(
  receipt: TransactionReceipt,
  address: Address,
  abi: Abi,
  eventName: string,
): Record<string, unknown> {
  requireEvidence(
    receipt.status === "success",
    `${eventName} requires a successful receipt`,
  );
  const logs = parseEventLogs({
    abi,
    eventName,
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === address.toLowerCase(),
    ),
    strict: true,
  });
  requireEvidence(
    logs.length === 1,
    `expected exactly one ${eventName} from ${address}, received ${logs.length}`,
  );
  return logs[0]!.args as Record<string, unknown>;
}

export function requireTransfer(
  receipt: TransactionReceipt,
  token: Address,
  from: Address,
  to: Address,
  amount: bigint,
  abi: Abi,
): void {
  const transfers = parseEventLogs({
    abi,
    eventName: "Transfer",
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === token.toLowerCase(),
    ),
    strict: true,
  });
  const matching = transfers.filter((event) => {
    const args = event.args as { from: Address; to: Address; value: bigint };
    return (
      args.from.toLowerCase() === from.toLowerCase() &&
      args.to.toLowerCase() === to.toLowerCase() &&
      args.value === amount
    );
  });
  requireEvidence(
    receipt.status === "success" && matching.length === 1,
    `receipt must transfer exactly ${amount} token units from ${from} to ${to}`,
  );
}
