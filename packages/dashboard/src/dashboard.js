export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const PHASES = [
  ["preflight", "Preflight"],
  ["deploying", "Deploy"],
  ["payroll", "Payroll"],
  ["containment", "Contain"],
  ["blocked", "Block"],
  ["recovery", "Recover"],
  ["provenance", "Provenance"],
  ["complete", "Verify"],
];
export const $ = (id) => document.getElementById(id);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const short = (value, length = 8) =>
  value
    ? `${String(value).slice(0, length)}…${String(value).slice(-4)}`
    : "Not recorded";
const amounts = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const localDates = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const clockDates = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
export const amount = (value) =>
  value !== null && value !== undefined && Number.isFinite(Number(value))
    ? amounts.format(Number(value))
    : "—";
export const integer = (value) =>
  Number.isFinite(Number(value)) ? integers.format(Number(value)) : "—";
export const rawAmount = (value) =>
  value === undefined || value === null ? "—" : amount(Number(value) / 1e6);
export const date = (value) =>
  value && Number.isFinite(Number(value))
    ? localDates.format(new Date(Number(value)))
    : "Not recorded";
export const clock = (value) =>
  value && Number.isFinite(Number(value))
    ? clockDates.format(new Date(Number(value)))
    : "—";
export const iso = (value) =>
  value && Number.isFinite(Number(value))
    ? new Date(Number(value)).toISOString()
    : "";
export const duration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}h ` : ""}${Math.floor(
    (seconds % 3600) / 60,
  )}m ${String(seconds % 60).padStart(2, "0")}s`;
};
export const age = (timestamp) =>
  timestamp ? `${duration(Date.now() - timestamp)} ago` : "Not received";
export const phaseName = (phase) =>
  PHASES.find(([key]) => key === phase)?.[1] || "Waiting";
export const statusName = (status) =>
  ({
    running: "Running",
    completed: "Verified complete",
    failed: "Failed",
    interrupted: "Interrupted",
  })[status] || "Ready to run";
export const statusTone = (status) =>
  ({
    running: "warning",
    completed: "positive",
    failed: "negative",
    interrupted: "negative",
  })[status] || "neutral";
export const pill = (label, tone = "neutral") =>
  `<span class="pill ${esc(tone)}">${esc(label)}</span>`;
export const statusPill = (status) =>
  pill(statusName(status), statusTone(status));
