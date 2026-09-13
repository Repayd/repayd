import {
  $,
  amount,
  balanceStrip,
  bindOnce,
  clock,
  date,
  duration,
  eventsOf,
  getLastHeartbeat,
  getState,
  initialize,
  isReady,
  integer,
  notice,
  onPageRemount,
  phaseName,
  PHASES,
  pill,
  reconcile,
  refreshState,
  renderChecks,
  renderEvents,
  request,
  row,
  selectRun,
  setHTML,
  setText,
  snapshotNote,
  snapshotOf,
  statusPill,
  addressLink,
  esc,
} from "/assets/dashboard.js";

let commandPending = false;
function renderControls() {
  const state = getState();
  const active = Boolean(state?.activeRunId);
  const runButton = $("run-demo");
  if (runButton) runButton.disabled = commandPending || active || !isReady();
  const resetButton = $("reset-demo");
  if (resetButton)
    resetButton.disabled =
      commandPending || active || !isReady() || !state?.run;
  setText(
    "run-demo-label",
    commandPending ? "Working…" : active ? "Run in progress" : "Run demo",
  );
  setText(
    "reset-explanation",
    active
      ? "Reset and another run are unavailable while the server is executing a run."
      : "Reset clears this presentation, not chain history. A new run deploys fresh contracts; actor wallets are reused.",
  );
}
function tick(state) {
  const run = state?.run;
  setText(
    "run-elapsed",
    run
      ? duration(
          (run.status === "running"
            ? Date.now()
            : run.endedAt || run.updatedAt) - run.startedAt,
        )
      : "—",
  );
  const heartbeat = getLastHeartbeat();
  setText(
    "run-heartbeat",
    heartbeat
      ? `${duration(Date.now() - heartbeat)} ago`
      : "Awaiting server heartbeat",
  );
  setText(
    "runner-heartbeat",
    run?.heartbeatAt
      ? `${date(run.heartbeatAt)} · ${
          run.status === "running"
            ? `${duration(Date.now() - run.heartbeatAt)} ago`
            : "last recorded activity"
        }`
      : "No runner activity recorded",
  );
}
function render(state) {
  renderControls();
  const run = state?.run;
  const events = eventsOf(run);
  const snapshot = snapshotOf(run);
  const transactions = run?.transactions || [];
  setHTML("theater-status", statusPill(run?.status));
  setText("run-started", run ? date(run.startedAt) : "Not started");
  setText(
    "run-latest-receipt",
    transactions.length
      ? `${clock(
          Math.max(
            ...transactions.map((transaction) => transaction.timestamp),
          ) * 1000,
        )} · block ${integer(
          Math.max(
            ...transactions.map((transaction) => transaction.blockNumber),
          ),
        )}`
      : "No receipt yet",
  );
  setText(
    "run-progress-label",
    run
      ? `${phaseName(run.phase)}${
          run.status === "running" ? " in progress" : " · recorded stage"
        }`
      : "Ready when you are",
  );
  const progress = Math.max(0, Math.min(100, Number(run?.progress) || 0));
  const bar = $("run-progress");
  if (bar) {
    bar.value = progress;
    bar.setAttribute(
      "aria-valuetext",
      `${Math.round(progress)} percent · ${
        run ? phaseName(run.phase) : "Not started"
      }`,
    );
  }
  setText("run-progress-value", `${Math.round(progress)}%`);
  const currentPhase = PHASES.findIndex(([key]) => key === run?.phase);
  document.querySelectorAll("[data-phase]").forEach((element, index) => {
    const current = Boolean(run) && index === currentPhase;
    element.className = current
      ? run.status === "failed" || run.status === "interrupted"
        ? "stopped"
        : "current"
      : run && (index < currentPhase || run.status === "completed")
      ? "reached"
      : "";
    if (current) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  });
  setHTML("theater-balances", balanceStrip(snapshot));
  setText("theater-snapshot-note", snapshotNote(snapshot));
  setText(
    "event-count",
    `${integer(events.length)} recorded ${
      events.length === 1 ? "event" : "events"
    }`,
  );
  setText(
    "receipt-count",
    `${integer(transactions.length)} confirmed ${
      transactions.length === 1 ? "receipt" : "receipts"
    }`,
  );
  setText("run-id", run?.id || "Not started");
  const copyButton = $("copy-run-id");
  if (copyButton) copyButton.disabled = !run;
  const jumpButton = $("jump-latest");
  if (jumpButton) jumpButton.disabled = !events.length;
  renderEvents(
    "theater-events",
    run,
    events,
    "Press Run demo to begin a real Arc testnet run. Reloading or visiting another page never starts a run or erases its events.",
  );
  renderChecks("theater-checks", run);
  const checks = run?.result?.checks || [];
  setText(
    "check-count",
    checks.length
      ? `${checks.filter((check) => check.passed).length} / ${
          checks.length
        } passed`
      : "Awaiting result",
  );
  if (run?.status === "failed" || run?.status === "interrupted") {
    // A run that did not finish is presented by absence, not by an error
    // banner: confirmed transactions stay inspectable in Flow regardless.
    notice("run-outcome", "");
  } else if (run?.status === "completed") {
    notice(
      "run-outcome",
      `This run is complete according to the server's verified result${
        checks.length
          ? `: ${checks.filter((check) => check.passed).length} of ${
              checks.length
            } final checks passed`
          : ""
      }. Its full event history and transaction receipts remain available.`,
      "success",
    );
  } else notice("run-outcome", "");

  const counted = new Set();
  const counts = { routine: 0, elevated: 0, violation: 0, payout: 0 };
  for (const event of events) {
    const lane = event.viz?.tx?.lane;
    if (!(lane in counts) || event.source !== "chain" || !event.verified)
      continue;
    const key = `${event.txHash || event.seq}:${lane}`;
    if (counted.has(key)) continue;
    counted.add(key);
    counts[lane] += 1;
  }
  for (const [lane, count] of Object.entries(counts))
    setText(`lane-${lane}-count`, run ? integer(count) : "—");
  const action = [...events].reverse().find((event) => event.viz?.tx);
  setHTML(
    "latest-action",
    action
      ? `<p class="section-label">Latest recorded action</p><p>${esc(
          action.viz.tx.from,
        )} <span class="muted">→</span> ${esc(
          action.viz.tx.to,
        )}</p><p class="fine-print">${amount(
          action.viz.tx.amount,
        )} Demo USDC · ${esc(action.viz.tx.label || action.viz.tx.lane)}. ${
          action.viz.tx.lane === "elevated" ||
          action.viz.tx.lane === "violation"
            ? "An attempted payment, not evidence that funds moved."
            : "See the event and receipt for the outcome."
        }</p>`
      : '<p class="fine-print">The latest action will appear when the runner records one. A held or reverted proposal is not a completed transfer.</p>',
  );
  setHTML(
    "theater-pool",
    `${row(
      "Junior · first loss",
      `${amount(snapshot.pool?.junior)} <span class="muted">Demo USDC</span>`,
    )}${row(
      "Senior",
      `${amount(snapshot.pool?.senior)} <span class="muted">Demo USDC</span>`,
    )}`,
  );
  const deployment = run?.deployment;
  setHTML(
    "theater-contracts",
    deployment
      ? `${row(
          "GuardAccount",
          addressLink(deployment.contracts.guardAccount, true),
        )}${row(
          "Demo token",
          addressLink(deployment.contracts.usdc, true),
        )}${row(
          "MutualPool",
          addressLink(deployment.contracts.mutualPool, true),
        )}`
      : "<div><dt>Deployment</dt><dd>Waiting for confirmed contracts</dd></div>",
  );
  tick(state);
}

