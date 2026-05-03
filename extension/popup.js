const APP_NAME = "Pinterest LocalBoard";
const HISTORY_STORAGE_KEY = "localBoardDownloadHistory";
const LEGACY_HISTORY_STORAGE_KEY = "downloadHistory";

const el = {
  boardName:              document.getElementById("boardName"),
  boardMeta:              document.getElementById("boardMeta"),
  boardUrl:               document.getElementById("boardUrl"),
  boardWarning:           document.getElementById("boardWarning"),
  statusPill:             document.getElementById("statusPill"),
  statusPillText:         document.getElementById("statusPillText"),
  progressSection:        document.getElementById("progressSection"),
  progressFill:           document.getElementById("progressFill"),
  statusMsg:              document.getElementById("statusMsg"),
  progressPct:            document.getElementById("progressPct"),
  statExpected:           document.getElementById("statExpected"),
  statCollected:          document.getElementById("statCollected"),
  statDownloaded:         document.getElementById("statDownloaded"),
  warningLine:            document.getElementById("warningLine"),
  selectionSection:       document.getElementById("selectionSection"),
  selectionCount:         document.getElementById("selectionCount"),
  idleActions:            document.getElementById("idleActions"),
  selectionActions:       document.getElementById("selectionActions"),
  selectButton:           document.getElementById("selectButton"),
  startButton:            document.getElementById("startButton"),
  exitSelectionButton:    document.getElementById("exitSelectionButton"),
  downloadSelectedButton: document.getElementById("downloadSelectedButton"),
  cancelButton:           document.getElementById("cancelButton"),
  historyList:            document.getElementById("historyList"),
  clearHistoryButton:     document.getElementById("clearHistoryButton"),
  refreshButton:          document.getElementById("refreshButton"),
  reloadTabButton:        document.getElementById("reloadTabButton"),
  openBoardButton:        document.getElementById("openBoardButton"),
};

let activeTabId = null;
let currentTab  = null;
let pollTimer   = null;

document.addEventListener("DOMContentLoaded", async () => {
  el.startButton.addEventListener("click",           handleStartClick);
  el.selectButton.addEventListener("click",          handleSelectClick);
  el.exitSelectionButton.addEventListener("click",   handleExitSelectionClick);
  el.downloadSelectedButton.addEventListener("click", handleDownloadSelectedClick);
  el.cancelButton.addEventListener("click",          handleCancelClick);
  el.refreshButton.addEventListener("click",         handleManualRefresh);
  el.reloadTabButton.addEventListener("click",       handleReloadTab);
  el.openBoardButton.addEventListener("click",       handleOpenBoard);
  el.clearHistoryButton.addEventListener("click",    handleClearHistory);
  el.historyList.addEventListener("click",           handleHistoryClick);

  await refreshPopup();
  pollTimer = window.setInterval(refreshPopup, 900);
});

window.addEventListener("unload", () => {
  if (pollTimer) window.clearInterval(pollTimer);
});

/* ── Handlers ── */

async function handleStartClick() {
  if (activeTabId == null) return;
  el.startButton.disabled = true;
  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "START_DOWNLOAD" });
  } catch (err) {
    showBoardWarning(err.message || "Could not start the downloader.");
  }
  await refreshPopup();
}

async function handleSelectClick() {
  if (activeTabId == null) return;
  el.selectButton.disabled = true;
  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "ENTER_SELECTION_MODE" });
  } catch (err) {
    showBoardWarning(err.message || "Could not enter selection mode.");
  }
  await refreshPopup();
}

async function handleExitSelectionClick() {
  if (activeTabId == null) return;
  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "EXIT_SELECTION_MODE" });
  } catch (err) {
    showBoardWarning(err.message || "Could not exit selection mode.");
  }
  await refreshPopup();
}

async function handleDownloadSelectedClick() {
  if (activeTabId == null) return;
  el.downloadSelectedButton.disabled = true;
  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    const selState = await sendMessage({ type: "GET_SELECTION_STATE" });
    const pinIds = selState?.ids || [];
    if (pinIds.length === 0) {
      showBoardWarning("No pins selected. Click pins on the board page first.");
      return;
    }
    await sendMessage({ type: "START_DOWNLOAD", pinIds });
  } catch (err) {
    showBoardWarning(err.message || "Could not start the download.");
  }
  await refreshPopup();
}

async function handleCancelClick() {
  if (activeTabId == null) return;
  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "CANCEL_DOWNLOAD" });
  } catch (err) {
    showBoardWarning(err.message || "Could not cancel.");
  }
  await refreshPopup();
}

async function handleManualRefresh() {
  await refreshPopup();
}

async function handleReloadTab() {
  if (activeTabId == null) return;
  el.reloadTabButton.disabled = true;
  try {
    await chrome.tabs.reload(activeTabId);
    await wait(900);
  } finally {
    el.reloadTabButton.disabled = false;
  }
  await refreshPopup();
}

async function handleOpenBoard() {
  if (!currentTab?.url) return;
  await chrome.tabs.create({ url: currentTab.url });
}

