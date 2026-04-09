const APP_NAME = "Pinterest LocalBoard";
const HISTORY_STORAGE_KEY = "localBoardDownloadHistory";
const LEGACY_HISTORY_STORAGE_KEY = "downloadHistory";

const elements = {
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  tabHint: document.getElementById("tabHint"),
  boardLine: document.getElementById("boardLine"),
  matchLine: document.getElementById("matchLine"),
  lastZipLine: document.getElementById("lastZipLine"),
  statePill: document.getElementById("statePill"),
  refreshButton: document.getElementById("refreshButton"),
  reloadTabButton: document.getElementById("reloadTabButton"),
  openBoardButton: document.getElementById("openBoardButton"),
  copyUrlButton: document.getElementById("copyUrlButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  historyList: document.getElementById("historyList"),
  expectedPins: document.getElementById("expectedPins"),
  collectedPins: document.getElementById("collectedPins"),
  downloadedPins: document.getElementById("downloadedPins"),
  progressPercent: document.getElementById("progressPercent"),
  progressFill: document.getElementById("progressFill"),
  statusLine: document.getElementById("statusLine"),
  warningLine: document.getElementById("warningLine"),
  startButton: document.getElementById("startButton"),
  cancelButton: document.getElementById("cancelButton")
};

let activeTabId = null;
let pollTimer = null;
let currentTab = null;

document.addEventListener("DOMContentLoaded", async () => {
  elements.startButton.addEventListener("click", handleStartClick);
  elements.cancelButton.addEventListener("click", handleCancelClick);
  elements.refreshButton.addEventListener("click", handleManualRefresh);
  elements.reloadTabButton.addEventListener("click", handleReloadTab);
  elements.openBoardButton.addEventListener("click", handleOpenBoard);
  elements.copyUrlButton.addEventListener("click", handleCopyUrl);
  elements.clearHistoryButton.addEventListener("click", handleClearHistory);
  elements.historyList.addEventListener("click", handleHistoryClick);

  await refreshPopup();
  pollTimer = window.setInterval(refreshPopup, 900);
});

window.addEventListener("unload", () => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
});

async function handleStartClick() {
  if (activeTabId == null) {
    return;
  }

  elements.startButton.disabled = true;
  setStatusLine("Starting…");

  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "START_DOWNLOAD" });
  } catch (error) {
    setWarning(error.message || "Could not start the downloader.");
  }

  await refreshPopup();
}

async function handleCancelClick() {
  if (activeTabId == null) {
    return;
  }

  try {
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);
    await sendMessage({ type: "CANCEL_DOWNLOAD" });
  } catch (error) {
    setWarning(error.message || "Could not cancel the downloader.");
  }

  await refreshPopup();
}

async function handleManualRefresh() {
  setStatusLine("Refreshing board status…");
  await refreshPopup();
}

async function handleReloadTab() {
  if (activeTabId == null) {
    return;
  }

  elements.reloadTabButton.disabled = true;
  setStatusLine("Reloading the Pinterest tab…");

  try {
    await chrome.tabs.reload(activeTabId);
    await wait(900);
  } finally {
    elements.reloadTabButton.disabled = false;
  }

  await refreshPopup();
}

async function handleCopyUrl() {
  if (!currentTab?.url) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentTab.url);
    setStatusLine("Board URL copied.");
  } catch (error) {
    setWarning("Could not copy the tab URL.");
  }
}

async function handleOpenBoard() {
  if (!currentTab?.url) {
    return;
  }

  await chrome.tabs.create({ url: currentTab.url });
}

async function handleClearHistory() {
  await chrome.storage.local.remove([
    HISTORY_STORAGE_KEY,
    LEGACY_HISTORY_STORAGE_KEY
  ]);
  await refreshPopup();
}

async function handleHistoryClick(event) {
  const button = event.target.closest("[data-history-url]");
  if (!button) {
    return;
  }

  const url = button.getAttribute("data-history-url");
  if (!url) {
    return;
  }

  await chrome.tabs.create({ url });
}

async function refreshPopup() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  currentTab = tab;

  if (activeTabId == null) {
    renderUnavailable(null, "No active tab found.");
    return;
  }

  try {
    await ensureContentScriptReady(tab);

    const [context, status, history] = await Promise.all([
      sendMessage({ type: "GET_CONTEXT" }),
      sendMessage({ type: "GET_STATUS" }),
      getDownloadHistory()
    ]);

    render(tab, context, status, history);
  } catch (error) {
    const history = await getDownloadHistory();
    renderUnavailable(
      tab,
      `Open a Pinterest board page. ${APP_NAME} now auto-connects after install, but blocked or unsupported tabs still cannot be scanned.`,
      history
    );
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab || null;
}

