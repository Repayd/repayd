import {
  DEMO_EVENT_MARKER,
  DEMO_TX_MARKER,
  DEMO_DEPLOYMENT_MARKER,
  DEMO_RESULT_MARKER,
  type DemoEvent,
  type DemoResult,
  type RunTransaction,
} from "./run-types.ts";
import type { DeploymentRecord } from "@repayd/api/src/deployment.ts";

export type { DemoEvent } from "./run-types.ts";

type Listener = (event: DemoEvent) => void;
const listeners = new Set<Listener>();
let history: DemoEvent[] = [];
let transactions: RunTransaction[] = [];
let demoRunning = false;
let resultPublished = false;

/** Stdout is the only transport. The parent owns execution and persistence. */
export function publish(event: DemoEvent): void {
  if (!demoRunning) return;
  process.stdout.write(`${DEMO_EVENT_MARKER}${JSON.stringify(event)}\n`);
  history.push(event);
  for (const listener of listeners) listener(event);
}

export function publishTransaction(transaction: RunTransaction): void {
  if (!demoRunning) return;
  if (transactions.some((item) => item.hash === transaction.hash)) return;
  process.stdout.write(`${DEMO_TX_MARKER}${JSON.stringify(transaction)}\n`);
  transactions.push(transaction);
}

export function publishDeployment(
  deployment: DeploymentRecord,
  startBlock: number,
): void {
  if (!demoRunning) throw new Error("No active demo for deployment evidence");
  process.stdout.write(
    `${DEMO_DEPLOYMENT_MARKER}${JSON.stringify({ deployment, startBlock })}\n`,
  );
}

export function publishResult(result: DemoResult): void {
  if (!demoRunning || resultPublished)
    throw new Error("Demo result may be published only once per run");
  const required = [
    "payroll",
    "containment",
    "policy-block",
    "loss",
    "payout",
    "provenance",
  ];
  if (
    result.checks.length !== required.length ||
    !required.every(
      (name) =>
        result.checks.filter((check) => check.name === name && check.passed)
          .length === 1,
    )
  ) {
    throw new Error("Demo result requires all six distinct passed checks");
  }
  if (
    result.txHashes.length !== transactions.length ||
    !transactions.every((tx) => result.txHashes.includes(tx.hash))
  ) {
    throw new Error("Demo result must include every confirmed run transaction");
  }
  process.stdout.write(`${DEMO_RESULT_MARKER}${JSON.stringify(result)}\n`);
  resultPublished = true;
}

export function startDemo(): void {
  if (demoRunning) throw new Error("Demo already running");
  history = [];
  transactions = [];
  resultPublished = false;
  demoRunning = true;
}

/** Stopping a process is not evidence that its scenarios succeeded. */
export function endDemo(): void {
  demoRunning = false;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHistory(): readonly DemoEvent[] {
  return history;
}

export function getTransactions(): readonly RunTransaction[] {
  return transactions;
}

export function isRunning(): boolean {
  return demoRunning;
}