async function handleClearHistory() {
  await chrome.storage.local.remove([HISTORY_STORAGE_KEY, LEGACY_HISTORY_STORAGE_KEY]);
  await refreshPopup();
}

async function handleHistoryClick(event) {
  const btn = event.target.closest("[data-history-url]");
  if (!btn) return;
  const url = btn.getAttribute("data-history-url");
  if (url) await chrome.tabs.create({ url });
}

/* ── Core refresh ── */

async function refreshPopup() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  currentTab  = tab;

  if (activeTabId == null) {
    renderUnavailable(null, "No active tab found.");
    return;
  }

  try {
    await ensureContentScriptReady(tab);
    const [context, status, history] = await Promise.all([
      sendMessage({ type: "GET_CONTEXT" }),
      sendMessage({ type: "GET_STATUS" }),
      getDownloadHistory(),
    ]);
    render(tab, context, status, history);
  } catch {
    const history = await getDownloadHistory();
    renderUnavailable(
      tab,
      "Open a Pinterest board page to get started.",
      history
    );
  }
}

/* ── Render ── */

function render(tab, context, status, history) {
  if (!context?.ok) {
    renderUnavailable(
      tab,
      context?.reason || "This tab is not a Pinterest board.",
      history
    );
    return;
  }

  const safeStatus    = normalizeStatus(status, context);
  const inSelection   = Boolean(safeStatus.selectionActive);
  const selCount      = Number(safeStatus.selectionCount) || 0;
  const isActive      = ["scanning", "downloading", "zipping"].includes(safeStatus.stage);
  const isIdle        = ["idle", "done", "error", "cancelled"].includes(safeStatus.stage);

  /* Board header */
  el.boardName.textContent = context.boardName || "Board detected";
  el.boardMeta.textContent = buildMeta(context);
  el.boardUrl.textContent  = tab?.url ? compactUrl(tab.url) : "";

  /* Status pill */
  setPill(safeStatus.stage, inSelection);

  /* Progress section */
  el.progressSection.classList.toggle("hidden", !isActive);
  if (isActive) {
    el.progressFill.style.width = `${safeStatus.progressPercent}%`;
    el.progressPct.textContent  = `${Math.round(safeStatus.progressPercent)}%`;
    el.statusMsg.textContent    = safeStatus.message || "Working…";
    el.statExpected.textContent  = formatCount(context.pinCount, "expected");
    el.statCollected.textContent = formatCount(safeStatus.collected, "collected");
    el.statDownloaded.textContent = formatCount(safeStatus.downloaded, "saved");
    setInlineWarning(safeStatus.warning || "");
  }

  /* Selection section */
  el.selectionSection.classList.toggle("hidden", !inSelection);
  if (inSelection) {
    el.selectionCount.textContent = `${selCount} ${selCount === 1 ? "pin" : "pins"} selected`;
  }

  /* Action sets */
  el.idleActions.classList.toggle("hidden",      inSelection || isActive);
  el.selectionActions.classList.toggle("hidden",  !inSelection || isActive);
  el.cancelButton.classList.toggle("hidden",      !isActive);

  /* Button states */
  el.startButton.disabled              = !isIdle;
  el.selectButton.disabled             = !isIdle;
  el.downloadSelectedButton.disabled   = selCount === 0;
  el.cancelButton.disabled             = !isActive;
  el.openBoardButton.disabled          = !tab?.url;
  el.reloadTabButton.disabled          = !tab?.id;

  /* Board-level warning */
  if (!isActive && context.warning) {
    showBoardWarning(context.warning);
  } else if (!isActive) {
    clearBoardWarning();
  }

  renderHistory(history || []);
}

function renderUnavailable(tab, message, history) {
  el.boardName.textContent = "No board detected";
  el.boardMeta.textContent = message;
  el.boardUrl.textContent  = tab?.url ? compactUrl(tab.url) : "";

  setPill("unavailable", false);

  el.progressSection.classList.add("hidden");
  el.selectionSection.classList.add("hidden");
  el.idleActions.classList.remove("hidden");
  el.selectionActions.classList.add("hidden");
  el.cancelButton.classList.add("hidden");

  el.startButton.disabled             = true;
  el.selectButton.disabled            = true;
  el.downloadSelectedButton.disabled  = true;
  el.cancelButton.disabled            = true;
  el.openBoardButton.disabled         = !tab?.url;
  el.reloadTabButton.disabled         = !tab?.id;

  clearBoardWarning();
  renderHistory(history || []);
}

/* ── Helpers ── */

function normalizeStatus(status, context) {
  if (!status) {
    return { stage: "idle", collected: 0, downloaded: 0, progressPercent: 0,
             message: "Ready.", selectionActive: false, selectionCount: 0 };
  }

  const expected   = Number(context.pinCount) || 0;
  const collected  = Number(status.collected)  || 0;
  const downloaded = Number(status.downloaded) || 0;
  const stage      = status.stage || "idle";
  let progressPercent = 0;

  if (stage === "scanning") {
    progressPercent = expected > 0 ? Math.min(100, (collected / expected) * 100) : 10;
  } else if (stage === "downloading") {
    progressPercent = collected > 0 ? Math.min(100, (downloaded / collected) * 100) : 0;
  } else if (stage === "zipping") {
    progressPercent = Number(status.zipProgress) || 0;
  } else if (stage === "done") {
    progressPercent = 100;
  }

  return {
    stage,
    collected,
    downloaded,
    progressPercent: Math.max(0, Math.min(100, progressPercent)),
    message:         status.message  || "Ready.",
    warning:         status.warning  || "",
    selectionActive: Boolean(status.selectionActive),
    selectionCount:  Number(status.selectionCount) || 0,
  };
}

