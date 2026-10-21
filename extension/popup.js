const APP_NAME = "LocalBoard";
const HISTORY_STORAGE_KEY = "localBoardDownloadHistory";
const LEGACY_HISTORY_STORAGE_KEY = "downloadHistory";
const EXPORT_MODE_STORAGE_KEY = "localBoardExportMode";
const LARGE_BOARD_THRESHOLD = 400;
const CONTENT_PROTOCOL_VERSION = 4;
const ACTIVE_STAGES = new Set(["scanning", "downloading", "zipping"]);
const TERMINAL_STAGES = new Set(["done", "error", "cancelled"]);

const el = {
  boardName: document.getElementById("boardName"),
  boardMeta: document.getElementById("boardMeta"),
  boardUrl: document.getElementById("boardUrl"),
  boardWarning: document.getElementById("boardWarning"),
  statusPill: document.getElementById("statusPill"),
  statusPillText: document.getElementById("statusPillText"),
  setupSection: document.getElementById("setupSection"),
  largeBoardNotice: document.getElementById("largeBoardNotice"),
  exportModeGroup: document.getElementById("exportModeGroup"),
  singleMode: document.getElementById("singleMode"),
  partsMode: document.getElementById("partsMode"),
  modeRecommendation: document.getElementById("modeRecommendation"),
  workflowSteps: document.getElementById("workflowSteps"),
  progressSection: document.getElementById("progressSection"),
  progressFill: document.getElementById("progressFill"),
  statusMsg: document.getElementById("statusMsg"),
  progressPct: document.getElementById("progressPct"),
  statExpected: document.getElementById("statExpected"),
  statCollected: document.getElementById("statCollected"),
  statDownloaded: document.getElementById("statDownloaded"),
  warningLine: document.getElementById("warningLine"),
  selectionSection: document.getElementById("selectionSection"),
  selectionCount: document.getElementById("selectionCount"),
  idleActions: document.getElementById("idleActions"),
  selectionActions: document.getElementById("selectionActions"),
  selectButton: document.getElementById("selectButton"),
  startButton: document.getElementById("startButton"),
  exitSelectionButton: document.getElementById("exitSelectionButton"),
  downloadSelectedButton: document.getElementById("downloadSelectedButton"),
  cancelButton: document.getElementById("cancelButton"),
  historyDisclosure: document.getElementById("historyDisclosure"),
  historyList: document.getElementById("historyList"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  refreshButton: document.getElementById("refreshButton"),
  reloadTabButton: document.getElementById("reloadTabButton"),
  openBoardButton: document.getElementById("openBoardButton"),
};

let activeTabId = null;
let currentTab = null;
let pollTimer = null;
let selectedExportMode = "single";
let persistedExportMode = null;
let previewStatus = null;
let actionError = null;
let refreshPromise = null;
let refreshRevision = 0;
let refreshQueued = false;
let actionInFlight = 0;
let currentRunIsActive = false;

const previewState = new URLSearchParams(location.search).get("preview");
const hasExtensionApi = Boolean(
  globalThis.chrome?.tabs?.query && globalThis.chrome?.storage?.local
);

document.addEventListener("DOMContentLoaded", async () => {
  el.startButton.addEventListener("click", handleStartClick);
  el.selectButton.addEventListener("click", handleSelectClick);
  el.exitSelectionButton.addEventListener("click", handleExitSelectionClick);
  el.downloadSelectedButton.addEventListener("click", handleDownloadSelectedClick);
  el.cancelButton.addEventListener("click", handleCancelClick);
  el.refreshButton.addEventListener("click", handleManualRefresh);
  el.reloadTabButton.addEventListener("click", handleReloadTab);
  el.openBoardButton.addEventListener("click", handleOpenBoard);
  el.clearHistoryButton.addEventListener("click", handleClearHistory);
  el.historyList.addEventListener("click", handleHistoryClick);
  el.exportModeGroup.addEventListener("change", handleExportModeChange);

  if (!hasExtensionApi || previewState) {
    document.body.dataset.preview = previewState || "ready";
    renderPreviewFixture(previewState || "ready");
    return;
  }

  chrome.tabs.onActivated?.addListener(handleTabActivated);
  chrome.tabs.onUpdated?.addListener(handleTabUpdated);
  await loadExportModePreference();
  await refreshPopup();
  pollTimer = window.setInterval(() => {
    void refreshPopup(false);
  }, 900);
});

window.addEventListener("unload", () => {
  if (pollTimer) window.clearInterval(pollTimer);
  globalThis.chrome?.tabs?.onActivated?.removeListener(handleTabActivated);
  globalThis.chrome?.tabs?.onUpdated?.removeListener(handleTabUpdated);
});

async function handleStartClick() {
  if (!hasExtensionApi) {
    renderPreviewFixture("progress");
    return;
  }

  beginPopupAction();
  el.startButton.disabled = true;
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();
    await ensureContentScriptReady(tab);
    const response = await sendMessage(tab.id, {
      type: "START_DOWNLOAD",
      exportMode: selectedExportMode,
    });
    if (response?.ok === false) {
      throw new Error(response.reason || "Could not start the export.");
    }
  } catch (error) {
    setActionError(error?.message || "Could not start the export.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleSelectClick() {
  if (!hasExtensionApi) {
    renderPreviewFixture("selection");
    return;
  }

  beginPopupAction();
  el.selectButton.disabled = true;
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();
    await ensureContentScriptReady(tab);
    const response = await sendMessage(tab.id, { type: "ENTER_SELECTION_MODE" });
    if (response?.ok === false) {
      throw new Error(response.reason || "Could not enter selection mode.");
    }
  } catch (error) {
    setActionError(error?.message || "Could not enter selection mode.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleExitSelectionClick() {
  if (!hasExtensionApi) {
    renderPreviewFixture("ready");
    return;
  }

  beginPopupAction();
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();
    await ensureContentScriptReady(tab);
    const response = await sendMessage(tab.id, { type: "EXIT_SELECTION_MODE" });
    if (response?.ok === false) {
      throw new Error(response.reason || "Could not exit selection mode.");
    }
  } catch (error) {
    setActionError(error?.message || "Could not exit selection mode.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleDownloadSelectedClick() {
  if (!hasExtensionApi) {
    renderPreviewFixture("progress");
    return;
  }

  beginPopupAction();
  el.downloadSelectedButton.disabled = true;
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();
    await ensureContentScriptReady(tab);
    const selectionState = await sendMessage(tab.id, { type: "GET_SELECTION_STATE" });
    const pinIds = selectionState?.ids || [];
    if (pinIds.length === 0) {
      throw new Error("No pins selected. Click pins on the board page first.");
    }
    const response = await sendMessage(tab.id, {
      type: "START_DOWNLOAD",
      pinIds,
      exportMode: selectedExportMode,
    });
    if (response?.ok === false) {
      throw new Error(response.reason || "Could not start the export.");
    }
  } catch (error) {
    setActionError(error?.message || "Could not start the export.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleCancelClick() {
  if (!hasExtensionApi) {
    renderPreviewFixture("ready");
    return;
  }

  beginPopupAction();
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();
    await ensureContentScriptReady(tab);
    const response = await sendMessage(tab.id, { type: "CANCEL_DOWNLOAD" });
    if (response?.ok === false) {
      throw new Error(response.reason || "Could not cancel the export.");
    }
  } catch (error) {
    setActionError(error?.message || "Could not cancel the export.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleManualRefresh() {
  if (!hasExtensionApi) return;
  clearActionError();
  await refreshPopup();
}

async function handleReloadTab() {
  if (!hasExtensionApi) return;

  beginPopupAction();
  el.reloadTabButton.disabled = true;
  let tab = null;
  try {
    tab = await requireActiveTab();
    clearActionError();

    if (currentRunIsActive && tab.id === activeTabId) {
      throw new Error("Cancel the active export before reloading this Pinterest tab.");
    }

    let status = null;
    try {
      status = await sendMessage(tab.id, { type: "GET_STATUS" }, 1500);
    } catch {
      // A missing or outdated content script is exactly what a reload repairs.
    }

    if (
      status?.protocolVersion === CONTENT_PROTOCOL_VERSION &&
      ACTIVE_STAGES.has(status.stage)
    ) {
      throw new Error("Cancel the active export before reloading this Pinterest tab.");
    }

    await chrome.tabs.reload(tab.id);
    await wait(900);
  } catch (error) {
    setActionError(error?.message || "Could not reload this tab.", tab?.id);
  } finally {
    endPopupAction();
    await refreshPopup();
  }
}

async function handleOpenBoard() {
  if (!hasExtensionApi) return;
  const tab = await getActiveTab();
  if (tab?.url) await chrome.tabs.create({ url: tab.url });
}

async function handleClearHistory() {
  if (!hasExtensionApi) {
    renderHistory([]);
    return;
  }
  await chrome.storage.local.remove([HISTORY_STORAGE_KEY, LEGACY_HISTORY_STORAGE_KEY]);
  await refreshPopup();
}

async function handleHistoryClick(event) {
  const button = event.target.closest("[data-history-url]");
  if (!button || !hasExtensionApi) return;
  const url = button.getAttribute("data-history-url");
  if (url) await chrome.tabs.create({ url });
}

async function handleExportModeChange(event) {
  const mode = normalizeExportMode(event.target?.value);
  setExportMode(mode);
  persistedExportMode = mode;
  if (hasExtensionApi) {
    await chrome.storage.local.set({ [EXPORT_MODE_STORAGE_KEY]: mode });
  }
}

async function loadExportModePreference() {
  try {
    const stored = await chrome.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    const mode = stored[EXPORT_MODE_STORAGE_KEY];
    if (mode === "single" || mode === "parts") {
      persistedExportMode = mode;
      setExportMode(mode);
    }
  } catch {
    persistedExportMode = null;
  }
}

function refreshPopup(invalidateCurrent = true) {
  const requestedRevision = invalidateCurrent ? ++refreshRevision : refreshRevision;

  if (refreshPromise) {
    if (invalidateCurrent) refreshQueued = true;
    return refreshPromise;
  }

  refreshPromise = (async () => {
    let revision = requestedRevision;

    while (true) {
      refreshQueued = false;
      await performRefresh(revision);
      if (!refreshQueued) break;
      revision = refreshRevision;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function performRefresh(revision) {
  let tab = null;
  let history = [];

  try {
    tab = await getActiveTab();
    if (!tab?.id) {
      if (canCommitRefresh(revision)) {
        commitActiveTab(null);
        renderUnavailable(null, "No active tab found.");
      }
      return;
    }

    const status = await ensureContentScriptReady(tab);
    const [context, loadedHistory] = await Promise.all([
      sendMessage(tab.id, { type: "GET_CONTEXT" }),
      getDownloadHistory(),
    ]);
    history = loadedHistory;

    if (!canCommitRefresh(revision)) return;
    commitActiveTab(tab);
    render(tab, context, status, history);
  } catch (error) {
    try {
      history = await getDownloadHistory();
    } catch {
      history = [];
    }

    if (!canCommitRefresh(revision)) return;
    commitActiveTab(tab);
    const message =
      error instanceof ContentProtocolMismatchError
        ? error.message
        : "Open a Pinterest board page to get started.";
    renderUnavailable(tab, message, history);
  }
}

function canCommitRefresh(revision) {
  return revision === refreshRevision && actionInFlight === 0;
}

function commitActiveTab(tab) {
  const nextTabId = tab?.id ?? null;
  if (activeTabId != null && nextTabId !== activeTabId) {
    clearActionError();
  }
  activeTabId = nextTabId;
  currentTab = tab;
}

function handleTabActivated() {
  clearActionError();
  void refreshPopup();
}

function handleTabUpdated(_tabId, changeInfo, tab) {
  if (!tab?.active || (!changeInfo.url && changeInfo.status !== "complete")) return;
  void refreshPopup();
}

function render(tab, context, status, history) {
  if (!context?.ok) {
    renderUnavailable(tab, context?.reason || "This tab is not a Pinterest board.", history);
    return;
  }

  const safeStatus = normalizeStatus(getStatusForContext(status, context), context);
  const inSelection = Boolean(safeStatus.selectionActive);
  const selectionCount = Number(safeStatus.selectionCount) || 0;
  const isActive = ACTIVE_STAGES.has(safeStatus.stage);
  const isIdle = safeStatus.stage === "idle" || TERMINAL_STAGES.has(safeStatus.stage);
  const isLargeBoard = Number(context.pinCount) >= LARGE_BOARD_THRESHOLD;
  const isPreviousBoardRun = Boolean(safeStatus.contextMismatch);
  currentRunIsActive = isActive;

  if (!persistedExportMode && !isActive) {
    setExportMode(isLargeBoard ? "parts" : "single");
  }
  if (safeStatus.exportMode && isActive) {
    setExportMode(safeStatus.exportMode);
  }

  el.boardName.textContent = isPreviousBoardRun
    ? safeStatus.boardName || "Previous board export"
    : context.boardName || "Board detected";
  el.boardMeta.textContent = isPreviousBoardRun
    ? `Export still running · current tab is ${context.boardName || "another board"}`
    : buildMeta(context);
  el.boardUrl.textContent = isPreviousBoardRun
    ? compactUrl(safeStatus.boardUrl || "")
    : (tab?.url ? compactUrl(tab.url) : "");
  el.largeBoardNotice.classList.toggle("hidden", !isLargeBoard || isPreviousBoardRun);
  el.modeRecommendation.classList.toggle("hidden", !isLargeBoard || isPreviousBoardRun);
  setPill(safeStatus.stage, inSelection);
  setWorkflowStage(safeStatus.stage);

  const showProgress = isActive || ["done", "error", "cancelled"].includes(safeStatus.stage);
  el.progressSection.classList.toggle("hidden", !showProgress);
  if (showProgress) {
    el.progressFill.style.width = `${safeStatus.progressPercent}%`;
    el.progressPct.textContent = `${Math.round(safeStatus.progressPercent)}%`;
    el.statusMsg.textContent = safeStatus.message || "Working…";
    el.statExpected.textContent = formatCount(safeStatus.expected || context.pinCount, "expected");
    el.statCollected.textContent = formatCount(safeStatus.collected, "found");
    el.statDownloaded.textContent = formatCount(safeStatus.downloaded, "saved");
    setInlineWarning(safeStatus.warning || "");
  }

  el.selectionSection.classList.toggle("hidden", !inSelection);
  if (inSelection) {
    el.selectionCount.textContent = `${selectionCount} ${selectionCount === 1 ? "pin" : "pins"} selected`;
  }

  el.idleActions.classList.toggle("hidden", inSelection || isActive);
  el.selectionActions.classList.toggle("hidden", !inSelection || isActive);
  el.cancelButton.classList.toggle("hidden", !isActive);

  el.startButton.disabled = !isIdle;
  el.selectButton.disabled = !isIdle;
  el.downloadSelectedButton.disabled = selectionCount === 0;
  el.cancelButton.disabled = !isActive;
  el.openBoardButton.disabled = !tab?.url;
  el.reloadTabButton.disabled = !tab?.id || isActive;
  el.singleMode.disabled = isActive || inSelection;
  el.partsMode.disabled = isActive || inSelection;
  el.startButton.querySelector("span").textContent = safeStatus.stage === "done" ? "Export again" : "Start export";

  renderBoardWarning(
    tab?.id,
    isPreviousBoardRun
      ? "This export belongs to the previous board. Let it finish or cancel it before starting on the current board."
      : (!isActive ? context.warning : "")
  );

  renderHistory(history || []);
}

function renderUnavailable(tab, message, history = []) {
  currentRunIsActive = false;
  el.boardName.textContent = "No board detected";
  el.boardMeta.textContent = message;
  el.boardUrl.textContent = tab?.url ? compactUrl(tab.url) : "";
  el.largeBoardNotice.classList.add("hidden");
  el.modeRecommendation.classList.add("hidden");
  setPill("unavailable", false);
  setWorkflowStage("idle");

  el.progressSection.classList.add("hidden");
  el.selectionSection.classList.add("hidden");
  el.idleActions.classList.remove("hidden");
  el.selectionActions.classList.add("hidden");
  el.cancelButton.classList.add("hidden");

  el.startButton.disabled = true;
  el.selectButton.disabled = true;
  el.downloadSelectedButton.disabled = true;
  el.cancelButton.disabled = true;
  el.singleMode.disabled = true;
  el.partsMode.disabled = true;
  el.openBoardButton.disabled = !tab?.url;
  el.reloadTabButton.disabled = !tab?.id;
  renderBoardWarning(tab?.id, "");
  renderHistory(history);
}

function renderPreviewFixture(stateName) {
  const tab = {
    id: 7,
    url: "https://www.pinterest.com/txtgrey/interior-reference/",
  };
  const context = {
    ok: true,
    protocolVersion: CONTENT_PROTOCOL_VERSION,
    boardKey: "txtgrey/interior-reference",
    boardName: "Interior Reference",
    boardUrl: "/txtgrey/interior-reference/",
    ownerUsername: "txtgrey",
    pinCount: 1248,
    sectionCount: 4,
    warning: "",
  };
  const history = [
    {
      boardName: "Travel lighting",
      boardUrl: "https://www.pinterest.com/",
      downloadedCount: 824,
      partCount: 4,
      createdAt: Date.now() - 86_400_000,
    },
  ];

  const states = {
    ready: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: context.boardKey,
      stage: "idle",
      message: "Ready.",
      collected: 0,
      downloaded: 0,
      expected: 1248,
      exportMode: "parts",
    },
    progress: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: context.boardKey,
      stage: "downloading",
      message: "Saving part 3 of 5 — 684 of 1,248 images…",
      collected: 1248,
      downloaded: 684,
      expected: 1248,
      failed: 0,
      partIndex: 3,
      partCount: 5,
      exportMode: "parts",
    },
    done: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: context.boardKey,
      stage: "done",
      message: "Export complete — 1,248 images saved in 5 ZIP parts.",
      collected: 1248,
      downloaded: 1248,
      expected: 1248,
      zipProgress: 100,
      partIndex: 5,
      partCount: 5,
      exportMode: "parts",
    },
    selection: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: context.boardKey,
      stage: "idle",
      message: "Ready.",
      collected: 0,
      downloaded: 0,
      expected: 34,
      selectionActive: true,
      selectionCount: 34,
      exportMode: "single",
    },
    mismatch: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: "id:previous-board",
      boardName: "Previous Moodboard",
      boardUrl: "https://www.pinterest.com/txtgrey/previous-moodboard/",
      stage: "downloading",
      message: "Saving 180 of 320 images…",
      collected: 320,
      downloaded: 180,
      expected: 320,
      failed: 0,
      exportMode: "parts",
    },
    upgrade: {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: "url:www.pinterest.com/txtgrey/interior-reference/",
      boardName: "Interior Reference",
      boardUrl: "https://www.pinterest.com/txtgrey/interior-reference/",
      stage: "scanning",
      message: "Scanning the board… found 120 of 1,248 pins so far.",
      collected: 120,
      downloaded: 0,
      expected: 1248,
      failed: 0,
      exportMode: "parts",
    },
  };

  previewStatus = states[stateName] || states.ready;
  activeTabId = tab.id;
  currentTab = tab;
  persistedExportMode = previewStatus.exportMode;
  setExportMode(previewStatus.exportMode);
  render(tab, context, previewStatus, history);
  if (stateName === "done") el.historyDisclosure.open = true;
}

function getStatusForContext(status, context) {
  if (!status || !context?.boardKey || !status.boardKey) {
    return status;
  }

  if (
    status.boardKey === context.boardKey ||
    status.stage === "idle" ||
    isSameBoardLocation(status.boardUrl, context.boardUrl)
  ) {
    return status;
  }

  if (ACTIVE_STAGES.has(status.stage)) {
    return { ...status, contextMismatch: true };
  }

  return null;
}

function isSameBoardLocation(runUrl, contextUrl) {
  if (!runUrl || !contextUrl) return false;

  try {
    const run = new URL(runUrl);
    const context = new URL(contextUrl, run.origin);
    if (run.hostname.toLowerCase() !== context.hostname.toLowerCase()) {
      return false;
    }

    const runPath = normalizeBoardPath(run.pathname);
    const contextPath = normalizeBoardPath(context.pathname);
    return (
      runPath === contextPath ||
      runPath.startsWith(contextPath) ||
      contextPath.startsWith(runPath)
    );
  } catch {
    return false;
  }
}

function normalizeBoardPath(pathname) {
  const normalized = String(pathname || "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeStatus(status, context) {
  if (!status) {
    return {
      stage: "idle",
      collected: 0,
      downloaded: 0,
      expected: Number(context.pinCount) || 0,
      progressPercent: 0,
      message: "Ready.",
      selectionActive: false,
      selectionCount: 0,
      exportMode: selectedExportMode,
    };
  }

  const expected = Number(status.expected || context.pinCount) || 0;
  const collected = Number(status.collected) || 0;
  const downloaded = Number(status.downloaded) || 0;
  const stage = status.stage || "idle";
  let progressPercent = 0;

  if (stage === "scanning") {
    progressPercent = expected > 0 ? Math.min(100, (collected / expected) * 100) : 12;
  } else if (stage === "downloading") {
    progressPercent = collected > 0 ? Math.min(100, (downloaded / collected) * 100) : 0;
  } else if (stage === "zipping") {
    progressPercent = Number(status.zipProgress) || 0;
  } else if (stage === "done") {
    progressPercent = 100;
  }

  return {
    ...status,
    stage,
    expected,
    collected,
    downloaded,
    progressPercent: Math.max(0, Math.min(100, progressPercent)),
    message: status.message || "Ready.",
    warning: status.warning || "",
    selectionActive: Boolean(status.selectionActive),
    selectionCount: Number(status.selectionCount) || 0,
    exportMode: normalizeExportMode(status.exportMode || selectedExportMode),
  };
}

function setExportMode(mode) {
  selectedExportMode = normalizeExportMode(mode);
  el.singleMode.checked = selectedExportMode === "single";
  el.partsMode.checked = selectedExportMode === "parts";
}

function normalizeExportMode(mode) {
  return mode === "parts" ? "parts" : "single";
}

function setWorkflowStage(stage) {
  const order = { scan: 0, save: 1, pack: 2 };
  const activeIndex = stage === "downloading" ? 1 : stage === "zipping" ? 2 : 0;
  const isDone = stage === "done";

  for (const item of el.workflowSteps.querySelectorAll("li")) {
    const itemIndex = order[item.dataset.step] ?? 0;
    item.classList.toggle("is-current", !isDone && itemIndex === activeIndex);
    item.classList.toggle("is-complete", isDone || itemIndex < activeIndex);
  }
}

function buildMeta(context) {
  const parts = [];
  if (context.ownerUsername) parts.push(`@${context.ownerUsername}`);
  if (context.pinCount) parts.push(`${new Intl.NumberFormat().format(context.pinCount)} pins`);
  if (context.sectionCount) parts.push(`${context.sectionCount} sections`);
  return parts.join(" · ");
}

function compactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "") || url.hostname;
  } catch {
    return rawUrl;
  }
}

function formatCount(value, suffix) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return `— ${suffix}`;
  return `${new Intl.NumberFormat().format(count)} ${suffix}`;
}

function setPill(stage, inSelection) {
  const labels = {
    idle: "Ready",
    scanning: "Scanning",
    downloading: "Saving",
    zipping: "Packing",
    done: "Complete",
    error: "Needs attention",
    cancelled: "Cancelled",
    unavailable: "No board",
  };
  el.statusPillText.textContent = inSelection ? "Selecting" : labels[stage] || "Ready";
  el.statusPill.className = "pill";
  if (inSelection) {
    el.statusPill.classList.add("select");
  } else if (["scanning", "downloading", "zipping"].includes(stage)) {
    el.statusPill.classList.add("active");
  } else if (stage === "done") {
    el.statusPill.classList.add("done");
  } else if (stage === "error") {
    el.statusPill.classList.add("error");
  } else if (stage === "idle") {
    el.statusPill.classList.add("ready");
  }
}

function beginPopupAction() {
  actionInFlight += 1;
  refreshRevision += 1;
}

function endPopupAction() {
  actionInFlight = Math.max(0, actionInFlight - 1);
}

function setActionError(message, tabId = activeTabId) {
  actionError = {
    message: String(message || "Something went wrong."),
    tabId: tabId ?? activeTabId ?? null,
  };
  showBoardWarning(actionError.message);
}

function clearActionError() {
  actionError = null;
}

function renderBoardWarning(tabId, fallbackMessage = "") {
  const visibleActionError =
    actionError &&
    (actionError.tabId == null || actionError.tabId === (tabId ?? null))
      ? actionError.message
      : "";
  showBoardWarning(visibleActionError || fallbackMessage);
}

function showBoardWarning(message) {
  if (!message) {
    clearBoardWarning();
    return;
  }
  el.boardWarning.textContent = message;
  el.boardWarning.classList.remove("hidden");
}

function clearBoardWarning() {
  el.boardWarning.textContent = "";
  el.boardWarning.classList.add("hidden");
}

function setInlineWarning(message) {
  if (!message) {
    el.warningLine.textContent = "";
    el.warningLine.classList.add("hidden");
    return;
  }
  el.warningLine.textContent = message;
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
      const openButton = item.boardUrl
        ? `<button class="history-open" type="button" data-history-url="${escAttr(item.boardUrl)}">Open</button>`
        : "";
      return `
        <article class="history-item">
          <span class="history-name">${escHtml(item.boardName || "Untitled")}</span>
          <span class="history-detail">${escHtml(buildHistoryDetail(item))}</span>
          ${openButton}
        </article>
      `;
    })
    .join("");
}