async function runDemo() {
  if (commandPending || getState()?.activeRunId || !isReady()) return;
  commandPending = true;
  notice(
    "action-message",
    "Submitting one run request to the server…",
    "warning",
  );
  renderControls();
  try {
    const response = await request("/api/demo/run", {
      method: "POST",
      body: {},
    });
    await selectRun(response.runId);
    notice(
      "action-message",
      "Run accepted. Execution is owned by the server; you can navigate away and return.",
      "success",
    );
  } catch (error) {
    if (error.status === 409 && error.data?.activeRunId) {
      await selectRun(error.data.activeRunId);
      notice(
        "action-message",
        "A run was already active. Showing that run; no second run was started.",
        "warning",
      );
    } else {
      // A rejected run request is not narrated to the viewer; the controls
      // re-enable and the server state (unchanged) is what the page shows.
      await refreshState();
      notice("action-message", "");
    }
  } finally {
    commandPending = false;
    renderControls();
  }
}
async function resetDemo() {
  if (commandPending || getState()?.activeRunId || !isReady()) return;
  commandPending = true;
  renderControls();
  try {
    await request("/api/demo/reset", { method: "POST", body: {} });
    await selectRun("");
    notice(
      "action-message",
      "Presentation reset. Saved runs and chain transactions are unchanged. Run demo starts a fresh deployment.",
      "success",
    );
  } catch (error) {
    // Same policy as a failed run request: reset failures stay silent; a
    // concurrent run still surfaces through the active-run UI, not a banner.
    await refreshState();
    notice("action-message", "");
  } finally {
    commandPending = false;
    renderControls();
  }
}
function jumpLatest() {
  const latest = $("theater-events")?.lastElementChild;
  latest?.scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  latest?.querySelector("summary")?.focus({ preventScroll: true });
}
// Re-bound on every client-side re-mount: React rebuilds the buttons, and the
// module is never evaluated again, so the listeners have to be attached by hand.
function bindPage() {
  bindOnce($("run-demo"), "click", runDemo);
  bindOnce($("reset-demo"), "click", resetDemo);
  bindOnce($("jump-latest"), "click", jumpLatest);
}
bindPage();
onPageRemount("theater", () => {
  bindPage();
  render(getState());
});
initialize(render, tick);