function buildMeta(context) {
  const parts = [];
  if (context.ownerUsername) parts.push(`@${context.ownerUsername}`);
  if (context.pinCount)      parts.push(`${context.pinCount} pins`);
  if (context.sectionCount)  parts.push(`${context.sectionCount} sections`);
  return parts.join(" · ");
}

function compactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, "") || u.hostname;
  } catch {
    return rawUrl;
  }
}

function formatCount(value, suffix) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return `— ${suffix}`;
  return `${new Intl.NumberFormat().format(n)} ${suffix}`;
}

function setPill(stage, inSelection) {
  const labels = {
    idle:        "Idle",
    scanning:    "Scanning",
    downloading: "Downloading",
    zipping:     "Zipping",
    done:        "Done",
    error:       "Error",
    cancelled:   "Cancelled",
    unavailable: "No Board",
  };
  el.statusPillText.textContent = inSelection ? "Selecting" : (labels[stage] || "Idle");
  el.statusPill.className       = "pill";
  if (inSelection) {
    el.statusPill.classList.add("select");
  } else if (["scanning", "downloading", "zipping"].includes(stage)) {
    el.statusPill.classList.add("active");
  } else if (stage === "done") {
    el.statusPill.classList.add("done");
  } else if (stage === "error") {
    el.statusPill.classList.add("error");
  }
}

function showBoardWarning(msg) {
  if (!msg) { clearBoardWarning(); return; }
  el.boardWarning.textContent = msg;
  el.boardWarning.classList.remove("hidden");
}

function clearBoardWarning() {
  el.boardWarning.textContent = "";
  el.boardWarning.classList.add("hidden");
}

function setInlineWarning(msg) {
  if (!msg) {
    el.warningLine.classList.add("hidden");
    return;
  }
  el.warningLine.textContent = msg;
  el.warningLine.classList.remove("hidden");
}

function renderHistory(history) {
  if (!history.length) {
    el.historyList.innerHTML = '<p class="empty-text">No downloads yet.</p>';
    el.clearHistoryButton.disabled = true;
    return;
  }

  el.clearHistoryButton.disabled = false;
  el.historyList.innerHTML = history
    .slice(0, 5)
    .map((item) => {
      const detail = buildHistoryDetail(item);
      const openBtn = item.boardUrl
        ? `<button class="history-open" type="button" data-history-url="${escAttr(item.boardUrl)}" title="Open board">↗</button>`
        : "";
      return `
        <article class="history-item">
          <span class="history-name">${escHtml(item.boardName || "Untitled")}</span>
          <span class="history-detail">${escHtml(detail)}</span>
          ${openBtn}
        </article>
      `;
    })
    .join("");
}

function buildHistoryDetail(item) {
  const parts = [];
  if (item.downloadedCount) parts.push(`${item.downloadedCount} imgs`);
  if (item.createdAt) {
    const d = new Date(item.createdAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d));
    }
  }
  return parts.join(" · ") || "Saved";
}

/* ── Chrome helpers ── */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendMessage(message, timeoutMs = 6000) {
  return Promise.race([
    chrome.tabs.sendMessage(activeTabId, message),
    new Promise((_, reject) =>
      window.setTimeout(
        () => reject(new Error("Content script did not respond in time.")),
        timeoutMs
      )
    ),
  ]);
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id || !isInjectableTab(tab.url)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    return;
  } catch {
    /* not yet injected — fall through */
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["vendor/jszip.min.js", "content.js"],
  });

  /* Verify the script is actually responding after injection */
  for (let i = 0; i < 5; i++) {
    await wait(300);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
      return;
    } catch {
      /* still starting up */
    }
  }

  throw new Error(
    "Content script failed to initialize. Try reloading the Pinterest tab."
  );
}

function isInjectableTab(url) {
  return /^https:\/\/([a-z]+\.)?pinterest\.com\//i.test(url || "");
}

async function getDownloadHistory() {
  const stored = await chrome.storage.local.get([
    HISTORY_STORAGE_KEY,
    LEGACY_HISTORY_STORAGE_KEY,
  ]);

  if (Array.isArray(stored[HISTORY_STORAGE_KEY])) return stored[HISTORY_STORAGE_KEY];

  if (Array.isArray(stored[LEGACY_HISTORY_STORAGE_KEY])) {
    const legacy = stored[LEGACY_HISTORY_STORAGE_KEY];
    try { await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: legacy }); } catch {}
    return legacy;
  }

  return [];
}

/* ── Escape helpers ── */

function escHtml(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(v) { return escHtml(v); }

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