function buildHistoryDetail(item) {
  const parts = [];
  if (item.downloadedCount) parts.push(`${new Intl.NumberFormat().format(item.downloadedCount)} images`);
  if (item.partCount > 1) parts.push(`${item.partCount} ZIPs`);
  if (item.createdAt) {
    const date = new Date(item.createdAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date));
    }
  }
  return parts.join(" · ") || "Saved";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function requireActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function sendMessage(tabId, message, timeoutMs = 6000) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No Pinterest tab is available for this action.");
  }

  let timeoutId = null;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Content script did not respond in time.")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id || !isInjectableTab(tab.url)) {
    throw new Error("Open a Pinterest board page to get started.");
  }

  try {
    const status = await sendMessage(tab.id, { type: "GET_STATUS" });
    assertContentProtocol(status);
    return status;
  } catch (error) {
    if (error instanceof ContentProtocolMismatchError) throw error;
    // Inject below for Pinterest tabs opened before installation or reload.
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["vendor/jszip.min.js", "content.js"],
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(300);
    try {
      const status = await sendMessage(tab.id, { type: "GET_STATUS" });
      assertContentProtocol(status);
      return status;
    } catch (error) {
      if (error instanceof ContentProtocolMismatchError) throw error;
      // Content script is still initializing.
    }
  }

  throw new Error("LocalBoard could not start on this tab. Reload Pinterest and try again.");
}

function assertContentProtocol(response) {
  if (response?.protocolVersion === CONTENT_PROTOCOL_VERSION) return;
  throw new ContentProtocolMismatchError();
}

class ContentProtocolMismatchError extends Error {
  constructor() {
    super(
      "LocalBoard was updated, but this Pinterest tab is still running an older version. Reload the Pinterest tab once, then reopen LocalBoard."
    );
    this.name = "ContentProtocolMismatchError";
  }
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
    try {
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: legacy });
    } catch {
      // History still renders even if migration cannot be persisted.
    }
    return legacy;
  }
  return [];
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(value) {
  return escHtml(value);
}

function wait(durationMs) {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
