import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { DeploymentRecord } from "@repayd/api/src/deployment.ts";
import { ERC8004_ADDRESSES } from "../../sdk/src/erc8004/addresses.ts";
import { ARC_CHAIN_ID } from "./run-types.ts";
import {
  confirmedReceipt,
  DEMO_CHAIN_ID,
  requiredKey,
  type DeployAccounts,
  type Protocol,
  type ProtocolClients,
} from "./protocol.ts";

export function deploymentAccounts(): DeployAccounts {
  return {
    amara: privateKeyToAccount(requiredKey("AMARA_PRIVATE_KEY")),
    ravi: privateKeyToAccount(requiredKey("RAVI_PRIVATE_KEY")),
    senior: privateKeyToAccount(requiredKey("SENIOR_PRIVATE_KEY")),
  };
}

/** Fund only the existing signing roles, once, after reserving the full budget. */
export async function preflight(
  c: ProtocolClients,
  accounts: Pick<DeployAccounts, "amara"> & Partial<DeployAccounts>,
  fresh: boolean,
): Promise<void> {
  const chainId = await c.public.getChainId();
  if (chainId !== DEMO_CHAIN_ID)
    throw new Error(
      `RPC chain ${chainId} does not match DEMO_CHAIN_ID ${DEMO_CHAIN_ID}`,
    );
  if (fresh && chainId !== ARC_CHAIN_ID)
    throw new Error(
      `Fresh dashboard runs require Arc testnet (${ARC_CHAIN_ID})`,
    );
  const roles = [
    {
      name: "agent session key",
      address: c.agent.account!.address,
      gas: 2_500_000n,
    },
    {
      name: "local watcher",
      address: c.watcher.account!.address,
      gas: 3_000_000n,
    },
    ...(fresh
      ? [
          { name: "junior LP", address: accounts.ravi!.address, gas: 500_000n },
          {
            name: "senior LP",
            address: accounts.senior!.address,
            gas: 500_000n,
          },
        ]
      : []),
  ];
  const addresses = [
    accounts.amara.address,
    ...roles.map((role) => role.address),
  ].map((address) => address.toLowerCase());
  if (new Set(addresses).size !== addresses.length)
    throw new Error(
      "Owner, agent, watcher and LP signing roles must use distinct existing keys",
    );
  const fees = await c.public.estimateFeesPerGas();
  const fee = fees.maxFeePerGas;
  if (!fee || fee <= 0n)
    throw new Error("RPC did not provide a positive maximum gas fee");
  const [deployerBalance, ...balances] = await Promise.all([
    c.public.getBalance({ address: accounts.amara.address }),
    ...roles.map((role) => c.public.getBalance({ address: role.address })),
  ]);
  const funding = roles.map((role, index) => ({
    ...role,
    amount:
      role.gas * fee > balances[index]!
        ? role.gas * fee - balances[index]!
        : 0n,
  }));
  const budget =
    (fresh ? 12_000_000n : 1_000_000n) * fee +
    funding.reduce(
      (sum, role) =>
        sum + role.amount + (role.amount > 0n ? 21_000n * fee : 0n),
      0n,
    );
  if (deployerBalance! < budget)
    throw new Error(
      `Amara has insufficient native gas for deployment and role top-ups; need ${formatUnits(
        budget,
        18,
      )} USDC gas (${budget} base units), available ${formatUnits(
        deployerBalance!,
        18,
      )} (${deployerBalance} base units)`,
    );
  for (const role of funding) {
    if (role.amount === 0n) continue;
    const hash = await c.amara.sendTransaction({
      account: c.amara.account!,
      chain: c.amara.chain,
      to: role.address,
      value: role.amount,
      gas: 21_000n,
      ...fees,
    });
    const receipt = await confirmedReceipt(
      c.public,
      hash,
      `Native gas funding · ${role.name}`,
      "preflight",
    );
    const funded = await c.public.getBalance({
      address: role.address,
      blockNumber: receipt.blockNumber,
    });
    if (funded < role.gas * fee)
      throw new Error(`Native gas top-up did not fund ${role.name}`);
  }
}

export function deploymentRecord(
  p: Protocol,
  accounts: DeployAccounts,
  c: ProtocolClients,
): DeploymentRecord {
  return {
    chainId: DEMO_CHAIN_ID,
    chainIdAnchor: toHex(BigInt(DEMO_CHAIN_ID), { size: 20 }),
    contracts: {
      usdc: p.usdc.address,
      policyRegistry: p.registry.address,
      blocklist: p.blocklist.address,
      verdicts: p.verdicts.address,
      mutualPool: p.pool.address,
      guardAccount: p.guard.address,
    },
    actors: {
      deployer: accounts.amara.address,
      amaraPolicyOwner: accounts.amara.address,
      agentSessionKey: c.agent.account!.address,
      watcher: c.watcher.account!.address,
      raviJunior: accounts.ravi.address,
      seniorLP: accounts.senior.address,
    },
    erc8004: {
      identity: ERC8004_ADDRESSES.identity as Address,
      reputation: ERC8004_ADDRESSES.reputation as Address,
      validation: ERC8004_ADDRESSES.validation as Address,
      note: "Canonical registry addresses only; no ERC-8004 registration or reputation transaction is performed by this run.",
    },
    seed: {
      guardBacking: "4000000000",
      juniorDeposit: "20000000000",
      seniorDeposit: "25000000000",
      mockUsdc: true,
    },
  };
}

/** Call only after all deployment, wiring, seed and policy checks passed. */
export async function persistDeployment(
  record: DeploymentRecord,
  runId: string,
): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  if (process.env.REPAYD_RUN_ID && !process.env.REPAYD_RUN_DIR)
    throw new Error("REPAYD_RUN_DIR is required for managed fresh runs");
  const runDir =
    process.env.REPAYD_RUN_DIR ?? resolve(root, ".repayd/runs", runId);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  await mkdir(runDir, { recursive: true });
  const runPending = resolve(runDir, "deployment.json.tmp");
  await writeFile(runPending, text, { mode: 0o600 });
  await rename(runPending, resolve(runDir, "deployment.json"));
  const latest = resolve(
    root,
    "contracts/deployments",
    `${record.chainId}.json`,
  );
  await mkdir(dirname(latest), { recursive: true });
  const pending = `${latest}.${process.pid}.tmp`;
  await writeFile(pending, text, { mode: 0o600 });
  await rename(pending, latest);
}
