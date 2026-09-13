import {
  $,
  addressLink,
  amount,
  date,
  esc,
  explorerLink,
  getState,
  initialize,
  integer,
  isReady,
  iso,
  notice,
  pill,
  reconcile,
  request,
  row,
  runURL,
  setHTML,
  setText,
  short,
  storageGet,
  storageSet,
  txLink,
} from "/assets/dashboard.js";

const defaults = {
  q: "",
  category: "all",
  status: "all",
  range: "all",
  from: "",
  to: "",
  sort: "newest",
};
const filterKey = "repayd.flow-filters";
let saved = {};
try {
  saved = JSON.parse(storageGet(filterKey, "{}"));
} catch {
  /* Ignore a malformed saved preference. */
}
const params = new URLSearchParams(location.search);
const filters = { ...defaults };
for (const key of Object.keys(defaults))
  filters[key] = params.has(key)
    ? params.get(key)
    : typeof saved?.[key] === "string"
    ? saved[key]
    : defaults[key];
if (!["all", "15m", "1h", "24h", "custom"].includes(filters.range))
  filters.range = "all";
if (!["all", "success", "reverted"].includes(filters.status))
  filters.status = "all";
if (!["newest", "oldest"].includes(filters.sort)) filters.sort = "newest";
for (const [key, value] of Object.entries(filters)) {
  if (key === "category" && value !== "all")
    $("filter-category").add(new Option(value, value));
  $(key === "q" ? "flow-search" : `filter-${key}`).value = value;
}

let viewedRunId = null;
let data = null;
let loading = false;
let failed = false;
let loadedAt = null;
let requestSequence = 0;
let controller;
let observedRunVersion = "";
let reloadQueued = false;
let lastPresetMinute = 0;
let index = new Map();

