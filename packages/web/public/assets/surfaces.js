import {
  $,
  addressLink,
  amount,
  balanceStrip,
  date,
  esc,
  eventsOf,
  explorerLink,
  getState,
  initialize,
  integer,
  isReady,
  notice,
  payoutEvents,
  pill,
  rawAmount,
  reconcile,
  renderChecks,
  renderEvents,
  request,
  row,
  runURL,
  selectRun,
  setHTML,
  setText,
  snapshotNote,
  snapshotOf,
  sourcePill,
  statusPill,
  txLink,
  walletAddress,
} from "/assets/dashboard.js";

const page = document.body.dataset.page;
let atlasData = null;
let atlasReadAt = null;

function renderLanding(state) {
  const run = state?.run;
  setHTML(
    "landing-run-content",
    run
      ? `${statusPill(run.status)}<p><strong>${esc(run.label)}</strong> · ${esc(
          date(run.startedAt),
        )}<br>Saved on the server. Your place is not tied to this page.</p>`
      : `${pill(
          "Ready when you are",
        )}<p>No run is selected. The first transaction starts only when you press Run demo in Theater.</p>`,
  );
  // The landing page may not carry the saved-run link; treat it as optional.
  const link = $("landing-run-link");
  if (!link) return;
  link.href = runURL("/demo", run?.id);
  link.textContent = run
    ? run.status === "running"
      ? "Return to the run →"
      : "Inspect the saved run →"
    : "Explore the demo →";
}
function renderWallets(target, run, snapshot) {
  const balances = Object.entries(snapshot.balances);
  reconcile(
    target,
    balances,
    ([key]) => key,
    ([key, value]) =>
      `<div class="wallet-row"><div><span class="wallet-name">${esc(
        key,
      )}</span>${
        walletAddress(run, key)
          ? addressLink(walletAddress(run, key), true)
          : '<small class="muted">Recipient address appears in the relevant receipt</small>'
      }</div><div class="wallet-value">${amount(
        value,
      )}<small class="muted">Demo USDC</small></div></div>`,
    run?.id || "none",
  );
  if (!balances.length)
    setHTML(
      target,
      '<p class="fine-print">Balances will appear after the runner supplies a verified chain snapshot.</p>',
    );
}
function renderPolicy(target, run) {
  const policy = [...eventsOf(run)]
    .reverse()
    .find(
      (event) =>
        event.tag === "POLICY" && event.source === "chain" && event.verified,
    );
  const deployment = run?.deployment;
  setHTML(
    target,
    policy
      ? `<p class="policy-terms">${esc(
          policy.text,
        )}</p><div class="actions">${sourcePill(policy)}${
          policy.txHash ? txLink(policy.txHash, "Policy receipt ↗") : ""
        }</div>${
          policy.why ? `<p class="trust-note">${esc(policy.why)}</p>` : ""
        }${
          deployment
            ? `<dl class="ledger">${row(
                "PolicyRegistry",
                addressLink(deployment.contracts.policyRegistry),
              )}</dl>`
            : ""
        }`
      : `<p class="fine-print">${
          run
            ? "Waiting for the confirmed POLICY event. Limits are not guessed from wallet balances or an unrelated deployment."
            : "Select a run to inspect its installed policy. No policy is represented as active before confirmation."
        }</p>`,
  );
}
function renderOwner(state) {
  const run = state?.run;
  const snapshot = snapshotOf(run);
  $("owner-no-run").hidden = Boolean(run) || !isReady();
  setHTML("owner-balances", balanceStrip(snapshot));
  setText("owner-snapshot-note", snapshotNote(snapshot));
  setHTML(
    "owner-snapshot-status",
    pill(
      snapshot.final
        ? "Final verified snapshot"
        : snapshot.recordedAt
        ? "Verified chain snapshot"
        : "Awaiting chain evidence",
      snapshot.recordedAt ? "positive" : "neutral",
    ),
  );
  setHTML(
    "owner-account",
    `${row(
      "GuardAccount",
      addressLink(run?.deployment?.contracts.guardAccount),
    )}${row(
      "Policy owner",
      addressLink(run?.deployment?.actors.amaraPolicyOwner),
    )}${row(
      "Agent session key",
      addressLink(run?.deployment?.actors.agentSessionKey),
    )}${row("Demo token", addressLink(run?.deployment?.contracts.usdc))}${row(
      "Run status",
      statusPill(run?.status),
    )}`,
  );
  renderWallets("owner-wallets", run, snapshot);
  renderPolicy("owner-policy", run);
  const events = eventsOf(run).filter((event) => event.text || event.title);
  renderEvents(
    "owner-events",
    run,
    events.slice(-8).reverse(),
    "The most recent eight recorded events appear here. The complete narrative is kept in Theater.",
  );
  setText(
    "owner-events-count",
    `${Math.min(events.length, 8)} of ${integer(
      events.length,
    )} events · newest first`,
  );
  renderChecks("owner-checks", run);
  renderAtlasRelationship();
}
function renderCapital(state) {
  const run = state?.run;
  const snapshot = snapshotOf(run);
  const pool = snapshot.pool;
  const payouts = payoutEvents(run);
  const payoutTotal = payouts.reduce(
    (sum, event) => sum + event.viz.tx.amount,
    0,
  );
  const total = pool ? pool.junior + pool.senior : null;
  const share = (value) =>
    total > 0 ? `${((value / total) * 100).toFixed(2)}%` : "—";
  setHTML(
    "capital-balances",
    [
      ["Recorded pool capital", total],
      ["Junior · first loss", pool?.junior],
      ["Senior", pool?.senior],
      ["Recorded payouts", run ? payoutTotal : null],
    ]
      .map(
        ([label, value]) =>
          `<div><dt>${esc(label)}</dt><dd>${amount(
            value,
          )}<small>Demo USDC</small></dd></div>`,
      )
      .join(""),
  );
  setText("capital-snapshot-note", snapshotNote(snapshot));
  $("pool-allocation").hidden = !pool;
  if (pool) {
    $("junior-bar").style.flexGrow = Math.max(0, pool.junior);
    $("senior-bar").style.flexGrow = Math.max(0, pool.senior);
    $("pool-allocation").setAttribute(
      "aria-label",
      `Recorded pool allocation: junior ${share(pool.junior)}, senior ${share(
        pool.senior,
      )}.`,
    );
  }
  setHTML(
    "tranche-rows",
    `<tr><th scope="row">Junior</th><td>First-loss capital</td><td class="numeric">${amount(
      pool?.junior,
    )}</td><td class="numeric">${
      pool ? share(pool.junior) : "—"
    }</td></tr><tr><th scope="row">Senior</th><td>After the junior tranche</td><td class="numeric">${amount(
      pool?.senior,
    )}</td><td class="numeric">${pool ? share(pool.senior) : "—"}</td></tr>`,
  );
  setHTML(
    "capital-contracts",
    `${row(
      "MutualPool",
      addressLink(run?.deployment?.contracts.mutualPool),
    )}${row("Demo token", addressLink(run?.deployment?.contracts.usdc))}${row(
      "Junior provider",
      addressLink(run?.deployment?.actors.raviJunior),
    )}${row("Senior provider", addressLink(run?.deployment?.actors.seniorLP))}`,
  );
  setText(
    "payout-count",
    `${integer(payouts.length)} recorded ${
      payouts.length === 1 ? "payout" : "payouts"
    }`,
  );
  const coverageEvents = eventsOf(run).filter(
    (event) =>
      ["recovery", "provenance"].includes(event.phase) &&
      (event.text || event.title),
  );
  renderEvents(
    "capital-events",
    run,
    coverageEvents,
    "Covered-loss and owner-origin evidence will appear when this run reaches recovery and provenance. No historical premiums or yield are fabricated.",
  );
  $("capital-no-run").hidden = Boolean(run) || !isReady();
}
const contractLabels = {
  usdc: "Demo USDC",
  policyRegistry: "PolicyRegistry",
  blocklist: "Blocklist",
  verdicts: "VerdictContract",
  mutualPool: "MutualPool",
  guardAccount: "GuardAccount",
};
const actorLabels = {
  deployer: "Deployer",
  amaraPolicyOwner: "Policy owner · Amara",
  agentSessionKey: "Agent session key",
  watcher: "Local watcher signer",
  raviJunior: "Junior provider · Ravi",
  seniorLP: "Senior provider",
};
function renderRecord(state) {
  const run = state?.run;
  const deployment = run?.deployment;
  const snapshot = snapshotOf(run);
  $("record-no-run").hidden = Boolean(run) || !isReady();
  $("record-copy-run").disabled = !run;
  setHTML(
    "record-metadata",
    `${row(
      "Run ID",
      `<span class="mono">${esc(run?.id || "Not selected")}</span>`,
    )}${row("Status", statusPill(run?.status))}${row(
      "Network",
      esc(run ? `Arc testnet · ${run.chainId}` : "Arc testnet"),
    )}${row("Started", esc(date(run?.startedAt)))}${row(
      "Finished",
      run?.endedAt
        ? esc(date(run.endedAt))
        : run?.status === "running"
        ? "Still executing"
        : "Not recorded",
    )}${row(
      "First recorded block",
      run?.startBlock !== undefined
        ? explorerLink("block", run.startBlock, integer(run.startBlock))
        : "Not recorded",
    )}${row(
      "Last recorded block",
      run?.endBlock !== undefined
        ? explorerLink("block", run.endBlock, integer(run.endBlock))
        : "Not recorded",
    )}${row("Receipt count", run ? integer(run.transactions.length) : "—")}`,
  );
  renderChecks("record-checks", run);
  renderPolicy("record-policy", run);
  setHTML(
    "record-contracts",
    deployment
      ? Object.entries(deployment.contracts)
          .map(([key, address]) =>
            row(contractLabels[key] || key, addressLink(address)),
          )
          .join("")
      : "<div><dt>Contracts</dt><dd>Deployment not confirmed yet</dd></div>",
  );
  setHTML(
    "record-actors",
    deployment
      ? Object.entries(deployment.actors)
          .map(([key, address]) =>
            row(actorLabels[key] || key, addressLink(address)),
          )
          .join("")
      : "<div><dt>Actors</dt><dd>Not recorded yet</dd></div>",
  );
  setHTML(
    "record-registries",
    deployment
      ? `${row(
          "Chain anchor address",
          addressLink(deployment.chainIdAnchor),
        )}${["identity", "reputation", "validation"]
          .map((key) =>
            row(
              `${key} registry reference`,
              addressLink(deployment.erc8004?.[key]),
            ),
          )
          .join("")}`
      : "<div><dt>Registry references</dt><dd>No deployment selected</dd></div>",
  );
  renderWallets("record-wallets", run, snapshot);
  setText("record-snapshot-note", snapshotNote(snapshot));
  const evidence = eventsOf(run).filter((event) => event.text || event.title);
  renderEvents(
    "record-events",
    run,
    evidence,
    "This ledger contains only events stored with the selected run. It is not an ENS lookup, a public reputation score, or a third-party network index.",
  );
  setText("record-event-count", `${integer(evidence.length)} recorded events`);
  notice(
    "record-outcome",
    run?.error
      ? `${run.status === "interrupted" ? "Interrupted" : "Run error"}: ${
          run.error
        }. Partial receipts remain inspectable; there is no complete verified outcome.`
      : "",
    "error",
  );
}
function renderAtlasRelationship() {
  if (!atlasData) return;
  const guard = getState()?.run?.deployment?.contracts.guardAccount;
  const match =
    guard && atlasData.agent?.guard?.toLowerCase() === guard.toLowerCase();
  setText(
    "atlas-relationship",
    guard
      ? match
        ? "This latest API read matches the selected GuardAccount, but is not a historical snapshot of that run."
        : "This API response belongs to a different deployment. It does not replace the selected run's evidence."
      : "No selected deployment to compare. This read belongs to the API's currently configured deployment.",
  );
}
async function loadAtlas() {
  const button = $("refresh-atlas");
  button.disabled = true;
  setHTML("atlas-status", pill("Reading API…"));
  try {
    const result = await request("/api/atlas/overview");
    if (!result.guard?.dailyState || !result.pool || !result.agent)
      throw new Error("Invalid overview response");
    atlasData = result;
    atlasReadAt = Date.now();
    setHTML("atlas-status", pill("Latest chain read", "positive"));
    setHTML(
      "atlas-result",
      `<dl class="ledger">${row("API chain", esc(result.chainId))}${row(
        "Configured GuardAccount",
        addressLink(result.agent.guard),
      )}${row(
        "Guard token balance",
        `${rawAmount(result.guard.usdc)} Demo USDC`,
      )}${row(
        "Policy day (UTC epoch day)",
        esc(result.guard.dailyState.day),
      )}${row(
        "Daily spend",
        `${rawAmount(result.guard.dailyState.spent)} Demo USDC`,
      )}${row(
        "Daily transaction count",
        esc(result.guard.dailyState.count),
      )}${row("Next hold ID", esc(result.guard.nextHoldId))}${row(
        "Junior capital",
        `${rawAmount(result.pool.junior)} Demo USDC`,
      )}${row(
        "Senior capital",
        `${rawAmount(result.pool.senior)} Demo USDC`,
      )}${row(
        "Owner token balance",
        `${rawAmount(result.payout?.amaraUsdc)} Demo USDC`,
      )}</dl><p class="snapshot-note">Read ${esc(
        date(atlasReadAt),
      )} from /api/atlas/overview. Balances use the API's six-decimal token accounting. API identity identifiers are not treated as verified attestations.</p>`,
    );
    notice("atlas-error", "");
    renderAtlasRelationship();
  } catch (error) {
    setHTML("atlas-status", pill("Read unavailable", "warning"));
    notice(
      "atlas-error",
      `The latest-deployment API is unavailable${
        error.status ? ` (HTTP ${error.status})` : ""
      }. ${
        atlasData
          ? `The previous read from ${date(
              atlasReadAt,
            )} is retained and may be stale.`
          : "No live balance or identity claims are being substituted."
      } Selected-run evidence is independent of this integration.`,
      "warning",
    );
  } finally {
    button.disabled = false;
  }
}
async function loadCircle() {
  if (
    !window.confirm(
      "Invoke the optional Circle integration? In configured live mode this endpoint may create a wallet and execute an enabled demo spend. It is separate from the selected REPAYD run. Continue only if you intend these configured actions.",
    )
  )
    return;
  const button = $("load-circle");
  button.disabled = true;
  setHTML("circle-status", pill("Requesting integration…"));
  try {
    const circle = await request("/api/circle/agent-wallet", {
      method: "POST",
      body: {},
    });
    if (!["dry-run", "live"].includes(circle.mode))
      throw new Error("The integration did not report a recognized mode.");
    setHTML(
      "circle-status",
      pill(
        circle.mode === "dry-run"
          ? "Dry run · no Circle calls"
          : "Live API response",
        circle.mode === "dry-run" ? "warning" : "positive",
      ),
    );
    const values = [
      row("Mode", esc(circle.mode)),
      row("Circle chain", esc(circle.chain)),
    ];
    if (circle.guardAccount)
      values.push(row("Configured guard", addressLink(circle.guardAccount)));
    if (circle.guardUsdcBalance !== undefined)
      values.push(
        row(
          "Guard demo-token balance",
          `${rawAmount(circle.guardUsdcBalance)} Demo USDC`,
        ),
      );
    if (circle.walletAddress)
      values.push(row("Circle wallet", addressLink(circle.walletAddress)));
    if (circle.walletCount !== undefined)
      values.push(row("Wallets reported", esc(circle.walletCount)));
    if (circle.walletSetCount !== undefined)
      values.push(row("Wallet sets reported", esc(circle.walletSetCount)));
    if (circle.circleUsdcBalance !== undefined)
      values.push(
        row("Circle USDC balance", `${esc(circle.circleUsdcBalance)} USDC`),
      );
    if (circle.gatewayArcBalance !== undefined)
      values.push(
        row("Gateway Arc balance", `${esc(circle.gatewayArcBalance)} USDC`),
      );
    if (circle.gatewayDomains !== undefined)
      values.push(row("Gateway domains", esc(circle.gatewayDomains)));
    if (circle.demoSpend?.planned)
      values.push(
        row(
          "Demo spend",
          `Planned, not confirmed${
            circle.demoSpend.amount
              ? ` · ${esc(circle.demoSpend.amount)} USDC`
              : ""
          }`,
        ),
      );
    if (circle.demoSpend?.txId)
      values.push(
        row(
          "Demo-spend API transaction ID",
          `<span class="mono">${esc(circle.demoSpend.txId)}</span>`,
        ),
      );
    setHTML(
      "circle-result",
      `<p class="fine-print">${
        circle.mode === "dry-run"
          ? "This response describes planned Circle calls; no Circle API calls were made. The guard balance is a separate chain read."
          : "An explicitly requested Circle response. Its wallets and any configured actions are separate from this run's recorded demo-token transfers."
      }</p><dl class="ledger">${values.join("")}</dl>${
        circle.note ? `<p class="trust-note">${esc(circle.note)}</p>` : ""
      }${
        circle.plannedCalls?.length
          ? `<details class="disclosure"><summary>Planned API calls (${
              circle.plannedCalls.length
            })<span class="chevron" aria-hidden="true">›</span></summary><div class="disclosure-body">${circle.plannedCalls
              .map(
                (call) =>
                  `<div class="planned-call"><code>${esc(call.method)} ${esc(
                    call.path,
                  )}</code><p>${esc(call.note)}</p></div>`,
              )
              .join("")}</div></details>`
          : ""
      }<p class="snapshot-note">Requested ${esc(
        date(Date.now()),
      )}. No automatic refresh; another request requires confirmation.</p>`,
    );
    notice("circle-error", "");
  } catch (error) {
    setHTML("circle-status", pill("Request not confirmed", "warning"));
    notice(
      "circle-error",
      `The Circle integration request was not confirmed${
        error.status ? ` (HTTP ${error.status})` : ""
      }. A timed-out live request may still have performed configured actions. Check the integration before requesting again.`,
      "warning",
    );
  } finally {
    button.disabled = false;
  }
}
async function lookupPlatform(event) {
  event.preventDefault();
  const name = $("platform-name").value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) {
    notice(
      "platform-error",
      "Enter a platform slug using lowercase letters, numbers, and hyphens.",
    );
    return;
  }
  $("platform-submit").disabled = true;
  setHTML("platform-status", pill("Reading API…"));
  try {
    const result = await request(`/api/platforms/${encodeURIComponent(name)}`);
    setHTML(
      "platform-status",
      pill("API ledger · not chain verified", "warning"),
    );
    setHTML(
      "platform-result",
      `<dl class="ledger">${row("Platform", esc(result.platform))}${row(
        "Agents in API ledger",
        integer(result.agents),
      )}${row(
        "Recorded premium volume",
        `${rawAmount(result.premiumVolume)} USDC`,
      )}${row(
        "Revenue share",
        `${amount(Number(result.revShareBps) / 100)}%`,
      )}${row(
        "Reported monthly share",
        `${rawAmount(result.revShareMonthly)} USDC`,
      )}</dl><p class="snapshot-note">Read ${esc(
        date(Date.now()),
      )} from the existing platform API. These are API-accounting values, not receipts from the selected demo run or verified investment returns.</p>`,
    );
    notice("platform-error", "");
  } catch (error) {
    setHTML(
      "platform-status",
      pill(error.status === 404 ? "Not found" : "API unavailable", "warning"),
    );
    setHTML("platform-result", "");
    notice(
      "platform-error",
      error.status === 404
        ? `No platform named “${name}” is registered in the API ledger. Check the slug and try again.`
        : `The platform API could not be read${
            error.status ? ` (HTTP ${error.status})` : ""
          }. No premium or revenue numbers are available.`,
      "warning",
    );
  } finally {
    $("platform-submit").disabled = false;
  }
}
function lookupRun(event) {
  event.preventDefault();
  const query = $("record-lookup").value.trim().toLowerCase();
  if (!query) return;
  const state = getState();
  if (!state) {
    notice(
      "lookup-message",
      "Saved-run state is not available yet. Retry the connection before searching.",
      "warning",
    );
    return;
  }
  const matches = state.runs.filter(
    (run) =>
      run.id.toLowerCase() === query ||
      run.guard?.toLowerCase() === query ||
      run.label.toLowerCase().includes(query),
  );
  if (!matches.length) {
    setHTML("record-search-results", "");
    notice(
      "lookup-message",
      "No locally saved run matches that ID, GuardAccount address, or label. This is not an ENS resolver or a public-chain index.",
      "warning",
    );
    return;
  }
  notice(
    "lookup-message",
    `${matches.length} saved ${
      matches.length === 1 ? "run matches" : "runs match"
    }. Select a result to inspect its evidence.`,
    "success",
  );
  setHTML(
    "record-search-results",
    matches
      .map(
        (run) =>
          `<li><div><strong>${esc(
            run.label,
          )}</strong><p class="fine-print">${esc(date(run.startedAt))} · ${esc(
            run.id,
          )}</p></div><button type="button" class="button small" data-select-record="${esc(
            run.id,
          )}">View record</button></li>`,
      )
      .join(""),
  );
}

// Integration controls are optional: a page may render without them.
const refreshAtlas = $("refresh-atlas");
const loadCircleButton = $("load-circle");
if (page === "owner") {
  if (refreshAtlas && loadCircleButton) {
    refreshAtlas.addEventListener("click", loadAtlas);
    loadCircleButton.addEventListener("click", loadCircle);
    loadAtlas();
  }
}
if (page === "capital") {
  const platformForm = $("platform-form");
  if (platformForm) platformForm.addEventListener("submit", lookupPlatform);
}
if (page === "record") {
  $("record-lookup-form").addEventListener("submit", lookupRun);
  $("record-search-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-record]");
    if (button) {
      selectRun(button.dataset.selectRecord);
      notice("lookup-message", "Loading the selected saved record…", "success");
    }
  });
}
initialize((state) => {
  if (page === "landing") renderLanding(state);
  else if (page === "owner") renderOwner(state);
  else if (page === "capital") renderCapital(state);
  else if (page === "record") renderRecord(state);
});