async function sendMessage(message) {
  return chrome.tabs.sendMessage(activeTabId, message);
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id || !isInjectableTab(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/jszip.min.js", "content.js"]
    });
  }
}

function isInjectableTab(url) {
  return /^https:\/\/([a-z]+\.)?pinterest\.com\//i.test(url || "");
}

function render(tab, context, status, history) {
  if (!context?.ok) {
    renderUnavailable(
      tab,
      context?.reason || "This tab is not a Pinterest board.",
      history
    );
    return;
  }

  elements.title.textContent = context.boardName || "Board ready";
  elements.subtitle.textContent = buildSubtitle(context);
  elements.tabHint.textContent = tab?.url
    ? compactUrl(tab.url)
    : "Connected to the current tab.";
  elements.boardLine.textContent = context.boardName || "Detected";
  elements.matchLine.textContent = context.matchSource || "Board page";
  elements.lastZipLine.textContent =
    status?.downloadName || history?.[0]?.fileName || "None yet";
  elements.expectedPins.textContent = formatCount(context.pinCount);

  const safeStatus = normalizeStatus(status, context);

  elements.collectedPins.textContent = formatCount(safeStatus.collected);
  elements.downloadedPins.textContent = formatCount(safeStatus.downloaded);
  elements.progressFill.style.width = `${safeStatus.progressPercent}%`;
  elements.progressPercent.textContent = `${Math.round(
    safeStatus.progressPercent
  )}%`;
  elements.statePill.textContent = humanizeStage(safeStatus.stage);
  setPillTone(elements.statePill, safeStatus.stage);

  setStatusLine(safeStatus.message || "Ready.");

  if (context.warning) {
    setWarning(context.warning);
  } else if (safeStatus.warning) {
    setWarning(safeStatus.warning);
  } else {
    clearWarning();
  }

  const canStart = ["idle", "done", "error", "cancelled"].includes(
    safeStatus.stage
  );
  const canCancel = ["scanning", "downloading", "zipping"].includes(
    safeStatus.stage
  );

  elements.startButton.disabled = !canStart;
  elements.cancelButton.disabled = !canCancel;
  elements.cancelButton.classList.toggle("is-live", canCancel);
  elements.copyUrlButton.disabled = !tab?.url;
  elements.reloadTabButton.disabled = !tab?.id;
  elements.openBoardButton.disabled = !tab?.url;
  renderHistory(history || []);
}

function renderUnavailable(tab, message, history) {
  elements.title.textContent = "Waiting for a board";
  elements.subtitle.textContent =
    "Open a public Pinterest board page, then download it in one ZIP.";
  elements.tabHint.textContent = tab?.url
    ? compactUrl(tab.url)
    : "No active tab available.";
  elements.boardLine.textContent = "Not connected";
  elements.matchLine.textContent = explainMatch(tab?.url || "");
  elements.lastZipLine.textContent = history?.[0]?.fileName || "None yet";
  elements.expectedPins.textContent = "-";
  elements.collectedPins.textContent = "0";
  elements.downloadedPins.textContent = "0";
  elements.progressPercent.textContent = "0%";
  elements.progressFill.style.width = "0%";
  elements.statePill.textContent = "No Board";
  setPillTone(elements.statePill, "unavailable");
  elements.startButton.disabled = true;
  elements.cancelButton.disabled = true;
  elements.cancelButton.classList.remove("is-live");
  elements.copyUrlButton.disabled = !tab?.url;
  elements.reloadTabButton.disabled = !tab?.id;
  elements.openBoardButton.disabled = !tab?.url;
  setStatusLine(message);
  clearWarning();
  renderHistory(history || []);
}

function normalizeStatus(status, context) {
  if (!status) {
    return {
      stage: "idle",
      collected: 0,
      downloaded: 0,
      progressPercent: 0,
      message: "Ready."
    };
  }

  const expected = Number(context.pinCount) || 0;
  const collected = Number(status.collected) || 0;
  const downloaded = Number(status.downloaded) || 0;
  const stage = status.stage || "idle";
  let progressPercent = 0;

  if (stage === "scanning") {
    progressPercent = expected > 0 ? Math.min(100, (collected / expected) * 100) : 10;
  } else if (stage === "downloading") {
    progressPercent =
      collected > 0 ? Math.min(100, (downloaded / collected) * 100) : 0;
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
    message: status.message || "Ready.",
    warning: status.warning || ""
  };
}

