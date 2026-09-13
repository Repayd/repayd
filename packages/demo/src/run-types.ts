import type { DeploymentRecord } from "../../api/src/deployment.ts";

export type RunPhase =
  | "preflight"
  | "deploying"
  | "payroll"
  | "containment"
  | "blocked"
  | "recovery"
  | "provenance"
  | "complete";
export type RunStatus = "running" | "completed" | "failed" | "interrupted";
export type EvidenceSource = "chain" | "local" | "system";

export interface DemoEvent {
  readonly t: number;
  readonly kind: "info" | "ok" | "warn" | "bad" | "payout" | "title";
  readonly tag?: string;
  readonly title?: string;
  readonly text: string;
  readonly why?: string;
  readonly phase?: RunPhase;
  readonly source?: EvidenceSource;
  readonly txHash?: `0x${string}`;
  readonly blockNumber?: number;
  readonly verified?: boolean;
  readonly viz?: {
    readonly balances?: Record<string, number>;
    readonly tx?: {
      readonly lane: "routine" | "elevated" | "violation" | "payout";
      readonly from: string;
      readonly to: string;
      readonly amount: number;
      readonly label?: string;
    };
    readonly pool?: { readonly junior: number; readonly senior: number };
    readonly flash?:
      | "routine"
      | "elevated"
      | "violation"
      | "payout"
      | "watcher";
  };
}

export interface StoredDemoEvent extends DemoEvent {
  readonly seq: number;
  readonly emittedAt: number;
}

export interface RunTransaction {
  readonly hash: `0x${string}`;
  readonly label: string;
  readonly phase: RunPhase;
  readonly blockNumber: number;
  /** Block timestamp, in Unix seconds. */
  readonly timestamp: number;
  readonly status: "success" | "reverted";
}

export interface DemoCheck {
  readonly name:
    | "payroll"
    | "containment"
    | "policy-block"
    | "loss"
    | "payout"
    | "provenance";
  readonly passed: boolean;
  readonly detail: string;
  readonly txHash?: `0x${string}`;
}

export interface DemoResult {
  readonly version: 1;
  readonly verified: true;
  readonly runId: string;
  readonly chainId: number;
  readonly guard: `0x${string}`;
  readonly usdc: `0x${string}`;
  readonly checks: readonly DemoCheck[];
  readonly balances: Record<string, number>;
  readonly pool: { readonly junior: number; readonly senior: number };
  readonly txHashes: readonly `0x${string}`[];
  readonly startBlock: number;
  readonly endBlock: number;
}

export interface RunSummary {
  readonly id: string;
  readonly label: string;
  readonly chainId: number;
  readonly status: RunStatus;
  readonly phase: RunPhase;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly error?: string;
  readonly guard?: `0x${string}`;
}

export interface DemoRun extends RunSummary {
  readonly updatedAt: number;
  readonly heartbeatAt: number;
  readonly progress: number;
  readonly deployment?: DeploymentRecord;
  readonly startBlock?: number;
  readonly endBlock?: number;
  readonly events: readonly StoredDemoEvent[];
  readonly transactions: readonly RunTransaction[];
  readonly result?: DemoResult;
  readonly logTail: readonly string[];
}

export interface DemoState {
  readonly activeRunId: string | null;
  readonly selectedRunId: string | null;
  readonly run: DemoRun | null;
  readonly runs: readonly RunSummary[];
  readonly environment: {
    readonly chainId: number;
    readonly network: string;
    readonly explorerUrl: string;
    readonly token: string;
    readonly watcher: string;
  };
}

export const DEMO_EVENT_MARKER = "@@DEMO_EVENT@";
export const DEMO_TX_MARKER = "@@DEMO_TX@";
export const DEMO_DEPLOYMENT_MARKER = "@@DEMO_DEPLOYMENT@";
export const DEMO_RESULT_MARKER = "@@DEMO_RESULT@";
export const ARC_CHAIN_ID = 5042002;
export const ARC_EXPLORER = "https://testnet.arcscan.app";