function saveFilters() {
  storageSet(filterKey, JSON.stringify(filters));
  const url = new URL(location.href);
  for (const key of Object.keys(defaults)) {
    filters[key] === defaults[key] || !filters[key]
      ? url.searchParams.delete(key)
      : url.searchParams.set(key, filters[key]);
  }
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function readFilters() {
  for (const key of Object.keys(defaults))
    filters[key] = $(key === "q" ? "flow-search" : `filter-${key}`).value;
  saveFilters();
  renderTransactions();
}
function timeBounds() {
  $("custom-range").hidden = filters.range !== "custom";
  $("filter-from").removeAttribute("aria-invalid");
  $("filter-to").removeAttribute("aria-invalid");
  if (filters.range === "custom") {
    const start = filters.from
      ? new Date(filters.from).getTime() / 1000
      : -Infinity;
    const end = filters.to ? new Date(filters.to).getTime() / 1000 : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      $("filter-from").setAttribute("aria-invalid", "true");
      $("filter-to").setAttribute("aria-invalid", "true");
      return {
        error:
          "Choose a valid custom date range. The start must be at or before the end.",
      };
    }
    const utcStart = Number.isFinite(start)
      ? iso(start * 1000)
      : "no start bound";
    const utcEnd = Number.isFinite(end) ? iso(end * 1000) : "no end bound";
    return {
      start,
      end,
      label: `Inputs use your local timezone. UTC range: ${utcStart} → ${utcEnd}. Endpoints are inclusive.`,
    };
  }
  const seconds = { "15m": 900, "1h": 3600, "24h": 86400 }[filters.range];
  const now = Date.now() / 1000;
  return seconds
    ? {
        start: now - seconds,
        end: now,
        label: `${
          filters.range === "15m"
            ? "Last 15 minutes"
            : filters.range === "1h"
            ? "Last hour"
            : "Last 24 hours"
        }, relative to now, not the run start. Times are displayed in your local timezone.`,
      }
    : {
        start: -Infinity,
        end: Infinity,
        label:
          "All dates, including historical runs. Times are displayed in your local timezone; exact UTC appears in each receipt.",
      };
}
function updateCategories() {
  const counts = new Map();
  for (const transaction of data?.txs || [])
    counts.set(
      transaction.category,
      (counts.get(transaction.category) || 0) + 1,
    );
  if (filters.category !== "all" && !counts.has(filters.category))
    counts.set(filters.category, 0);
  const options = [
    { value: "all", label: `All categories (${data?.txs.length || 0})` },
    ...[...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => ({
        value: category,
        label: `${category} (${count})`,
      })),
  ];
  const select = $("filter-category");
  const signature = JSON.stringify(options);
  if (select.dataset.options !== signature) {
    select.replaceChildren(
      ...options.map((option) => new Option(option.label, option.value)),
    );
    select.dataset.options = signature;
  }
  select.value = filters.category;
}
function transactionHTML(transaction) {
  const events = transaction.events || [];
  const transfers = transaction.transfers || [];
  const timestamp = transaction.timestamp * 1000;
  return `<details class="tx-row" data-tx-hash="${esc(transaction.hash)}">
    <summary><span class="chevron" aria-hidden="true">›</span><span>
      <span class="tx-top"><time datetime="${iso(timestamp)}" title="${esc(
        iso(timestamp),
      )}">${esc(date(timestamp))}</time>${pill(transaction.category)}${pill(
        transaction.status === "reverted" ? "Reverted" : "Success",
        transaction.status === "reverted" ? "negative" : "positive",
      )}<span class="tx-block">block ${integer(transaction.block)}</span></span>
      <span class="tx-path">${esc(
        transaction.from || "Unknown sender",
      )}<span class="arrow" aria-hidden="true">→</span><span class="sr-only"> to </span>${esc(
        transaction.to || "Contract creation",
      )}</span>
      <span class="tx-plain">${esc(transaction.plain)}</span>
      <span class="tx-function"><span>${esc(
        transaction.fn || "No decoded function",
      )}</span><span>${esc(short(transaction.hash, 12))}</span></span>
    </span></summary>
    <div class="tx-details">
      <dl class="ledger">
        ${row("Transaction hash", explorerLink("tx", transaction.hash))}
        ${row(
          "Receipt status",
          pill(
            transaction.status === "reverted"
              ? "Reverted · gas still paid"
              : "Success",
            transaction.status === "reverted" ? "negative" : "positive",
          ),
        )}
        ${row(
          "Block",
          explorerLink("block", transaction.block, integer(transaction.block)),
        )}
        ${row("Local timestamp", esc(date(timestamp)))}
        ${row("Exact UTC", `<span class="mono">${esc(iso(timestamp))}</span>`)}
        ${row(
          "Unix timestamp",
          `<span class="mono">${esc(transaction.timestamp)} seconds</span>`,
        )}
        ${row("From address", addressLink(transaction.fromAddress))}
        ${row(
          "To address",
          transaction.toAddress
            ? addressLink(transaction.toAddress)
            : "Contract creation · no recipient address recorded",
        )}
        ${row(
          "Function",
          `<span class="mono">${esc(transaction.fn || "Not decoded")}</span>`,
        )}
        ${row(
          "Native value",
          `<span class="mono">${esc(transaction.value)} Arc USDC</span>`,
        )}
        ${row(
          "Gas fee",
          `<span class="mono">${esc(transaction.gas)} Arc USDC</span>`,
        )}
      </dl>
      <div class="actions">${txLink(
        transaction.hash,
        "Open this transaction on Arcscan ↗",
      )}</div>
      <p class="section-label">Token transfers · ${integer(
        transfers.length,
      )}</p>
      ${
        transfers.length
          ? `<div class="table-wrap"><table class="transfer-table"><caption class="sr-only">Decoded transfers in this receipt</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col" class="numeric">Amount</th><th scope="col">Token</th></tr></thead><tbody>${transfers
              .map(
                (transfer) =>
                  `<tr><td>${addressLink(transfer.from)}</td><td>${addressLink(
                    transfer.to,
                  )}</td><td class="numeric mono">${esc(
                    transfer.amount,
                  )}</td><td>${
                    /^0x[0-9a-fA-F]{40}$/.test(transfer.token)
                      ? `Demo token<br>${addressLink(transfer.token)}`
                      : esc(transfer.token)
                  }</td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : '<p class="fine-print">No decoded token transfers in this receipt. Native value and gas are shown separately above.</p>'
      }
      <p class="section-label">Decoded events · ${integer(events.length)}</p>
      ${
        events.length
          ? events
              .map(
                (event) =>
                  `<div class="decoded-event"><strong>${esc(
                    event.name,
                  )}</strong><p>${esc(
                    event.text,
                  )}</p><p>Emitted by ${addressLink(event.address)}</p></div>`,
              )
              .join("")
          : '<p class="fine-print">No decoded protocol events. This transaction remains part of the run, including deployments, gas funding, and reverted calls.</p>'
      }
    </div>
  </details>`;
}
function renderTransactions() {
  const bounds = timeBounds();
  notice("filter-error", bounds.error || "", "error");
  setText(
    "filter-description",
    bounds.label || "Correct the custom range to view matching transactions.",
  );
  if (!data) {
    reconcile(
      "flow-transactions",
      [],
      (transaction) => transaction.hash,
      transactionHTML,
      viewedRunId || "none",
    );
    setText(
      "flow-count",
      loading
        ? "Loading recorded receipts…"
        : failed
        ? "Receipt data unavailable"
        : "No transactions loaded",
    );
    setHTML(
      "flow-transactions",
      `<div class="${loading ? "loading-state" : "empty-state"}">${
        loading
          ? "Reading the selected run's exact transaction receipts…"
          : `<h3>${
              failed
                ? "The chain read did not succeed"
                : viewedRunId
                ? "Waiting for recorded transactions"
                : "Choose a run to follow the funds"
            }</h3><p>${
              failed
                ? "No empty success has been substituted for the failed read. Use Refresh receipts to try again."
                : viewedRunId
                ? "Transactions appear after the runner records confirmed receipts."
                : "Start a run in Theater, or select a historical run above. Flow never scans unrelated public-network activity."
            }</p>${
              !viewedRunId
                ? '<div class="actions"><a class="button" href="/theater">Open Theater <span aria-hidden="true">→</span></a></div>'
                : ""
            }`
      }</div>`,
    );
    return;
  }
  const needle = filters.q.trim().toLowerCase();
  const direction = filters.sort === "oldest" ? 1 : -1;
  const matches = bounds.error
    ? []
    : data.txs
        .filter(
          (transaction) =>
            (filters.category === "all" ||
              transaction.category === filters.category) &&
            (filters.status === "all" ||
              transaction.status === filters.status) &&
            transaction.timestamp >= bounds.start &&
            transaction.timestamp <= bounds.end &&
            (!needle || index.get(transaction.hash)?.includes(needle)),
        )
        .sort(
          (a, b) =>
            direction *
            (a.timestamp - b.timestamp ||
              a.block - b.block ||
              a.hash.localeCompare(b.hash)),
        );
  setText(
    "flow-count",
    `${integer(matches.length)} of ${integer(
      data.txs.length,
    )} recorded transactions`,
  );
  setText(
    "flow-sort-note",
    `${
      filters.sort === "oldest" ? "Oldest first" : "Newest first"
    } · ties ordered by block, then hash`,
  );
  reconcile(
    "flow-transactions",
    matches,
    (transaction) => transaction.hash,
    transactionHTML,
    viewedRunId || "none",
  );
  if (!matches.length) {
    const hasReceipts = data.txs.length > 0;
    setHTML(
      "flow-transactions",
      `<div class="empty-state"><h3>${
        bounds.error
          ? "This time range needs attention"
          : hasReceipts
          ? "No transactions match these filters"
          : "No receipt has been recorded yet"
      }</h3><p>${esc(
        bounds.error ||
          (hasReceipts
            ? "Search, category, status, and time filters all apply together. Clear filters or choose All dates to see this run's full history."
            : data.message ||
              "This run has not recorded a confirmed transaction. Active runs refresh automatically."),
      )}</p>${
        hasReceipts && !bounds.error
          ? '<div class="actions"><button type="button" class="button" data-clear-filters>Clear all filters</button></div>'
          : ""
      }</div>`,
    );
  }
}
function renderWallets() {
  const wallets = data?.wallets || [];
  reconcile(
    "flow-wallets",
    wallets,
    (wallet) => wallet.address,
    (wallet) =>
      `<div class="wallet-row"><div><span class="wallet-name">${esc(
        wallet.label,
      )}</span>${addressLink(
        wallet.address,
        true,
      )}</div><div class="wallet-value">${amount(
        wallet.usdc,
      )}<small class="muted">Demo USDC</small></div><p class="wallet-note">${esc(
        wallet.note,
      )}</p></div>`,
    viewedRunId || "none",
  );
  if (!wallets.length)
    setHTML(
      "flow-wallets",
      `<p class="fine-print">${
        loading
          ? "Loading recorded wallet snapshots…"
          : "No verified wallet snapshot is available for this run yet. Zero balances will be shown only when recorded."
      }</p>`,
    );
}
function renderScope() {
  const run = getState()?.run;
  setText("flow-run-id", run?.id || "No run selected");
  setText(
    "flow-scope",
    data
      ? `${data.chain.name} · chain ${data.chain.id} · ${
          data.scanned.fromBlock || data.scanned.toBlock
            ? `recorded blocks ${integer(data.scanned.fromBlock)}–${integer(
                data.scanned.toBlock,
              )}`
            : "no recorded block bounds"
        }${
          data.chain.head ? ` · observed head ${integer(data.chain.head)}` : ""
        }${data.scanned.truncated ? " · receipt history is incomplete" : ""}`
      : "Only transaction hashes recorded by the selected run are eligible.",
  );
  setText(
    "flow-last-loaded",
    loadedAt
      ? `Receipts read ${date(loadedAt)}${loading ? " · refreshing…" : ""}`
      : loading
      ? "Reading receipts…"
      : "No successful receipt read yet",
  );
  setText(
    "flow-refresh-note",
    run?.status === "running"
      ? "Active run · new receipts refresh automatically"
      : "Historical snapshot · refresh on demand",
  );
  $("refresh-flow").disabled = loading || !run;
  setText("refresh-flow-label", loading ? "Reading…" : "Refresh receipts");
  notice(
    "flow-message",
    data?.message ||
      (data?.scanned.truncated
        ? "The server reports incomplete receipt history. Do not treat this view as a complete run ledger."
        : ""),
    "warning",
  );
}
async function loadFlow() {
  if (!viewedRunId || loading) return;
  const runId = viewedRunId;
  const sequence = ++requestSequence;
  controller = new AbortController();
  loading = true;
  reloadQueued = false;
  renderScope();
  if (!data) {
    renderTransactions();
    renderWallets();
  }
  try {
    const result = await request(
      `/api/flow?runId=${encodeURIComponent(runId)}`,
      { signal: controller.signal },
    );
    if (sequence !== requestSequence || runId !== viewedRunId) return;
    if (
      result.runId !== runId ||
      !Array.isArray(result.txs) ||
      !Array.isArray(result.wallets)
    )
      throw new Error(
        "The server returned receipt data for a different or invalid run.",
      );
    // Keep only one entry for each exact recorded hash, even if a receipt is reported twice.
    result.txs = [
      ...new Map(
        result.txs.map((transaction) => [
          transaction.hash.toLowerCase(),
          transaction,
        ]),
      ).values(),
    ];
    data = result;
    loadedAt = Date.now();
    failed = false;
    index = new Map(
      data.txs.map((transaction) => [
        transaction.hash,
        [
          transaction.hash,
          transaction.from,
          transaction.to,
          transaction.fromAddress,
          transaction.toAddress,
          transaction.fn,
          transaction.plain,
          transaction.category,
          ...(transaction.events || []).flatMap((event) => [
            event.name,
            event.text,
            event.address,
          ]),
          ...(transaction.transfers || []).flatMap((transfer) => [
            transfer.from,
            transfer.to,
            transfer.token,
            transfer.amount,
          ]),
        ]
          .join(" ")
          .toLowerCase(),
      ]),
    );
    notice("flow-error", "");
    updateCategories();
  } catch (error) {
    if (sequence !== requestSequence || runId !== viewedRunId) return;
    failed = true;
    notice(
      "flow-error",
      `${
        data
          ? "Refresh failed; previously read receipts remain visible and may be stale."
          : "Receipts could not be read; no chain results are being fabricated."
      } ${
        error.name === "AbortError" ? "The request timed out." : error.message
      }`,
      "error",
    );
  } finally {
    if (sequence === requestSequence) {
      loading = false;
      renderScope();
      renderTransactions();
      renderWallets();
      if (reloadQueued && runId === viewedRunId) {
        reloadQueued = false;
        loadFlow();
      }
    }
  }
}
function onState(state) {
  const run = state?.run;
  const nextId = run?.id || null;
  if (nextId !== viewedRunId) {
    controller?.abort();
    requestSequence += 1;
    viewedRunId = nextId;
    data = null;
    index.clear();
    loading = false;
    failed = false;
    loadedAt = null;
    observedRunVersion = "";
    reloadQueued = false;
    notice("flow-error", "");
    notice("flow-message", "");
    renderTransactions();
    renderWallets();
    updateCategories();
  }
  renderScope();
  const version = run
    ? `${run.id}:${run.transactions.length}:${run.status}:${
        run.events.at(-1)?.seq ?? -1
      }:${run.result?.endBlock ?? ""}:${
        run.deployment?.contracts.guardAccount || ""
      }`
    : "";
  const changed = version !== observedRunVersion;
  observedRunVersion = version;
  if (run && changed) {
    if (loading) reloadQueued = true;
    else loadFlow();
  }
  if (!run) {
    renderTransactions();
    renderWallets();
    updateCategories();
  }
  if (!run && !isReady()) setText("flow-count", "Loading saved run state…");
}
function clearFilters() {
  Object.assign(filters, defaults);
  for (const [key, value] of Object.entries(filters))
    $(key === "q" ? "flow-search" : `filter-${key}`).value = value;
  saveFilters();
  renderTransactions();
}
$("flow-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  readFilters();
});
$("flow-filters").addEventListener("input", readFilters);
$("flow-filters").addEventListener("change", readFilters);
$("refresh-flow").addEventListener("click", loadFlow);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-clear-filters]")) clearFilters();
});
saveFilters();
initialize(onState, () => {
  const minute = Math.floor(Date.now() / 60000);
  if (
    minute !== lastPresetMinute &&
    ["15m", "1h", "24h"].includes(filters.range)
  ) {
    lastPresetMinute = minute;
    renderTransactions();
  }
});
setInterval(() => {
  if (!document.hidden && getState()?.run?.status === "running") loadFlow();
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && viewedRunId) loadFlow();
});