export const row = (label, value) =>
  `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
export function setText(id, value) {
  const element = $(id);
  if (element && element.textContent !== String(value ?? ""))
    element.textContent = String(value ?? "");
}
const htmlValues = new WeakMap();
export function setHTML(target, value) {
  const element = typeof target === "string" ? $(target) : target;
  if (element && htmlValues.get(element) !== value) {
    element.innerHTML = value;
    htmlValues.set(element, value);
  }
}
export function notice(id, message, tone = "error") {
  const element = $(id);
  if (!element) return;
  element.hidden = !message;
  element.className = `notice ${tone}`;
  if (message) element.textContent = message;
}
export function storageGet(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function storageSet(key, value) {
  try {
    value === null
      ? localStorage.removeItem(key)
      : localStorage.setItem(key, value);
  } catch {
    /* Browsing without storage remains supported. */
  }
}
export function runURL(path, runId) {
  const url = new URL(path, location.origin);
  if (runId) url.searchParams.set("runId", runId);
  return url.pathname + url.search + url.hash;
}
export function explorerLink(kind, value, label, className = "address") {
  const valid =
    kind === "block"
      ? /^\d+$/.test(String(value))
      : new RegExp(
          kind === "tx" ? "^0x[0-9a-fA-F]{64}$" : "^0x[0-9a-fA-F]{40}$",
        ).test(String(value));
  if (!valid)
    return `<span class="${esc(className)}">${esc(
      label || value || "Not recorded",
    )}</span>`;
  return `<a class="${esc(
    className,
  )}" href="${ARC_EXPLORER}/${kind}/${encodeURIComponent(
    value,
  )}" target="_blank" rel="noopener noreferrer" title="Open on Arc testnet explorer (new tab)">${esc(
    label || value,
  )}<span class="sr-only"> (opens in a new tab)</span></a>`;
}
export const addressLink = (value, compact = false) =>
  explorerLink("address", value, compact && value ? short(value) : value);
export const txLink = (value, label = "View transaction on Arcscan ↗") =>
  explorerLink("tx", value, label, "button small");
export function sourcePill(event) {
  if (event.source === "chain")
    return pill(
      event.verified ? "Chain verified" : "Chain report",
      event.verified ? "positive" : "warning",
    );
  if (event.source === "local") return pill("Local evidence", "warning");
  if (event.source === "system") return pill("Runner", "neutral");
  return pill("Source unspecified", "neutral");
}
export function eventsOf(run) {
  const events = new Map();
  for (const event of run?.events || []) events.set(event.seq, event);
  return [...events.values()].sort((a, b) => a.seq - b.seq);
}
export function snapshotOf(run) {
  const snapshot = {
    balances: {},
    pool: null,
    recordedAt: null,
    block: null,
    final: false,
  };
  for (const event of eventsOf(run)) {
    if (event.source !== "chain" || event.verified !== true || !event.viz)
      continue;
    if (event.viz.balances)
      Object.assign(snapshot.balances, event.viz.balances);
    if (event.viz.pool) snapshot.pool = event.viz.pool;
    if (event.viz.balances || event.viz.pool) {
      snapshot.recordedAt = event.emittedAt;
      snapshot.block = event.blockNumber;
    }
  }
  if (run?.result?.verified === true) {
    snapshot.balances = run.result.balances;
    snapshot.pool = run.result.pool;
    snapshot.recordedAt = run.endedAt || run.updatedAt;
    snapshot.block = run.result.endBlock;
    snapshot.final = true;
  }
  return snapshot;
}
export function snapshotNote(snapshot) {
  if (!snapshot.recordedAt)
    return "Waiting for a verified balance read. Missing values are not zero balances.";
  return `${
    snapshot.final
      ? "Final verification recorded"
      : "Latest verified snapshot recorded"
  } · ${date(snapshot.recordedAt)}${
    snapshot.final && snapshot.block
      ? ` · block ${integer(snapshot.block)}`
      : ""
  }. ${
    snapshot.final
      ? "Final balances"
      : "Latest available balance and pool values"
  } for this run, not a current-wallet poll. All amounts are mintable Demo USDC.`;
}
export function balanceStrip(snapshot) {
  return [
    ["GuardAccount", "Protected wallet"],
    ["Amara", "Owner wallet"],
    ["0xFresh", "Held recipient"],
    ["0xA1ice", "Lookalike recipient"],
  ]
    .map(
      ([key, label]) =>
        `<div><dt>${esc(label)}</dt><dd>${amount(
          snapshot.balances[key],
        )}<small>Demo USDC</small></dd></div>`,
    )
    .join("");
}
export function walletAddress(run, key) {
  const deployment = run?.deployment;
  return {
    GuardAccount: deployment?.contracts.guardAccount,
    Amara: deployment?.actors.amaraPolicyOwner,
    "Ravi / Junior LP": deployment?.actors.raviJunior,
    "Senior LP": deployment?.actors.seniorLP,
  }[key];
}
export function payoutEvents(run) {
  const found = new Map();
  for (const event of eventsOf(run)) {
    if (
      event.verified &&
      event.source === "chain" &&
      event.viz?.tx?.lane === "payout"
    )
      found.set(event.txHash || `event-${event.seq}`, event);
  }
  return [...found.values()];
}

// Keyed native details retain their open state and their actual DOM nodes on snapshots.
const listCaches = new WeakMap();
export function reconcile(target, items, keyFor, htmlFor, scope = "default") {
  const container = typeof target === "string" ? $(target) : target;
  if (!container) return;
  let cached = listCaches.get(container);
  if (!cached || cached.scope !== scope) {
    cached = { scope, rows: new Map() };
    listCaches.set(container, cached);
    container.replaceChildren();
    htmlValues.delete(container);
  }
  let cursor = container.firstElementChild;
  for (const item of items) {
    const key = String(keyFor(item));
    const markup = htmlFor(item);
    let entry = cached.rows.get(key);
    if (!entry || entry.markup !== markup) {
      const focusedIndex = entry?.node.contains(document.activeElement)
        ? [
            ...entry.node.querySelectorAll(
              "summary, a[href], button, input, select",
            ),
          ].indexOf(document.activeElement)
        : -1;
      const template = document.createElement("template");
      template.innerHTML = markup;
      const node = template.content.firstElementChild;
      if (!node) continue;
      if (entry?.node.open) node.open = true;
      if (entry?.node.parentElement === container) {
        if (cursor === entry.node) cursor = node;
        entry.node.replaceWith(node);
      }
      entry = { node, markup };
      cached.rows.set(key, entry);
      if (focusedIndex >= 0)
        node
          .querySelectorAll("summary, a[href], button, input, select")
          [focusedIndex]?.focus({ preventScroll: true });
    }
    if (entry.node === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(entry.node, cursor);
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
  htmlValues.delete(container);
}
export function eventHTML(event) {
  const local = event.source === "local";
  const provenance = local
    ? "Local computation / scripted evidence. Not a live TEE attestation."
    : event.source === "chain"
    ? event.verified
      ? "Verified chain read or confirmed receipt."
      : "Chain-related report; verification not asserted."
    : "Server-owned runner status; not a blockchain transaction.";
  return `<details class="evidence-row" data-kind="${esc(
    event.kind,
  )}" data-event-seq="${esc(event.seq)}">
    <summary><span class="chevron" aria-hidden="true">›</span><span>
      <span class="event-topline"><time datetime="${iso(
        event.emittedAt,
      )}" title="${esc(date(event.emittedAt))}">${esc(
        clock(event.emittedAt),
      )}</time>${sourcePill(event)}${event.tag ? pill(event.tag) : ""}</span>
      <span class="event-text ${
        event.kind === "title" ? "event-title" : ""
      }">${esc(event.title || event.text || "Recorded state snapshot")}</span>
    </span></summary>
    <div class="evidence-detail">
      ${
        event.title && event.text && event.title !== event.text
          ? `<p>${esc(event.text)}</p>`
          : ""
      }
      ${event.why ? `<p>${esc(event.why)}</p>` : ""}
      <dl class="ledger">${row("Evidence source", esc(provenance))}${row(
        "Recorded locally",
        esc(date(event.emittedAt)),
      )}${row(
        "Recorded in UTC",
        `<span class="mono">${esc(iso(event.emittedAt))}</span>`,
      )}${row("Sequence", esc(event.seq))}${
        event.blockNumber !== undefined
          ? row(
              "Block",
              explorerLink(
                "block",
                event.blockNumber,
                integer(event.blockNumber),
              ),
            )
          : ""
      }${
        event.txHash
          ? row("Transaction", explorerLink("tx", event.txHash))
          : row(
              "Transaction",
              esc(
                local
                  ? "Local evidence; no on-chain transaction attached."
                  : "No transaction attached to this event.",
              ),
            )
      }</dl>
      ${
        event.txHash ? `<div class="actions">${txLink(event.txHash)}</div>` : ""
      }
    </div>
  </details>`;
}
export function renderEvents(
  target,
  run,
  suppliedEvents,
  emptyText = "Recorded events will appear here as the run progresses.",
) {
  const events = suppliedEvents || eventsOf(run);
  reconcile(target, events, (event) => event.seq, eventHTML, run?.id || "none");
  if (!events.length)
    setHTML(
      target,
      `<div class="empty-state"><h3>${
        run
          ? "No evidence in this view yet"
          : "An empty ledger, ready for a run"
      }</h3><p>${esc(emptyText)}</p>${
        !run
          ? '<div class="actions"><a class="button" href="/theater">Open Theater <span aria-hidden="true">→</span></a></div>'
          : ""
      }</div>`,
    );
}
const checkNames = {
  payroll: "Payroll executed",
  containment: "Suspicious payment contained",
  "policy-block": "Policy violation reverted",
  loss: "Controlled residual loss",
  payout: "Covered payout delivered",
  provenance: "Owner-origin claim denied",
};
export function renderChecks(target, run) {
  const checks = run?.result?.checks || [];
  reconcile(
    target,
    checks,
    (check) => check.name,
    (check) =>
      `<details class="check-row"><summary><span class="chevron" aria-hidden="true">›</span><span>${esc(
        checkNames[check.name] || check.name,
      )}</span>${pill(
        check.passed ? "Passed" : "Failed",
        check.passed ? "positive" : "negative",
      )}</summary><div class="evidence-detail"><p>${esc(check.detail)}</p><p>${
        check.name === "provenance"
          ? "Local SDK evidence and deterministic judgment; not a chain identity attestation."
          : "Recorded final verification. Inspect the receipt where a transaction is attached."
      }</p>${
        check.txHash
          ? `<div class="actions">${txLink(check.txHash)}</div>`
          : '<p class="fine-print">No transaction attached to this check.</p>'
      }</div></details>`,
    run?.id || "none",
  );
  if (!checks.length)
    setHTML(
      target,
      `<p class="fine-print">${
        run?.status === "failed" || run?.status === "interrupted"
          ? "The runner did not produce a complete verified result. Partial receipts remain available in Flow."
          : "Final checks appear only when the runner supplies a verified result. A process exit alone is not completion."
      }</p>`,
    );
}

export async function request(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30000);
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(options.method === "POST"
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.body || {}),
          }
        : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `The server returned a non-JSON response (HTTP ${response.status}).`,
      );
    }
    if (!response.ok) {
      const error = new Error(
        typeof data.error === "string"
          ? data.error
          : `Request failed (HTTP ${response.status}).`,
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

const selectionKey = "repayd.selected-run";
const query = new URLSearchParams(location.search);
let selection = query.has("runId")
  ? query.get("runId") || ""
  : storageGet(selectionKey);
if (query.has("runId")) storageSet(selectionKey, selection || null);
let state = null;
let ready = false;
let generation = 0;
let stream;
let streamConnected = false;
let lastSeen = 0;
let lastHeartbeat = 0;
let refreshPromise;
let refreshGeneration = -1;
let started = false;
const stateListeners = new Set();
const tickListeners = new Set();
export const getState = () => state;
export const isReady = () => ready;
export const getSelection = () => selection;
export const getLastHeartbeat = () => lastHeartbeat;

function syncSelectionURL() {
  const url = new URL(location.href);
  selection
    ? url.searchParams.set("runId", selection)
    : url.searchParams.delete("runId");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function connectionError(message) {
  const element = $("connection-error");
  if (element) element.hidden = !message;
  setText("connection-error-text", message);
}
function updateLinks() {
  document.querySelectorAll("[data-run-link]").forEach((link) => {
    const runId = link.hasAttribute("data-requires-run")
      ? state?.run?.id
      : selection;
    const disabled = link.hasAttribute("data-requires-run") && !runId;
    link.setAttribute("aria-disabled", String(disabled));
    if (disabled) {
      link.removeAttribute("href");
      link.setAttribute("tabindex", "-1");
    } else {
      link.href = runURL(link.dataset.runLink, runId);
      link.removeAttribute("tabindex");
    }
  });
}
function renderChrome() {
  const run = state?.run;
  const active = state?.runs?.find((item) => item.id === state.activeRunId);
  const banner = $("active-run-banner");
  if (banner) banner.hidden = !state?.activeRunId;
  setText(
    "active-run-label",
    active ? `${active.label} is running` : "A demo run is in progress",
  );
  setText(
    "active-run-detail",
    active
      ? `${phaseName(active.phase)} · continues across navigation`
      : "Execution is owned by the server",
  );
  const activeLink = $("active-run-link");
  if (activeLink) activeLink.href = runURL("/theater", state?.activeRunId);
  const runs = state?.runs || [];
  document.querySelectorAll("[data-run-select]").forEach((select) => {
    const options = [
      {
        id: "",
        label: state?.activeRunId
          ? "Follow current · active run"
          : state?.selectedRunId
          ? "Follow current · latest selection"
          : "Follow current · no selected run",
      },
      ...runs.map((item) => ({
        id: item.id,
        label: `${item.label} · ${statusName(item.status)} · ${date(
          item.startedAt,
        )}`,
      })),
    ];
    if (selection && !options.some((item) => item.id === selection))
      options.push({
        id: selection,
        label: `Selected run · ${short(selection)}`,
      });
    const signature = JSON.stringify(options);
    if (select.dataset.options !== signature) {
      select.replaceChildren(
        ...options.map((item) => new Option(item.label, item.id)),
      );
      select.dataset.options = signature;
    }
    select.value = selection;
    select.disabled = !state;
  });
  document.querySelectorAll("[data-run-context]").forEach((element) => {
    setHTML(
      element,
      run
        ? `${statusPill(run.status)} <span>${
            selection ? "Pinned run" : "Following current run"
          } · <span class="mono">${esc(short(run.id))}</span></span>`
        : ready
        ? "<span>No run selected. Start in Theater or choose a saved run.</span>"
        : "<span>Loading saved run state…</span>",
    );
  });
  document.querySelectorAll("[data-environment-token]").forEach((element) => {
    element.textContent = state?.environment?.token || "Demo USDC (mintable)";
  });
  updateLinks();
  renderConnection();
}
function renderConnection() {
  const connection = $("connection-status");
  if (connection) connection.dataset.connection = ready ? "online" : "offline";
  setText(
    "connection-label",
    ready
      ? streamConnected
        ? "Saved state connected"
        : "Saved state synchronized · polling fallback"
      : "Connecting to saved state",
  );
  setText(
    "connection-age",
    lastSeen ? `Server seen ${age(lastSeen)}` : "Waiting for server",
  );
}
function notifyState() {
  renderChrome();
  for (const listener of stateListeners) listener(state);
}
function acceptState(next, requestGeneration) {
  if (requestGeneration !== generation) return;
  if (!next || !Array.isArray(next.runs) || !Object.hasOwn(next, "run"))
    throw new Error("The server returned an invalid demo state.");
  if (
    state?.run &&
    next.run?.id === state.run.id &&
    next.run.updatedAt < state.run.updatedAt
  )
    return;
  state = next;
  ready = true;
  lastSeen = Date.now();
  connectionError("");
  notifyState();
}
export async function refreshState() {
  if (refreshPromise && refreshGeneration === generation) return refreshPromise;
  const requestGeneration = generation;
  refreshGeneration = requestGeneration;
  const promise = (async () => {
    try {
      const next = await request(
        `/api/demo/state${
          selection ? `?runId=${encodeURIComponent(selection)}` : ""
        }`,
      );
      acceptState(next, requestGeneration);
      return next;
    } catch (error) {
      if (requestGeneration !== generation) return null;
      ready = false;
      connectionError(
        `${
          error.status === 404
            ? "That saved run could not be found. Choose another run or follow the current one."
            : "Cannot refresh saved state. Any server-owned run may still be executing; the last received snapshot is shown."
        } ${
          error.name === "AbortError"
            ? "The request timed out."
            : error.status
            ? `HTTP ${error.status}.`
            : "Check the dashboard server connection."
        }`,
      );
      notifyState();
      return null;
    } finally {
      if (refreshPromise === promise) refreshPromise = null;
    }
  })();
  refreshPromise = promise;
  return promise;
}
function connectStream() {
  stream?.close();
  streamConnected = false;
  if (!window.EventSource) return;
  const streamGeneration = generation;
  stream = new EventSource(
    `/api/demo/stream${
      selection ? `?runId=${encodeURIComponent(selection)}` : ""
    }`,
  );
  stream.addEventListener("open", () => {
    if (streamGeneration === generation) {
      streamConnected = true;
      renderConnection();
    }
  });
  stream.addEventListener("snapshot", (event) => {
    if (streamGeneration !== generation) return;
    try {
      acceptState(JSON.parse(event.data), streamGeneration);
    } catch {
      connectionError(
        "A state update could not be read. The dashboard will refresh from the saved state endpoint.",
      );
    }
  });
  stream.addEventListener("heartbeat", (event) => {
    if (streamGeneration !== generation) return;
    try {
      const heartbeat = JSON.parse(event.data);
      lastHeartbeat = Number(heartbeat.serverTime) || Date.now();
      lastSeen = Date.now();
      renderConnection();
    } catch {
      /* The next snapshot or polling refresh still restores all state. */
    }
  });
  stream.onerror = () => {
    if (streamGeneration === generation) {
      streamConnected = false;
      renderConnection();
    }
  };
}
export async function selectRun(runId) {
  selection = runId || "";
  storageSet(selectionKey, selection || null);
  syncSelectionURL();
  generation += 1;
  ready = false;
  state = state ? { ...state, run: null } : null;
  connectionError("");
  notifyState();
  connectStream();
  return refreshState();
}
export function initialize(onState, onTick) {
  if (onState) stateListeners.add(onState);
  if (onTick) tickListeners.add(onTick);
  if (started) {
    if (onState) onState(state);
    return;
  }
  started = true;
  syncSelectionURL();
  document
    .querySelectorAll("[data-run-select]")
    .forEach((select) =>
      select.addEventListener("change", () => selectRun(select.value)),
    );
  document.querySelectorAll("[data-retry-state]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      await refreshState();
      button.disabled = false;
    }),
  );
  document
    .querySelectorAll("[data-follow-current]")
    .forEach((button) => button.addEventListener("click", () => selectRun("")));
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value =
      button.dataset.copy === "run" ? state?.run?.id : button.dataset.copy;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notice("action-message", "Copied to clipboard.", "success");
    } catch {
      notice(
        "action-message",
        "Clipboard access is unavailable. The full value is displayed in the record details.",
        "warning",
      );
    }
  });
  renderChrome();
  connectStream();
  refreshState();
  setInterval(() => {
    if (!document.hidden) {
      renderConnection();
      for (const listener of tickListeners) listener(state);
    }
  }, 1000);
  setInterval(() => {
    if (
      !document.hidden &&
      (!streamConnected || !lastSeen || Date.now() - lastSeen > 20000)
    )
      refreshState();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshState();
  });
  window.addEventListener("pagehide", () => stream?.close());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      connectStream();
      refreshState();
    }
  });
}