function buildSubtitle(context) {
  const parts = [];

  if (context.ownerUsername) {
    parts.push(`@${context.ownerUsername}`);
  }

  if (context.pinCount) {
    parts.push(`${context.pinCount} pins`);
  }

  if (context.sectionCount) {
    parts.push(`${context.sectionCount} sections`);
  }

  return parts.length > 0
    ? parts.join(" • ")
    : `${APP_NAME} will collect every pin image it can detect on this board page.`;
}

function compactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "") || url.hostname;
  } catch {
    return rawUrl;
  }
}

function explainMatch(url) {
  if (!url) {
    return "Waiting";
  }

  if (!/^https:\/\/([a-z]+\.)?pinterest\.com\//i.test(url)) {
    return "Unsupported tab";
  }

  return "Pinterest page";
}

function humanizeStage(stage) {
  if (!stage) {
    return "Idle";
  }

  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function setPillTone(element, stage) {
  element.style.background =
    stage === "done"
      ? "rgba(52, 199, 89, 0.14)"
      : stage === "error"
        ? "rgba(255, 59, 48, 0.14)"
        : stage === "scanning" || stage === "downloading" || stage === "zipping"
          ? "rgba(10, 132, 255, 0.12)"
          : "rgba(120, 124, 132, 0.12)";

  element.style.color =
    stage === "done"
      ? "#1f7a3d"
      : stage === "error"
        ? "#c62828"
        : stage === "scanning" || stage === "downloading" || stage === "zipping"
          ? "#0a63c9"
          : "#4d535b";
}

function setStatusLine(message) {
  elements.statusLine.textContent = message;
}

function setWarning(message) {
  if (!message) {
    clearWarning();
    return;
  }

  elements.warningLine.textContent = message;
  elements.warningLine.classList.remove("hidden");
}

function clearWarning() {
  elements.warningLine.textContent = "";
  elements.warningLine.classList.add("hidden");
}

function formatCount(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    return value === 0 ? "0" : "-";
  }

  return new Intl.NumberFormat().format(Number(value));
}

async function getDownloadHistory() {
  const stored = await chrome.storage.local.get([
    HISTORY_STORAGE_KEY,
    LEGACY_HISTORY_STORAGE_KEY
  ]);

  if (Array.isArray(stored[HISTORY_STORAGE_KEY])) {
    return stored[HISTORY_STORAGE_KEY];
  }

  if (Array.isArray(stored[LEGACY_HISTORY_STORAGE_KEY])) {
    const legacyHistory = stored[LEGACY_HISTORY_STORAGE_KEY];

    try {
      await chrome.storage.local.set({
        [HISTORY_STORAGE_KEY]: legacyHistory
      });
    } catch {}

    return legacyHistory;
  }

  return [];
}

function renderHistory(history) {
  if (!history.length) {
    elements.historyList.innerHTML =
      '<p class="historyEmpty">No downloads yet.</p>';
    elements.clearHistoryButton.disabled = true;
    return;
  }

  elements.clearHistoryButton.disabled = false;
  elements.historyList.innerHTML = history
    .slice(0, 6)
    .map(
      (item) => `
        <article class="historyItem">
          <div class="historyTop">
            <div>
              <p class="historyBoard">${escapeHtml(item.boardName || "Untitled board")}</p>
              <p class="historyMeta">${escapeHtml(formatHistoryMeta(item))}</p>
            </div>
            ${
              item.boardUrl
                ? `<button class="historyOpen" type="button" data-history-url="${escapeAttribute(
                    item.boardUrl
                  )}">Open</button>`
                : ""
            }
          </div>
          <p class="historyFile">${escapeHtml(item.fileName || "ZIP created")}</p>
        </article>
      `
    )
    .join("");
}

function formatHistoryMeta(item) {
  const parts = [];

  if (item.downloadedCount) {
    parts.push(`${item.downloadedCount} images`);
  }

  if (item.failedCount) {
    parts.push(`${item.failedCount} failed`);
  }

  if (item.createdAt) {
    parts.push(formatHistoryDate(item.createdAt));
  }

  return parts.join(" • ") || "Saved";
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function wait(durationMs) {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
