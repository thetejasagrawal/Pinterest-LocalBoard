(() => {
  if (
    globalThis.__PINTEREST_LOCALBOARD_LOADED__ ||
    globalThis.__PINTEREST_BOARD_ZIP_DOWNLOADER_LOADED__
  ) {
    return;
  }

  globalThis.__PINTEREST_LOCALBOARD_LOADED__ = true;
  globalThis.__PINTEREST_BOARD_ZIP_DOWNLOADER_LOADED__ = true;

  const PIN_CARD_SELECTOR = '[data-test-id="pin"][data-test-pin-id]';
  const PINIMG_URL_RE = /^https:\/\/i\.pinimg\.com\//i;
  const RECOMMENDATION_HEADING_RE = /^(?:find more (?:ideas|pins)|more like this|you might also like|(?:weitere|mehr) ideen(?: finden)?|encuentra m[aá]s ideas|trouvez plus d['’]id[eé]es|trova altre idee|encontre mais ideias|meer idee[eë]n vinden|znajd[zź] wi[eę]cej pomys[lł][oó]w|daha fazla fikir bul|t[iì]m th[eê]m [yý] t[uư][oở]ng|temukan lebih banyak ide|найти больше идей|アイデアをもっと見つける|더 많은 아이디어 찾기)/iu;
  const RECOMMENDATION_MARKER_RE = /(?:find more (?:ideas|pins)|more (?:ideas|like this)|related pins|recommend(?:ation|ed)(?: feed| pins| ideas)?|suggested(?: feed| pins| ideas)?)/i;
  const CONTENT_PROTOCOL_VERSION = 4;
  const EXTENSION_NAME = "Pinterest LocalBoard";
  const DOWNLOAD_HISTORY_STORAGE_KEY = "localBoardDownloadHistory";
  const LEGACY_DOWNLOAD_HISTORY_STORAGE_KEY = "downloadHistory";
  const RESUME_STORAGE_KEY = "localBoardResumeCheckpoint";
  const MAX_DOWNLOAD_HISTORY_ITEMS = 20;
  const MAX_FOLDER_NAME_LENGTH = 48;
  const MAX_ARCHIVE_BASE_NAME_LENGTH = 72;
  const MAX_IMAGE_FILENAME_LENGTH = 120;
  const MAX_IMAGE_TITLE_LENGTH = 64;
  const SMART_PART_SIZE = 250;
  const SCAN_STALL_GRACE_MS = 12_000;
  const SCAN_KNOWN_INCOMPLETE_GRACE_MS = 60_000;
  const SCAN_EMPTY_GRACE_MS = 30_000;
  const SCAN_STAGNANT_PASS_LIMIT = 2;
  const SCAN_HARD_LIMIT_MS = 20 * 60_000;
  const RESERVED_PATH_SEGMENTS = new Set([
    "",
    "pin",
    "ideas",
    "search",
    "discover",
    "topics",
    "business",
    "videos",
    "shopping",
    "today",
    "explore",
    "login",
    "settings",
    "_",
    "source"
  ]);
  const STAGES = new Set([
    "idle",
    "scanning",
    "downloading",
    "zipping",
    "done",
    "error",
    "cancelled"
  ]);

  const state = {
    contextCache: null,
    contextUrl: "",
    run: createIdleStatus(),
    overlay: null,
    jobPromise: null,
    abortController: null
  };

  const selection = {
    active: false,
    selectedIds: new Set(),
    acceptedBoardIds: new Set(),
    styleEl: null,
    barHost: null,
    clickHandler: null,
    observer: null,
    recommendationIds: new Set(),
    _barCountEl: null,
    _barDlBtn: null,
  };

  class CancelledError extends Error {
    constructor(message = "Download cancelled.") {
      super(message);
      this.name = "CancelledError";
    }
  }

  class BoardChangedError extends Error {
    constructor() {
      super(
        "The Pinterest board changed while LocalBoard was scanning. No ZIP was created. Start the export again on the current board."
      );
      this.name = "BoardChangedError";
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "Invalid message." });
      return false;
    }

    if (message.type === "GET_CONTEXT") {
      sendResponse(getBoardContext());
      return false;
    }

    if (message.type === "GET_STATUS") {
      sendResponse(getSerializableStatus());
      return false;
    }

    if (message.type === "CANCEL_DOWNLOAD") {
      requestCancel();
      sendResponse({ ok: true, status: getSerializableStatus() });
      return false;
    }

    if (message.type === "START_DOWNLOAD") {
      try {
        beginRun(message.pinIds || null, message.exportMode);
        sendResponse({ ok: true, status: getSerializableStatus() });
      } catch (error) {
        sendResponse({
          ok: false,
          reason: error?.message || "Could not start the downloader."
        });
      }

      return false;
    }

    if (message.type === "ENTER_SELECTION_MODE") {
      enterSelectionMode();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "EXIT_SELECTION_MODE") {
      exitSelectionMode();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GET_SELECTION_STATE") {
      sendResponse({
        active: selection.active,
        count: selection.selectedIds.size,
        ids: [...selection.selectedIds]
      });
      return false;
    }

    sendResponse({ ok: false, reason: "Unsupported message." });
    return false;
  });

  function createIdleStatus() {
    return {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      boardKey: "",
      boardName: "",
      boardUrl: "",
      stage: "idle",
      message: "Ready.",
      collected: 0,
      downloaded: 0,
      failed: 0,
      expected: 0,
      zipProgress: 0,
      warning: "",
      cancelRequested: false,
      startedAt: 0,
      finishedAt: 0,
      downloadName: "",
      error: "",
      exportMode: "single",
      partIndex: 0,
      partCount: 1,
      partsCompleted: 0
    };
  }

  function getSerializableStatus() {
    return {
      ...state.run,
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      stage: STAGES.has(state.run.stage) ? state.run.stage : "idle",
      selectionActive: selection.active,
      selectionCount: selection.selectedIds.size
    };
  }

  function updateRun(partial) {
    state.run = {
      ...state.run,
      ...partial
    };

    renderOverlay();
    notifyStatusChange();
  }

  function notifyStatusChange() {
    chrome.runtime.sendMessage({
      type: "STATUS_CHANGED",
      status: getSerializableStatus()
    }).catch(() => {});
  }

  function beginRun(pinIds = null, requestedExportMode = "single") {
    if (state.jobPromise) {
      throw new Error("An export is already running. Cancel it before starting another one.");
    }

    const context = getBoardContext();
    if (!context.ok) {
      throw new Error(context.reason || "This page is not a Pinterest board.");
    }

    if (context.sectionCount > 0) {
      context.warning =
        "This board has sections. If Pinterest is showing section tiles instead of pins, open the board's All Pins view or a section page first.";
    }

    if (selection.active) {
      exitSelectionMode();
    }

    state.abortController = new AbortController();
    const exportMode = requestedExportMode === "parts" ? "parts" : "single";
    state.jobPromise = runDownloadWorkflow(context, pinIds, exportMode)
      .catch((error) => {
        console.error(`${EXTENSION_NAME}:`, error);
      })
      .finally(() => {
        state.jobPromise = null;
        state.abortController = null;
      });
  }

  function requestCancel() {
    if (!state.jobPromise) {
      return;
    }

    updateRun({
      cancelRequested: true,
      message: "Cancelling…"
    });
    state.abortController?.abort();
  }

  function assertNotCancelled(runSignal = null) {
    if (state.run.cancelRequested || runSignal?.aborted) {
      throw new CancelledError();
    }
  }

  async function runDownloadWorkflow(context, pinIds = null, exportMode = "single") {
    const initialScrollY = window.scrollY;
    const exactBoardUrl = location.href;
    const exportScope = pinIds?.length ? "selection" : "board";
    const runSignal = state.abortController?.signal;

    updateRun({
      boardKey: context.boardKey || "",
      boardName: context.boardName || "Pinterest board",
      boardUrl: exactBoardUrl,
      stage: "scanning",
      message: pinIds
        ? `Scanning for ${pinIds.length} selected ${pinIds.length === 1 ? "pin" : "pins"}…`
        : "Scanning the board and collecting full-quality image links…",
      collected: 0,
      downloaded: 0,
      failed: 0,
      expected: pinIds ? pinIds.length : (context.pinCount || 0),
      zipProgress: 0,
      warning: context.warning || "",
      cancelRequested: false,
      startedAt: Date.now(),
      finishedAt: 0,
      downloadName: "",
      error: "",
      exportMode,
      partIndex: 0,
      partCount: 1,
      partsCompleted: 0
    });

    try {
      const scanResult = await collectBoardRecords(context, pinIds, exactBoardUrl);
      const records = scanResult.records;
      assertNotCancelled(runSignal);

      const resumeIdentity =
        exportMode === "parts"
          ? await createResumeIdentity(records, exportScope, exactBoardUrl)
          : null;
      assertNotCancelled(runSignal);
      const resumeCheckpoint =
        resumeIdentity
          ? await getResumeCheckpoint(context, records.length, resumeIdentity)
          : null;
      assertNotCancelled(runSignal);

      window.scrollTo(0, initialScrollY);

      updateRun({
        stage: "downloading",
        message:
          exportMode === "parts"
            ? `Saving ${records.length} images in memory-safe ZIP parts…`
            : `Saving ${records.length} images and preparing one ZIP…`,
        collected: records.length,
        downloaded: 0,
        failed: 0
      });

      if (resumeCheckpoint?.completedParts > 0) {
        updateRun({
          downloaded: resumeCheckpoint.downloaded,
          failed: resumeCheckpoint.failed,
          partIndex: resumeCheckpoint.completedParts + 1,
          partCount: resumeCheckpoint.partCount,
          partsCompleted: resumeCheckpoint.completedParts,
          message: `Resuming at ZIP part ${resumeCheckpoint.completedParts + 1} of ${resumeCheckpoint.partCount}…`
        });
      }

      const zipResult = await buildExport(
        records,
        context,
        scanResult,
        runSignal,
        exportMode,
        resumeCheckpoint,
        resumeIdentity
      );
      assertNotCancelled(runSignal);

      await appendDownloadHistoryEntry({
        boardName: context.boardName,
        boardUrl: location.href,
        fileName: zipResult.filename,
        downloadedCount: zipResult.downloadedCount,
        failedCount: zipResult.failedCount,
        partCount: zipResult.partCount,
        exportMode,
        createdAt: Date.now()
      });
      assertNotCancelled(runSignal);
      await clearResumeCheckpoint(resumeIdentity);
      assertNotCancelled(runSignal);

      updateRun({
        stage: "done",
        message: zipResult.message,
        downloaded: zipResult.downloadedCount,
        failed: zipResult.failedCount,
        zipProgress: 100,
        finishedAt: Date.now(),
        downloadName: zipResult.filename,
        partIndex: zipResult.partCount,
        partCount: zipResult.partCount,
        partsCompleted: zipResult.partCount,
        warning: zipResult.warning || ""
      });
    } catch (error) {
      window.scrollTo(0, initialScrollY);

      if (error instanceof CancelledError) {
        updateRun({
          stage: "cancelled",
          message: error.message,
          finishedAt: Date.now()
        });
        return;
      }

      updateRun({
        stage: "error",
        message: error?.message || "The download failed.",
        error: error?.message || "The download failed.",
        finishedAt: Date.now()
      });
      throw error;
    }
  }

  function getBoardContext() {
    if (state.contextUrl !== location.href) {
      state.contextUrl = location.href;
      state.contextCache = null;
    }

    // URL-only detection is intentionally a temporary fallback. Pinterest can
    // add its board JSON after the popup first asks for context, so keep
    // probing until the fallback upgrades to authoritative board metadata.
    if (state.contextCache?.ok && !isWeakBoardContext(state.contextCache)) {
      return state.contextCache;
    }

    const initialProps = parseInitialProps();
    const board =
      detectBoardFromInitialState(initialProps) ||
      detectBoardFromResources(initialProps) ||
      detectBoardFromPath();

    if (!board) {
      return {
        protocolVersion: CONTENT_PROTOCOL_VERSION,
        boardKey: "",
        ok: false,
        reason: buildBoardDetectionFailureReason()
      };
    }

    const boardId = String(board.id || "");
    const boardUrl = board.url || location.pathname;
    const nextContext = {
      protocolVersion: CONTENT_PROTOCOL_VERSION,
      ok: true,
      boardId,
      boardKey: buildBoardKey(boardId, boardUrl),
      boardName: board.name || document.title || "Pinterest board",
      boardUrl,
      ownerUsername: board.owner?.username || "",
      pinCount: Number(board.pin_count) || 0,
      sectionCount: Number(board.section_count) || 0,
      warning: board.warning || "",
      matchSource: board.matchSource || "Pinterest board JSON"
    };
    state.contextCache = nextContext;
    synchronizeRunBoardContext(nextContext);

    return state.contextCache;
  }

  function synchronizeRunBoardContext(context) {
    if (
      !context?.ok ||
      !state.jobPromise ||
      !["scanning", "downloading", "zipping"].includes(state.run.stage) ||
      !state.run.boardUrl ||
      getBoardPageKey(state.run.boardUrl) !== getBoardPageKey(location.href)
    ) {
      return;
    }

    const runUsedTemporaryIdentity = String(state.run.boardKey || "").startsWith("url:");
    if (runUsedTemporaryIdentity && context.boardKey) {
      state.run = {
        ...state.run,
        boardKey: context.boardKey,
        boardName: context.boardName || state.run.boardName
      };
    }
  }

  function isWeakBoardContext(context) {
    return !context?.boardId || context.matchSource === "Board URL pattern";
  }

  function buildBoardKey(boardId, boardUrl) {
    if (boardId) {
      return `id:${String(boardId)}`;
    }

    try {
      const url = new URL(boardUrl || location.pathname, location.origin);
      return `url:${url.hostname.toLowerCase()}${normalizePath(url.pathname).toLowerCase()}`;
    } catch {
      return `url:${normalizePath(location.pathname).toLowerCase()}`;
    }
  }

  function detectBoardFromInitialState(initialProps) {
    const boards = initialProps?.initialReduxState?.boards || {};
    const boardCandidates = Object.values(boards).filter(
      (candidate) => candidate && typeof candidate === "object"
    );

    if (boardCandidates.length === 0) {
      return null;
    }

    const matchedBoard = findBestBoardCandidate(boardCandidates);
    if (matchedBoard) {
      return {
        ...matchedBoard,
        matchSource: "Pinterest board state"
      };
    }

    return null;
  }

  function detectBoardFromResources(initialProps) {
    const resources = initialProps?.initialReduxState?.resources || {};
    const boardEntries = Object.values(resources.BoardResource || {})
      .map((entry) => entry?.data)
      .filter(Boolean);

    if (boardEntries.length === 0) {
      return null;
    }

    const matchedBoard = findBestBoardCandidate(boardEntries);
    if (matchedBoard) {
      return {
        ...matchedBoard,
        matchSource: "Pinterest board resource"
      };
    }

    return null;
  }

  function findBestBoardCandidate(boardCandidates) {
    const normalizedLocationPath = normalizePath(location.pathname);

    return (
      boardCandidates.find(
        (candidate) =>
          typeof candidate?.url === "string" &&
          normalizedLocationPath.startsWith(normalizePath(candidate.url))
      ) || null
    );
  }

  function detectBoardFromPath() {
    if (!isProbablyBoardPath(location.pathname)) {
      return null;
    }

    const pathSegments = location.pathname.split("/").filter(Boolean);
    const ownerUsername = pathSegments[0] || "";
    const boardSlug = pathSegments[1] || "";
    const sectionCount = pathSegments.length > 2 ? 1 : 0;
    const heading =
      document.querySelector("h1")?.textContent?.trim() || document.title || "";

    return {
      id: "",
      url: `/${ownerUsername}/${boardSlug}/`,
      owner: { username: ownerUsername },
      name: cleanBoardName(heading, boardSlug),
      pin_count: 0,
      section_count: sectionCount,
      warning:
        "Board metadata is being inferred from the URL. If counts stay blank, wait for Pinterest to finish loading the board.",
      matchSource: "Board URL pattern"
    };
  }

  function buildBoardDetectionFailureReason() {
    if (!/^https:\/\/([a-z]+\.)?pinterest\.com\//i.test(location.href)) {
      return "This tab is not a Pinterest page.";
    }

    if (!isProbablyBoardPath(location.pathname)) {
      return "Current Pinterest page is not a board. Open a URL like pinterest.com/<user>/<board>/ first.";
    }

    return "Pinterest has not exposed board data on this page yet. Wait a second and reopen the popup, or refresh the board once.";
  }

  function isProbablyBoardPath(pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts.length > 3) {
      return false;
    }

    return !parts.some((part, index) => {
      if (index === 0) {
        return RESERVED_PATH_SEGMENTS.has(part.toLowerCase());
      }

      return part.toLowerCase() === "pin";
    });
  }

  function cleanBoardName(heading, slug) {
    const normalizedHeading = heading.replace(/\s*-\s*Pinterest.*$/i, "").trim();
    if (normalizedHeading) {
      return normalizedHeading;
    }

    return slug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseInitialProps() {
    const script = document.querySelector('script#__PWS_INITIAL_PROPS__');
    if (!script?.textContent) {
      return null;
    }

    try {
      return JSON.parse(script.textContent);
    } catch {
      return null;
    }
  }

  function normalizePath(value) {
    if (!value) {
      return "/";
    }

    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    return withLeadingSlash.endsWith("/")
      ? withLeadingSlash
      : `${withLeadingSlash}/`;
  }

  async function collectBoardRecords(
    context,
    pinIds = null,
    scanBoardUrl = location.href
  ) {
    await settlePage();
    assertNotCancelled();
    assertSameBoardPage(scanBoardUrl);

    const refreshedContext = getBoardContext();
    if (
      refreshedContext?.ok &&
      getBoardPageKey(scanBoardUrl) === getBoardPageKey(location.href) &&
      (isWeakBoardContext(context) || !isWeakBoardContext(refreshedContext))
    ) {
      Object.assign(context, refreshedContext);
      updateRun({
        boardKey: context.boardKey || state.run.boardKey,
        boardName: context.boardName || state.run.boardName,
        expected: pinIds?.length
          ? pinIds.length
          : (Number(context.pinCount) || state.run.expected),
        warning: context.warning || state.run.warning
      });
    }

    const initialProps = parseInitialProps();
    const initialPins = initialProps?.initialReduxState?.pins || {};
    const records = new Map();
    const requestedPinIds = pinIds?.length
      ? new Set(pinIds.map(String))
      : null;

    collectPinsFromPageState(records, initialPins, context);
    const pageStateOnlyPinIds = new Set(records.keys());

    window.scrollTo(0, 0);
    await wait(900);

    let stagnantPasses = 0;
    let lastCollectedCount = 0;
    let lastDomCount = 0;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let stoppedAtRecommendationBoundary = false;
    const recommendationPinIds = new Set();
    // A board_id in Pinterest's page state is not enough to prove that a card
    // belongs above the visible recommendation boundary. Only remember IDs
    // after a real board-side card occurrence has been observed.
    const acceptedBoardPinIds = new Set();

    // New IDs, the explicit end-of-board boundary, an idle grace period, or
    // the hard time limit end a scan. A fixed pass count is unsafe because a
    // virtualized Pinterest feed can make legitimate progress one pin at a
    // time for well over 100 passes.
    for (let pass = 0; ; pass += 1) {
      assertNotCancelled();
      assertSameBoardPage(scanBoardUrl);

      const recommendationCandidates = findRecommendationBoundaryCandidates(context);
      const recommendationBoundary = findRecommendationBoundary(
        initialPins,
        context,
        recommendationCandidates
      );
      collectVisiblePins(
        records,
        initialPins,
        context,
        recommendationBoundary,
        requestedPinIds || recommendationBoundary
          ? 0
          : Number(context.pinCount) || 0,
        recommendationPinIds,
        acceptedBoardPinIds,
        recommendationCandidates,
        pageStateOnlyPinIds
      );
      const confirmedCollectedCount = [...records.keys()].filter(
        (pinId) => !pageStateOnlyPinIds.has(pinId)
      ).length;

      if (confirmedCollectedCount > lastCollectedCount) {
        lastProgressAt = Date.now();
        stagnantPasses = 0;
      } else {
        stagnantPasses += 1;
      }

      lastCollectedCount = confirmedCollectedCount;

      updateRun({
        stage: "scanning",
        message: buildScanMessage(
          confirmedCollectedCount,
          context.pinCount,
          stagnantPasses > 2
        ),
        collected: confirmedCollectedCount
      });

      if (recommendationBoundary) {
        if (!requestedPinIds) {
          for (const pinId of pageStateOnlyPinIds) {
            records.delete(pinId);
          }
        }
        stoppedAtRecommendationBoundary = true;
        break;
      }

      if (
        context.pinCount > 0 &&
        confirmedCollectedCount >= Number(context.pinCount)
      ) {
        if (!requestedPinIds) {
          for (const pinId of pageStateOnlyPinIds) {
            records.delete(pinId);
          }
        }
        break;
      }

      if (
        requestedPinIds &&
        [...requestedPinIds].every((pinId) => records.has(pinId))
      ) {
        break;
      }

      const currentHeight = document.documentElement.scrollHeight;
      const viewport = Math.max(window.innerHeight, 800);
      const atBottom = window.scrollY + viewport >= currentHeight - 24;
      const stalledFor = Date.now() - lastProgressAt;
      const scanDuration = Date.now() - startedAt;

      if (scanDuration >= SCAN_HARD_LIMIT_MS) {
        updateRun({
          warning: "The scan reached its 20-minute safety limit. LocalBoard will export every pin it found."
        });
        break;
      }

      // Pinterest virtualizes its feed, so page height and the last DOM pin can
      // keep changing after the final board pin. Only newly collected pin IDs
      // count as scan progress; otherwise an unknown-count board can loop for
      // minutes without ever reaching the download stage.
      if (
        confirmedCollectedCount > 0 &&
        stagnantPasses >= SCAN_STAGNANT_PASS_LIMIT &&
        stalledFor >= (
          !requestedPinIds && context.pinCount > confirmedCollectedCount
            ? SCAN_KNOWN_INCOMPLETE_GRACE_MS
            : SCAN_STALL_GRACE_MS
        )
      ) {
        break;
      }

      if (confirmedCollectedCount === 0 && stalledFor >= SCAN_EMPTY_GRACE_MS) {
        break;
      }

      lastDomCount = document.querySelectorAll(PIN_CARD_SELECTOR).length;
      const lastVisiblePinId = getLastVisiblePinId();

      if (atBottom && stagnantPasses > 0 && stagnantPasses % 3 === 0) {
        await nudgeBoardScroll();
      }

      scrollBoardForward(currentHeight);
      await waitForAdditionalPins(
        lastDomCount,
        currentHeight,
        lastVisiblePinId,
        atBottom ? 6500 : 4000
      );
    }

    // State JSON can retain recommendation cards that were never rendered on
    // the board side. Whole-board exports only trust records confirmed by an
    // actual board-side DOM occurrence, regardless of how the scan ended.
    if (!requestedPinIds) {
      for (const pinId of pageStateOnlyPinIds) {
        records.delete(pinId);
      }
    }

    if (records.size === 0) {
      if (context.sectionCount > 0) {
        throw new Error(
          "Pinterest is showing board sections instead of pins. Open the board's All Pins view or a section page, then run the extension again."
        );
      }

      throw new Error("No board pins were detected on this page.");
    }

    let sortedRecords = [...records.values()].sort((a, b) => a.order - b.order);

    if (!requestedPinIds && context.pinCount > 0) {
      sortedRecords = sortedRecords.slice(0, Number(context.pinCount));
    }

    if (pinIds && pinIds.length > 0) {
      const pinIdSet = new Set(pinIds.map(String));
      sortedRecords = sortedRecords.filter((r) => pinIdSet.has(String(r.pinId)));
      const foundPinIds = new Set(sortedRecords.map((record) => String(record.pinId)));
      const missingSelectedCount = [...pinIdSet].filter(
        (pinId) => !foundPinIds.has(pinId)
      ).length;
      if (missingSelectedCount > 0) {
        throw new Error(
          `Could not find ${missingSelectedCount} of ${pinIdSet.size} selected pins while scanning the board. No partial ZIP was created. Scroll the board to load the missing pins, then try again.`
        );
      }
    }

    return {
      records: sortedRecords,
      scanReport: {
        expectedCount: context.pinCount || 0,
        collectedCount: sortedRecords.length,
        missingCount:
          context.pinCount > 0
            ? Math.max(0, Number(context.pinCount) - sortedRecords.length)
            : 0,
        finalDomPinCount: document.querySelectorAll(PIN_CARD_SELECTOR).length,
        stoppedAtRecommendationBoundary,
        boardUrl: location.href
      }
    };
  }

  function assertSameBoardPage(expectedUrl) {
    const expectedKey = getBoardPageKey(expectedUrl);
    const currentKey = getBoardPageKey(location.href);
    if (expectedKey && currentKey && currentKey !== expectedKey) {
      throw new BoardChangedError();
    }
  }

  function getBoardPageKey(rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      return `${url.hostname.toLowerCase()}${normalizePath(url.pathname).toLowerCase()}`;
    } catch {
      return "";
    }
  }

  function collectPinsFromPageState(records, initialPins, context) {
    if (!context.boardId) {
      return;
    }

    for (const [pinId, pin] of Object.entries(initialPins)) {
      if (!pin || typeof pin !== "object") {
        continue;
      }

      const pinBoardId = String(pin.board_id || pin.board?.id || "");
      if (!pinBoardId || pinBoardId !== String(context.boardId)) {
        continue;
      }

      const candidates = [];
      addPinterestUrlCandidates(candidates, pin?.images?.orig?.url);
      addPinterestUrlCandidates(candidates, pin?.images?.originals?.url);
      addPinterestUrlCandidates(candidates, pin?.images?.["1200x"]?.url);
      addPinterestUrlCandidates(candidates, pin?.images?.["736x"]?.url);
      addStoryImageCandidates(candidates, pin?.story_pin_data);
      if (candidates.length === 0) {
        continue;
      }

      records.set(String(pinId), {
        order: records.size,
        pinId: String(pinId),
        pinUrl: `${location.origin}/pin/${pinId}/`,
        title:
          sanitizeFileLabel(pin.grid_title) ||
          sanitizeFileLabel(pin.title) ||
          "",
        alt: pin.alt_text || "",
        candidates: prioritizeCandidates(candidates)
      });
    }
  }

  function collectVisiblePins(
    records,
    initialPins,
    context,
    recommendationBoundary = null,
    maxRecords = 0,
    recommendationPinIds = null,
    acceptedBoardPinIds = null,
    recommendationCandidates = null,
    pageStateOnlyPinIds = null
  ) {
    const pinElements = [...document.querySelectorAll(PIN_CARD_SELECTOR)].sort(
      (firstPin, secondPin) => {
        const firstRect = firstPin.getBoundingClientRect?.();
        const secondRect = secondPin.getBoundingClientRect?.();
        const firstRendered = Boolean(firstRect?.width > 0 && firstRect?.height > 0);
        const secondRendered = Boolean(secondRect?.width > 0 && secondRect?.height > 0);
        if (firstRendered !== secondRendered) {
          return firstRendered ? -1 : 1;
        }
        if (!firstRendered) {
          return 0;
        }
        if (Math.abs(firstRect.top - secondRect.top) > 2) {
          return firstRect.top - secondRect.top;
        }
        return firstRect.left - secondRect.left;
      }
    );
    let confirmedRecordCount = [...records.keys()].filter(
      (pinId) => !pageStateOnlyPinIds?.has(pinId)
    ).length;

    for (const pinElement of pinElements) {
      const pinId = pinElement.getAttribute("data-test-pin-id");
      if (!pinId) {
        continue;
      }

      const initialPin = initialPins[pinId];
      const explicitPinBoardId = getExplicitPinBoardId(initialPin, pinElement);
      const isAuthoritativeBoardPin = Boolean(
        context?.boardId && explicitPinBoardId === String(context.boardId)
      );
      const isExplicitForeignPin = Boolean(
        context?.boardId &&
        explicitPinBoardId &&
        explicitPinBoardId !== String(context.boardId)
      );
      const wasAcceptedAsBoardPin = Boolean(
        acceptedBoardPinIds?.has(pinId)
      );
      const shouldRememberAsBoardPin = Boolean(
        isAuthoritativeBoardPin || recommendationBoundary
      );
      const isBoundaryOccurrence = Boolean(
        isPinAtOrAfterRecommendationBoundary(pinElement, recommendationBoundary) ||
        isPinInRecommendationRegion(pinElement, context, recommendationCandidates)
      );
      const isRecommendationPin = Boolean(
        isBoundaryOccurrence ||
        isExplicitForeignPin ||
        (
          !isAuthoritativeBoardPin &&
          !wasAcceptedAsBoardPin &&
          !pinBelongsToBoard(initialPin, context, pinElement)
        )
      );
      if (isRecommendationPin) {
        recommendationPinIds?.add(pinId);
        if (isExplicitForeignPin || !wasAcceptedAsBoardPin) {
          const removedConfirmedRecord = Boolean(
            records.has(pinId) && !pageStateOnlyPinIds?.has(pinId)
          );
          if (records.delete(pinId) && removedConfirmedRecord) {
            confirmedRecordCount = Math.max(0, confirmedRecordCount - 1);
          }
          pageStateOnlyPinIds?.delete(pinId);
          acceptedBoardPinIds?.delete(pinId);
        }
        continue;
      }

      if (
        isAuthoritativeBoardPin ||
        wasAcceptedAsBoardPin ||
        recommendationBoundary
      ) {
        recommendationPinIds?.delete(pinId);
      }
      if (!recommendationBoundary && recommendationPinIds?.has(pinId)) {
        continue;
      }

      const existingRecord = records.get(pinId);
      if (
        !existingRecord &&
        maxRecords > 0 &&
        confirmedRecordCount >= maxRecords
      ) {
        continue;
      }

      const hadStateOnlyProvenance = Boolean(
        pageStateOnlyPinIds?.delete(pinId)
      );
      if (existingRecord && hadStateOnlyProvenance) {
        confirmedRecordCount += 1;
      }

      const nextRecord = extractPinRecord(pinElement, initialPin, records.size);
      if (!nextRecord) {
        continue;
      }

      if (!existingRecord) {
        records.set(pinId, nextRecord);
        confirmedRecordCount += 1;
        if (shouldRememberAsBoardPin) {
          acceptedBoardPinIds?.add(pinId);
        }
        continue;
      }

      if (shouldRememberAsBoardPin) {
        acceptedBoardPinIds?.add(pinId);
      }

      existingRecord.title = existingRecord.title || nextRecord.title;
      existingRecord.alt = existingRecord.alt || nextRecord.alt;
      existingRecord.pinUrl = existingRecord.pinUrl || nextRecord.pinUrl;
      mergeCandidateLists(existingRecord.candidates, nextRecord.candidates);
    }
  }

  function findRecommendationBoundaryCandidates(context = null) {
    const boundaryCandidates = [];
    const seenBoundaryCandidates = new Set();
    const rememberBoundaryCandidate = (candidate) => {
      if (!seenBoundaryCandidates.has(candidate)) {
        seenBoundaryCandidates.add(candidate);
        boundaryCandidates.push(candidate);
      }
    };
    const headingCandidates = document.querySelectorAll(
      'h1, h2, h3, h4, [role="heading"]'
    );

    for (const candidate of headingCandidates) {
      if (
        candidate.closest(PIN_CARD_SELECTOR) ||
        isBoardTitleBoundaryCandidate(candidate, context)
      ) {
        continue;
      }
      if (
        isRenderedRecommendationCandidate(candidate) &&
        hasRecommendationHeadingText(candidate)
      ) {
        rememberBoundaryCandidate(candidate);
      }
    }

    for (const candidate of document.querySelectorAll(
      '[data-test-id], [id], [aria-label], [role="region"]'
    )) {
      if (candidate.closest(PIN_CARD_SELECTOR)) {
        continue;
      }
      if (isBoardTitleBoundaryCandidate(candidate, context)) {
        continue;
      }
      if (
        isRenderedRecommendationCandidate(candidate) &&
        isRecommendationMarkerElement(candidate)
      ) {
        rememberBoundaryCandidate(candidate);
      }
    }

    // Pinterest sometimes renders the visible label as an ordinary div/span
    // rather than a semantic heading. Keep this fallback intentionally narrow:
    // short, rendered text outside a pin card that starts with known copy.
    for (const candidate of document.querySelectorAll("div, span, p, strong")) {
      if (
        candidate.closest(PIN_CARD_SELECTOR) ||
        candidate.querySelector(PIN_CARD_SELECTOR) ||
        isBoardTitleBoundaryCandidate(candidate, context) ||
        candidate.childElementCount > 8 ||
        !isRenderedRecommendationCandidate(candidate)
      ) {
        continue;
      }
      const texts = getRecommendationCandidateTexts(candidate);
      const longestTextLength = Math.max(0, ...texts.map((text) => text.length));
      if (
        longestTextLength > 0 &&
        longestTextLength <= 180 &&
        texts.some((text) => RECOMMENDATION_HEADING_RE.test(text))
      ) {
        rememberBoundaryCandidate(candidate);
      }
    }

    return boundaryCandidates;
  }

  function findRecommendationBoundary(
    initialPins = {},
    context = null,
    boundaryCandidates = null
  ) {
    const candidates =
      boundaryCandidates || findRecommendationBoundaryCandidates(context);
    const visibleBoundary = chooseRecommendationBoundary(candidates);
    if (visibleBoundary) {
      return visibleBoundary;
    }

    // A recommendation heading can be renamed, localized, or virtualized out
    // of the DOM. Pinterest's pin state still commonly identifies the source
    // board, but foreign-board cards can also live in sidebars. Only accept a
    // foreign pin whose rendered feed aligns with the board's main pin flow.
    if (context?.boardId) {
      for (const pinElement of document.querySelectorAll(PIN_CARD_SELECTOR)) {
        const pinId = pinElement.getAttribute("data-test-pin-id") || "";
        const pin = initialPins?.[pinId];
        const pinBoardId = getExplicitPinBoardId(pin, pinElement);
        if (
          pinBoardId &&
          pinBoardId !== String(context.boardId) &&
          chooseRecommendationBoundary([pinElement]) === pinElement
        ) {
          return pinElement;
        }
      }
    }

    return null;
  }

  function chooseRecommendationBoundary(candidates) {
    const pins = [...document.querySelectorAll(PIN_CARD_SELECTOR)];
    let bestCandidate = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const boundaryRect = getRecommendationBoundaryRect(candidate);
      if (!boundaryRect) {
        continue;
      }

      const cutoffY = candidate.matches?.(PIN_CARD_SELECTOR)
        ? boundaryRect.top
        : boundaryRect.bottom;
      let associatedAbove = 0;
      let associatedBelow = 0;
      let containedPins = 0;

      for (const pin of pins) {
        if (candidate.contains(pin)) {
          containedPins += 1;
          continue;
        }
        const pinRect = pin.getBoundingClientRect?.();
        if (!pinRect || pinRect.width <= 0 || pinRect.height <= 0) {
          continue;
        }
        const horizontallyAssociated =
          pinRect.right >= boundaryRect.left - 2 &&
          pinRect.left <= boundaryRect.right + 2;
        if (!horizontallyAssociated) {
          continue;
        }
        if (pinRect.top >= cutoffY - 2) {
          associatedBelow += 1;
        } else {
          associatedAbove += 1;
        }
      }

      if (associatedAbove + associatedBelow + containedPins === 0) {
        continue;
      }
      const viewportWidth = Math.max(
        document.documentElement.clientWidth || 0,
        window.innerWidth || 0
      );
      const spansMainFeed =
        viewportWidth > 0 && boundaryRect.width >= viewportWidth * 0.45;
      if (associatedAbove === 0 && !spansMainFeed) {
        continue;
      }

      // A real end-of-board label normally has board cards above it and a
      // recommendation cohort below/inside it. Prefer that shape over a
      // similarly worded title in a sidebar or unrelated page region.
      const score =
        (associatedAbove > 0 ? 1_000_000 : 0) +
        (associatedBelow + containedPins) * 10_000 +
        containedPins * 100 +
        Math.min(boundaryRect.width, 5_000);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  function normalizeRecommendationMarker(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isRecommendationMarkerElement(element) {
    if (!element) {
      return false;
    }

    const markers = [
      element.getAttribute?.("data-test-id"),
      element.id,
      element.getAttribute?.("aria-label"),
      getAriaLabelledByText(element)
    ]
      .map(normalizeRecommendationMarker)
      .filter(Boolean);
    return Boolean(
      markers.some(
        (marker) =>
          RECOMMENDATION_MARKER_RE.test(marker) ||
          RECOMMENDATION_HEADING_RE.test(marker)
      )
    );
  }

  function getRecommendationCandidateTexts(element) {
    return [
      element?.textContent,
      element?.getAttribute?.("aria-label"),
      getAriaLabelledByText(element)
    ]
      .map(normalizeRecommendationMarker)
      .filter(Boolean);
  }

  function hasRecommendationHeadingText(element) {
    return getRecommendationCandidateTexts(element).some((text) =>
      RECOMMENDATION_HEADING_RE.test(text)
    );
  }

  function isBoardTitleBoundaryCandidate(element, context) {
    const boardName = normalizeRecommendationMarker(context?.boardName)
      .toLocaleLowerCase();
    if (!boardName) {
      return false;
    }

    const matchesBoardName = getRecommendationCandidateTexts(element).some(
      (text) => {
        const normalizedText = text.toLocaleLowerCase();
        return (
          normalizedText === boardName ||
          normalizedText.startsWith(`${boardName} `)
        );
      }
    );
    if (!matchesBoardName) {
      return false;
    }

    const candidateRect = getRecommendationBoundaryRect(element);
    const firstPinTop = [...document.querySelectorAll(PIN_CARD_SELECTOR)]
      .map((pin) => pin.getBoundingClientRect?.())
      .filter((rect) => rect?.width > 0 && rect?.height > 0)
      .reduce((top, rect) => Math.min(top, rect.top), Number.POSITIVE_INFINITY);

    return Boolean(
      candidateRect &&
      Number.isFinite(firstPinTop) &&
      candidateRect.bottom <= firstPinTop + 2
    );
  }

  function getAriaLabelledByText(element) {
    const labelIds = String(element?.getAttribute?.("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    return labelIds
      .map((labelId) => document.getElementById(labelId)?.textContent || "")
      .filter(Boolean)
      .join(" ");
  }

  function isRenderedRecommendationCandidate(element) {
    if (!element) {
      return false;
    }

    const elementStyle = getComputedStyle(element);
    if (element.closest?.('[hidden], [aria-hidden="true"]')) {
      return false;
    }
    if (
      elementStyle.display !== "contents" &&
      element.checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true
      }) === false
    ) {
      return false;
    }

    let ancestor = element;
    while (ancestor && ancestor !== document.documentElement) {
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      ancestor = ancestor.parentElement;
    }

    if (getRecommendationBoundaryRect(element)) {
      return true;
    }

    // display: contents regions have no box of their own, but can still be a
    // useful semantic boundary when they contain rendered recommendation pins.
    const descendantPin = element.querySelector?.(PIN_CARD_SELECTOR);
    const pinRect = descendantPin?.getBoundingClientRect?.();
    return Boolean(pinRect && pinRect.width > 0 && pinRect.height > 0);
  }

  function getRecommendationBoundaryRect(element) {
    if (!element) {
      return null;
    }

    let rect = [...(element.getClientRects?.() || [])]
      .find((candidate) => candidate.width > 0 && candidate.height > 0) || null;

    // display: contents headings have visible text but no element box.
    if (!rect && element.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(element);
      rect = [...range.getClientRects()]
        .find((candidate) => candidate.width > 0 && candidate.height > 0) || null;
      range.detach?.();
    }

    if (!rect) {
      return null;
    }

    // Use a nearby text-row wrapper for horizontal association when it is
    // wider than the label itself and does not also contain pin cards.
    let horizontalRect = rect;
    if (element.matches?.(PIN_CARD_SELECTOR)) {
      const feedRect = element.parentElement?.getBoundingClientRect?.();
      if (feedRect?.width > horizontalRect.width && feedRect.height > 0) {
        horizontalRect = feedRect;
      }
    }
    for (const sibling of [
      element.previousElementSibling,
      element.nextElementSibling
    ]) {
      if (
        !sibling ||
        !(sibling.matches?.(PIN_CARD_SELECTOR) || sibling.querySelector?.(PIN_CARD_SELECTOR))
      ) {
        continue;
      }
      const siblingRect = sibling.getBoundingClientRect?.();
      const horizontallyAligned = Boolean(
        siblingRect &&
        siblingRect.right >= rect.left - 2 &&
        siblingRect.left <= rect.right + 2
      );
      if (
        horizontallyAligned &&
        siblingRect.width > horizontalRect.width &&
        siblingRect.height > 0
      ) {
        horizontalRect = siblingRect;
      }
    }

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 2; depth += 1) {
      if (parent.querySelector(PIN_CARD_SELECTOR)) {
        break;
      }
      const parentRect = parent.getBoundingClientRect?.();
      if (parentRect?.width > horizontalRect.width && parentRect.height > 0) {
        horizontalRect = parentRect;
      }
      parent = parent.parentElement;
    }

    return {
      top: rect.top,
      bottom: rect.bottom,
      left: horizontalRect.left,
      right: horizontalRect.right,
      width: horizontalRect.width,
      height: rect.height
    };
  }

  function isPinInRecommendationRegion(
    pinElement,
    context = null,
    recommendationCandidates = null
  ) {
    let ancestor = pinElement?.parentElement || null;
    while (ancestor && ancestor !== document.body) {
      if (isRecommendationMarkerElement(ancestor)) {
        return true;
      }
      ancestor = ancestor.parentElement;
    }

    // A compact recommendation widget may only expose a sibling semantic or
    // plain-text label with no identifying attribute on its wrapper. Reuse the
    // exact candidate set considered for the page boundary so local widgets
    // and the main feed cannot drift into different classification rules.
    const candidates =
      recommendationCandidates || findRecommendationBoundaryCandidates(context);
    for (const candidate of candidates) {
      if (isPinAtOrAfterRecommendationBoundary(pinElement, candidate)) {
        return true;
      }
    }

    return false;
  }

  function isPinAtOrAfterRecommendationBoundary(pinElement, boundary) {
    if (!pinElement || !boundary) {
      return false;
    }

    if (
      boundary === pinElement ||
      boundary.contains(pinElement) ||
      pinElement.contains(boundary)
    ) {
      return true;
    }

    // Pinterest's masonry and portal layouts can render cards in a different
    // vertical order from their source order. The visible "Find more ideas"
    // line is the authoritative cutoff whenever both elements have boxes.
    const pinRect = pinElement.getBoundingClientRect?.();
    const boundaryRect = getRecommendationBoundaryRect(boundary);
    if (
      pinRect?.width > 0 &&
      pinRect?.height > 0 &&
      boundaryRect?.width > 0 &&
      boundaryRect?.height > 0
    ) {
      const horizontallyAssociated =
        pinRect.right >= boundaryRect.left - 2 &&
        pinRect.left <= boundaryRect.right + 2;
      if (!horizontallyAssociated) {
        return false;
      }
      const boundaryIsPin = boundary.matches?.(PIN_CARD_SELECTOR);
      const cutoffY = boundaryIsPin ? boundaryRect.top : boundaryRect.bottom;
      return pinRect.top >= cutoffY - 2;
    }

    return Boolean(
      boundary.compareDocumentPosition(pinElement) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function getExplicitPinBoardId(pin, pinElement = null) {
    const stateBoardId = pin?.board_id || pin?.board?.id || pin?.board?.board_id;
    if (stateBoardId !== undefined && stateBoardId !== null && stateBoardId !== "") {
      return String(stateBoardId);
    }

    const domBoardId =
      pinElement?.getAttribute?.("data-board-id") ||
      pinElement?.querySelector?.("[data-board-id]")?.getAttribute("data-board-id") ||
      "";
    return domBoardId ? String(domBoardId) : "";
  }

  function pinBelongsToBoard(pin, context, pinElement = null) {
    if (!context?.boardId) {
      return true;
    }

    const pinBoardId = getExplicitPinBoardId(pin, pinElement);
    return !pinBoardId || pinBoardId === String(context.boardId);
  }

  function extractPinRecord(pinElement, initialPin, nextOrder) {
    const pinId = pinElement.getAttribute("data-test-pin-id");
    const anchor = pinElement.querySelector('a[href*="/pin/"]');
    const img = pickBestImageElement(pinElement);

    const candidateUrls = [];
    addPinterestUrlCandidates(candidateUrls, img?.currentSrc);
    addPinterestUrlCandidates(candidateUrls, img?.src);

    if (img?.srcset) {
      for (const url of parseSrcset(img.srcset)) {
        addPinterestUrlCandidates(candidateUrls, url);
      }
    }

    if (initialPin) {
      addPinterestUrlCandidates(candidateUrls, initialPin?.images?.orig?.url);
      addPinterestUrlCandidates(candidateUrls, initialPin?.images?.originals?.url);
      addStoryImageCandidates(candidateUrls, initialPin?.story_pin_data);
    }

    if (candidateUrls.length === 0) {
      return null;
    }

    const orderedCandidates = prioritizeCandidates(candidateUrls);
    const title =
      sanitizeFileLabel(initialPin?.grid_title) ||
      sanitizeFileLabel(initialPin?.title) ||
      sanitizeFileLabel(anchor?.getAttribute("aria-label")) ||
      sanitizeFileLabel(img?.alt) ||
      "";

    const pinUrl = anchor ? new URL(anchor.getAttribute("href"), location.origin).href : "";

    return {
      order: nextOrder,
      pinId,
      pinUrl,
      title,
      alt: img?.alt || "",
      candidates: orderedCandidates
    };
  }

  function pickBestImageElement(pinElement) {
    const images = [...pinElement.querySelectorAll("img")].filter((img) =>
      PINIMG_URL_RE.test(img.currentSrc || img.src || "")
    );

    if (images.length === 0) {
      return null;
    }

    return images.sort((left, right) => {
      const leftScore = scorePinterestUrl(left.currentSrc || left.src || "");
      const rightScore = scorePinterestUrl(right.currentSrc || right.src || "");
      return rightScore - leftScore;
    })[0];
  }

  function addStoryImageCandidates(target, storyPinData) {
    const pages = storyPinData?.pages || storyPinData?.pages_preview || [];
    for (const page of pages) {
      const blocks = page?.blocks || [];
      for (const block of blocks) {
        const images = block?.image?.images || {};
        addPinterestUrlCandidates(target, images?.originals?.url);
        addPinterestUrlCandidates(target, images?.orig?.url);
        addPinterestUrlCandidates(target, images?.["1200x"]?.url);
        addPinterestUrlCandidates(target, images?.["736x"]?.url);
      }
    }
  }

  function addPinterestUrlCandidates(target, value) {
    if (!value || typeof value !== "string") {
      return;
    }

    if (!PINIMG_URL_RE.test(value)) {
      return;
    }

    target.push(value);

    if (!value.includes("/originals/")) {
      const derivedOriginal = value.replace(
        /\/(?:\d+x\d+|\d+x|[A-Z]{2}_\d+x\d+|[A-Z]{2}_\d+x|\d+x_[A-Z]{2}|[A-Z]{2}_\d+x|[A-Z]{2}_\d+|\d+)(?=\/)/i,
        "/originals"
      );
      if (derivedOriginal !== value) {
        target.push(derivedOriginal);
      }
    }
  }

  function parseSrcset(srcset) {
    return srcset
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function prioritizeCandidates(urls) {
    return [...new Set(urls)].sort((left, right) => {
      return scorePinterestUrl(right) - scorePinterestUrl(left);
    });
  }

  function mergeCandidateLists(target, source) {
    for (const url of source) {
      if (!target.includes(url)) {
        target.push(url);
      }
    }

    target.sort((left, right) => scorePinterestUrl(right) - scorePinterestUrl(left));
  }

  function scorePinterestUrl(url) {
    if (!url) {
      return -1;
    }

    if (url.includes("/originals/")) {
      return 100000;
    }

    const sizeMatch = url.match(/\/(\d+)x(?=\/)/i);
    if (sizeMatch) {
      return Number(sizeMatch[1]);
    }

    const squareMatch = url.match(/\/(\d+)x(\d+)(?=\/)/i);
    if (squareMatch) {
      return Number(squareMatch[1]) + Number(squareMatch[2]);
    }

    return 0;
  }

  async function waitForAdditionalPins(
    previousCount,
    previousHeight,
    previousTailPinId,
    timeoutMs = 4000
  ) {
    const deadline = Date.now() + timeoutMs;

    await new Promise((resolve) => {
      let done = false;
      let observer = null;
      let pollTimer = 0;

      const finish = async () => {
        if (done) {
          return;
        }

        done = true;
        if (observer) {
          observer.disconnect();
        }
        if (pollTimer) {
          window.clearInterval(pollTimer);
        }
        await wait(450);
        resolve();
      };

      const hasAdvanced = () => {
        const currentCount = document.querySelectorAll(PIN_CARD_SELECTOR).length;
        const currentHeight = document.documentElement.scrollHeight;
        const currentTailPinId = getLastVisiblePinId();
        return (
          currentCount > previousCount ||
          currentHeight > previousHeight ||
          (
            previousTailPinId &&
            currentTailPinId &&
            currentTailPinId !== previousTailPinId
          )
        );
      };

      observer = new MutationObserver(() => {
        if (hasAdvanced()) {
          finish();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      pollTimer = window.setInterval(() => {
        if (Date.now() >= deadline || hasAdvanced() || state.run.cancelRequested) {
          finish();
        }
      }, 250);
    });
  }

  function scrollBoardForward(documentHeight) {
    const viewport = Math.max(window.innerHeight, 800);
    const currentScroll = window.scrollY;
    const maxScroll = Math.max(0, documentHeight - viewport);
    const nextScroll = Math.min(maxScroll, currentScroll + Math.floor(viewport * 0.9));

    if (nextScroll <= currentScroll + 8) {
      window.scrollTo(0, documentHeight);
      return;
    }

    window.scrollTo(0, nextScroll);
  }

  function getLastVisiblePinId() {
    const pins = document.querySelectorAll(PIN_CARD_SELECTOR);
    return pins.length
      ? pins[pins.length - 1].getAttribute("data-test-pin-id") || ""
      : "";
  }

  async function nudgeBoardScroll() {
    const viewport = Math.max(window.innerHeight, 800);
    const target = Math.max(0, window.scrollY - Math.floor(viewport * 0.7));
    window.scrollTo(0, target);
    await wait(450);
    window.scrollTo(0, document.documentElement.scrollHeight);
    await wait(650);
  }

  async function buildExport(
    records,
    context,
    scanResult,
    runSignal,
    exportMode,
    resumeCheckpoint = null,
    resumeIdentity = null
  ) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip was not loaded into the content script.");
    }

    const folderName = sanitizeFileLabel(
      context.boardName || "board",
      MAX_FOLDER_NAME_LENGTH
    ) || "board";
    const archiveBaseName = truncateFileLabel(
      `${folderName}_localboard`,
      MAX_ARCHIVE_BASE_NAME_LENGTH
    );
    const timestamp = new Date().toISOString().slice(0, 10);
    const partSize = exportMode === "parts" ? SMART_PART_SIZE : Math.max(1, records.length);
    const recordParts = chunkItems(records, partSize);
    const resumedParts = Math.max(
      0,
      Math.min(
        recordParts.length - 1,
        Number(resumeCheckpoint?.completedParts) || 0
      )
    );
    const totals = {
      downloaded: resumedParts > 0 ? Number(resumeCheckpoint?.downloaded) || 0 : 0,
      failed: resumedParts > 0 ? Number(resumeCheckpoint?.failed) || 0 : 0,
      failures: []
    };
    const filenames = [];

    updateRun({
      exportMode,
      downloaded: totals.downloaded,
      failed: totals.failed,
      partIndex: resumedParts + 1,
      partCount: recordParts.length,
      partsCompleted: resumedParts
    });

    for (
      let partIndex = resumedParts;
      partIndex < recordParts.length;
      partIndex += 1
    ) {
      assertNotCancelled(runSignal);
      const partRecords = recordParts[partIndex];
      const partNumber = partIndex + 1;
      const filename = buildArchiveFilename(
        archiveBaseName,
        timestamp,
        partNumber,
        recordParts.length
      );

      await buildAndDownloadZipPart({
        records: partRecords,
        allRecordCount: records.length,
        recordOffset: partIndex * partSize,
        context,
        scanResult,
        runSignal,
        exportMode,
        folderName,
        filename,
        partNumber,
        partCount: recordParts.length,
        totals
      });

      filenames.push(filename);
      if (exportMode === "parts") {
        await saveResumeCheckpoint({
          context,
          resumeIdentity,
          recordCount: records.length,
          partCount: recordParts.length,
          completedParts: partNumber,
          downloaded: totals.downloaded,
          failed: totals.failed
        });
        assertNotCancelled(runSignal);
      }
      if (!runSignal?.aborted && !state.run.cancelRequested) {
        updateRun({
          partsCompleted: partNumber,
          partIndex: partNumber,
          partCount: recordParts.length
        });
      }

      if (partIndex < recordParts.length - 1) {
        await waitForRun(900, runSignal);
      }
    }

    assertNotCancelled(runSignal);
    if (totals.downloaded === 0) {
      throw new Error("Every image download failed for this board.");
    }

    const warningParts = [];
    if (scanResult?.scanReport?.missingCount > 0) {
      warningParts.push(
        `Pinterest exposed ${scanResult.scanReport.collectedCount} of ${scanResult.scanReport.expectedCount} expected pins.`
      );
    }
    if (totals.failed > 0) {
      warningParts.push(`${totals.failed} images failed and were listed in the download reports.`);
    }
    if (recordParts.length > 1) {
      warningParts.push("If Chrome asks, allow multiple downloads for Pinterest once.");
    }

    const completionLabel =
      recordParts.length > 1
        ? `${recordParts.length} ZIP parts`
        : "1 ZIP";

    return {
      filename:
        recordParts.length > 1
          ? `${archiveBaseName}_${timestamp}_${recordParts.length}_parts`
          : filenames[0],
      filenames,
      partCount: recordParts.length,
      downloadedCount: totals.downloaded,
      failedCount: totals.failed,
      message:
        totals.failed > 0
          ? `Export complete — ${totals.downloaded} images saved in ${completionLabel}; ${totals.failed} failed.`
          : `Export complete — ${totals.downloaded} images saved in ${completionLabel}.`,
      warning: warningParts.join(" ")
    };
  }

  async function buildAndDownloadZipPart(options) {
    const {
      records,
      allRecordCount,
      recordOffset,
      context,
      scanResult,
      runSignal,
      exportMode,
      folderName,
      filename,
      partNumber,
      partCount,
      totals
    } = options;

    const zip = new JSZip();
    const folder = zip.folder(folderName);
    const concurrency = Math.min(4, Math.max(2, navigator.hardwareConcurrency || 4));
    const partFailures = [];
    let partDownloaded = 0;
    let partFailed = 0;

    await runWithConcurrency(records, concurrency, async (record, index) => {
      assertNotCancelled(runSignal);
      try {
        const response = await fetchBestImage(record, runSignal);
        assertNotCancelled(runSignal);

        const extension = pickFileExtension(response.url, response.blob.type);
        const imageFilename = buildImageFilename(
          record,
          recordOffset + index,
          allRecordCount,
          extension
        );
        folder.file(imageFilename, response.blob);
        partDownloaded += 1;
        totals.downloaded += 1;
      } catch (error) {
        if (error instanceof CancelledError) {
          throw error;
        }

        partFailed += 1;
        totals.failed += 1;
        const failure = {
          pinId: record.pinId,
          pinUrl: record.pinUrl || "",
          title: record.title || "",
          reason: error?.message || "Unknown download error"
        };
        partFailures.push(failure);
        totals.failures.push(failure);
      }

      assertNotCancelled(runSignal);
      updateRun({
        stage: "downloading",
        downloaded: totals.downloaded,
        failed: totals.failed,
        collected: allRecordCount,
        partIndex: partNumber,
        partCount,
        message:
          partCount > 1
            ? `Saving part ${partNumber} of ${partCount} — ${totals.downloaded} of ${allRecordCount} images…`
            : `Saving ${totals.downloaded} of ${allRecordCount} images…`
      });
    });

    assertNotCancelled(runSignal);

    const report = {
      generatedAt: new Date().toISOString(),
      exportMode,
      part: {
        number: partNumber,
        count: partCount,
        firstItem: recordOffset + 1,
        lastItem: recordOffset + records.length
      },
      board: {
        name: context.boardName,
        url: location.href,
        id: context.boardId || ""
      },
      scan: scanResult?.scanReport || null,
      results: {
        requestedCount: records.length,
        downloadedCount: partDownloaded,
        failedCount: partFailed
      },
      failures: partFailures
    };
    folder.file("_download_report.json", JSON.stringify(report, null, 2));

    updateRun({
      stage: "zipping",
      partIndex: partNumber,
      partCount,
      message:
        partCount > 1
          ? `Packing ZIP part ${partNumber} of ${partCount}…`
          : "Packing your ZIP…"
    });

    const zipBlob = await zip.generateAsync(
      {
        type: "blob",
        compression: "STORE",
        streamFiles: true
      },
      (metadata) => {
        if (runSignal?.aborted || state.run.cancelRequested) {
          // JSZip stops and rejects generateAsync when its progress callback
          // throws, which keeps Cancel responsive even during a large pack.
          throw new CancelledError();
        }

        const partProgress = Math.max(0, Math.min(100, Number(metadata.percent) || 0));
        const overallProgress = ((partNumber - 1) + partProgress / 100) / partCount * 100;
        updateRun({
          stage: "zipping",
          zipProgress: overallProgress,
          partIndex: partNumber,
          partCount,
          message:
            partCount > 1
              ? `Packing ZIP part ${partNumber} of ${partCount}… ${Math.round(partProgress)}%`
              : `Packing your ZIP… ${Math.round(partProgress)}%`
        });
      }
    );

    assertNotCancelled(runSignal);
    await triggerBlobDownload(zipBlob, filename, runSignal);
    assertNotCancelled(runSignal);
  }

  function chunkItems(items, chunkSize) {
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function buildArchiveFilename(baseName, timestamp, partNumber, partCount) {
    if (partCount <= 1) {
      return `${baseName}_${timestamp}.zip`;
    }

    const width = String(partCount).length;
    const partLabel = String(partNumber).padStart(width, "0");
    return `${baseName}_${timestamp}_part-${partLabel}-of-${partCount}.zip`;
  }

  async function fetchBestImage(record, runSignal) {
    const errors = [];
    const MAX_ATTEMPTS = 3;

    for (const candidate of record.candidates) {
      assertNotCancelled(runSignal);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await fetchImageCandidate(candidate, runSignal);
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          errors.push(`${candidate} (attempt ${attempt}): ${error.message}`);

          if (attempt < MAX_ATTEMPTS && isRetriableError(error)) {
            await waitForRun(retryDelay(attempt), runSignal);
            continue;
          }

          break;
        }
      }
    }

    throw new Error(
      `Could not download pin ${record.pinId}. Tried ${record.candidates.length} URL(s): ${errors.slice(-3).join("; ")}`
    );
  }

  async function fetchImageCandidate(url, runSignal) {
    try {
      return await fetchImageCandidateWithCredentials(url, runSignal, "omit");
    } catch (error) {
      if (error instanceof CancelledError) {
        throw error;
      }

      if (!shouldTryCredentialedFetch(error)) {
        throw error;
      }

      try {
        return await fetchImageCandidateWithCredentials(url, runSignal, "include");
      } catch (credentialedError) {
        if (credentialedError instanceof CancelledError) {
          throw credentialedError;
        }

        throw new Error(
          `${error.message}; authenticated retry failed: ${credentialedError.message}`
        );
      }
    }
  }

  async function fetchImageCandidateWithCredentials(url, runSignal, credentials) {
    return await fetchWithTimeout(
      url,
      30000,
      runSignal,
      credentials,
      async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) {
          throw new Error(`Unexpected content type: ${blob.type || "unknown"}`);
        }
        if (blob.size === 0) {
          throw new Error("Server returned an empty file.");
        }

        return { blob, url: response.url || url };
      }
    );
  }

  function shouldTryCredentialedFetch(error) {
    const message = error?.message || "";
    const name = error?.name || "";
    return (
      name === "TypeError" ||
      message.includes("HTTP 401") ||
      message.includes("HTTP 403") ||
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("network error")
    );
  }

  async function fetchWithTimeout(
    url,
    timeoutMs,
    runSignal,
    credentials = "omit",
    consumeResponse = async (response) => response
  ) {
    assertNotCancelled(runSignal);

    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    let rejectInterruption;
    const interruption = new Promise((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectInterruption(new Error("Request timeout"));
    }, timeoutMs);

    const onRunAbort = () => {
      cancelled = true;
      controller.abort();
      rejectInterruption(new CancelledError());
    };
    runSignal?.addEventListener("abort", onRunAbort, { once: true });

    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {
            signal: controller.signal,
            cache: "no-store",
            credentials
          });
          assertNotCancelled(runSignal);
          const result = await consumeResponse(response);
          assertNotCancelled(runSignal);
          return result;
        })(),
        interruption
      ]);
    } catch (error) {
      if (cancelled || runSignal?.aborted || state.run.cancelRequested) {
        throw new CancelledError();
      }

      if (timedOut) {
        const timeoutError = new Error(
          `Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        );
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }

      throw error;
    } finally {
      window.clearTimeout(timer);
      runSignal?.removeEventListener("abort", onRunAbort);
    }
  }

  function isRetriableError(error) {
    if (error instanceof CancelledError) return false;
    const message = error?.message || "";
    const name    = error?.name    || "";
    return (
      name === "AbortError" ||
      name === "TimeoutError" ||
      name === "TypeError" ||
      message.includes("HTTP 429") ||
      message.includes("HTTP 500") ||
      message.includes("HTTP 502") ||
      message.includes("HTTP 503") ||
      message.includes("HTTP 504") ||
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("network error")
    );
  }

  function retryDelay(attempt) {
    const base = Math.min(600 * Math.pow(2, attempt - 1), 10000);
    return base + Math.random() * base * 0.4;
  }

  async function runWithConcurrency(items, concurrency, worker) {
    let index = 0;
    const workerCount = Math.min(concurrency, items.length);

    const runners = Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        await worker(items[currentIndex], currentIndex);
      }
    });

    const results = await Promise.allSettled(runners);
    const cancellation = results.find(
      (result) => result.status === "rejected" && result.reason instanceof CancelledError
    );
    if (cancellation) {
      throw cancellation.reason;
    }

    const rejection = results.find((result) => result.status === "rejected");
    if (rejection) {
      throw rejection.reason;
    }
  }

  function pickFileExtension(url, mimeType) {
    const mimeMap = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/avif": ".avif",
      "image/svg+xml": ".svg"
    };

    if (mimeMap[mimeType]) {
      return mimeMap[mimeType];
    }

    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (match) {
        const extension = `.${match[1].toLowerCase()}`;
        if (
          [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"].includes(
            extension
          )
        ) {
          return extension === ".jpeg" ? ".jpg" : extension;
        }
      }
    } catch {
      return ".jpg";
    }

    return ".jpg";
  }

  async function triggerBlobDownload(blob, filename, runSignal) {
    assertNotCancelled(runSignal);

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    const startedAt = Date.now();
    const verificationId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${startedAt}_${Math.random().toString(36).slice(2)}`;

    try {
      anchor.click();
      const verification = await waitForRuntimeMessage(
        {
          type: "VERIFY_BLOB_DOWNLOAD",
          objectUrl,
          filename,
          startedAt,
          verificationId
        },
        runSignal
      );
      assertNotCancelled(runSignal);

      if (!verification?.ok) {
        throw new Error(
          verification?.reason ||
          `Chrome did not confirm that ${filename} started downloading.`
        );
      }
    } finally {
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function waitForRuntimeMessage(message, runSignal) {
    assertNotCancelled(runSignal);

    if (!runSignal) {
      return await chrome.runtime.sendMessage(message);
    }

    let rejectCancellation;
    const cancelled = new Promise((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const onAbort = () => {
      if (
        message?.type === "VERIFY_BLOB_DOWNLOAD" &&
        message.verificationId
      ) {
        try {
          Promise.resolve(chrome.runtime.sendMessage({
            type: "CANCEL_BLOB_DOWNLOAD_VERIFICATION",
            verificationId: message.verificationId
          })).catch(() => {});
        } catch {
          // Cancellation must still settle if the extension was just reloaded.
        }
      }
      rejectCancellation(new CancelledError());
    };
    runSignal.addEventListener("abort", onAbort, { once: true });
    if (runSignal.aborted || state.run.cancelRequested) {
      onAbort();
    }

    try {
      return await Promise.race([
        chrome.runtime.sendMessage(message),
        cancelled
      ]);
    } finally {
      runSignal.removeEventListener("abort", onAbort);
    }
  }

  async function appendDownloadHistoryEntry(entry) {
    try {
      const history = await getStoredDownloadHistory();

      const nextHistory = [
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ...entry
        },
        ...history
      ].slice(0, MAX_DOWNLOAD_HISTORY_ITEMS);

      await chrome.storage.local.set({
        [DOWNLOAD_HISTORY_STORAGE_KEY]: nextHistory
      });
    } catch (error) {
      console.warn(`${EXTENSION_NAME}: could not save history`, error);
    }
  }

  async function getStoredDownloadHistory() {
    const stored = await chrome.storage.local.get([
      DOWNLOAD_HISTORY_STORAGE_KEY,
      LEGACY_DOWNLOAD_HISTORY_STORAGE_KEY
    ]);

    if (Array.isArray(stored[DOWNLOAD_HISTORY_STORAGE_KEY])) {
      return stored[DOWNLOAD_HISTORY_STORAGE_KEY];
    }

    if (Array.isArray(stored[LEGACY_DOWNLOAD_HISTORY_STORAGE_KEY])) {
      const legacyHistory = stored[LEGACY_DOWNLOAD_HISTORY_STORAGE_KEY];

      try {
        await chrome.storage.local.set({
          [DOWNLOAD_HISTORY_STORAGE_KEY]: legacyHistory
        });
      } catch {}

      return legacyHistory;
    }

    return [];
  }

  async function createResumeIdentity(records, exportScope, boardUrl) {
    const identityPayload = JSON.stringify({
      version: 2,
      boardUrl: String(boardUrl || ""),
      exportScope,
      pinIds: records.map((record) => String(record.pinId || ""))
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identityPayload)
    );
    const fingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return {
      version: 2,
      boardUrl: String(boardUrl || ""),
      exportScope,
      fingerprint
    };
  }

  function checkpointMatchesIdentity(checkpoint, identity) {
    return Boolean(
      checkpoint &&
      identity &&
      Number(checkpoint.version) === identity.version &&
      checkpoint.boardUrl === identity.boardUrl &&
      checkpoint.exportScope === identity.exportScope &&
      checkpoint.fingerprint === identity.fingerprint
    );
  }

  async function getResumeCheckpoint(context, recordCount, resumeIdentity) {
    try {
      const stored = await chrome.storage.local.get(RESUME_STORAGE_KEY);
      const checkpoint = stored[RESUME_STORAGE_KEY];
      if (!checkpoint || typeof checkpoint !== "object") {
        return null;
      }

      if (!checkpointMatchesIdentity(checkpoint, resumeIdentity)) {
        return null;
      }

      const boardIdMatches = !context.boardId ||
        String(checkpoint.boardId || "") === String(context.boardId);
      const expectedPartCount = Math.ceil(recordCount / SMART_PART_SIZE);
      const completedParts = Number(checkpoint.completedParts);
      const downloaded = Number(checkpoint.downloaded);
      const failed = Number(checkpoint.failed);
      const processedRecordCount = completedParts * SMART_PART_SIZE;
      const checkpointAge = Date.now() - Number(checkpoint.updatedAt || 0);
      const isRecent = checkpointAge >= 0 && checkpointAge < 7 * 24 * 60 * 60_000;
      const isValid =
        boardIdMatches &&
        checkpoint.exportMode === "parts" &&
        Number(checkpoint.recordCount) === recordCount &&
        Number(checkpoint.partCount) === expectedPartCount &&
        Number.isSafeInteger(completedParts) &&
        completedParts > 0 &&
        completedParts < expectedPartCount &&
        Number.isSafeInteger(downloaded) &&
        downloaded >= 0 &&
        Number.isSafeInteger(failed) &&
        failed >= 0 &&
        downloaded + failed === processedRecordCount &&
        isRecent;

      if (isValid) {
        return checkpoint;
      }

      await clearResumeCheckpoint(resumeIdentity);
      return null;
    } catch {
      return null;
    }
  }

  async function saveResumeCheckpoint(details) {
    if (!details.resumeIdentity) {
      return;
    }

    try {
      await chrome.storage.local.set({
        [RESUME_STORAGE_KEY]: {
          version: details.resumeIdentity.version,
          boardId: String(details.context.boardId || ""),
          boardUrl: details.resumeIdentity.boardUrl,
          exportScope: details.resumeIdentity.exportScope,
          fingerprint: details.resumeIdentity.fingerprint,
          exportMode: "parts",
          recordCount: details.recordCount,
          partCount: details.partCount,
          completedParts: details.completedParts,
          downloaded: details.downloaded,
          failed: details.failed,
          updatedAt: Date.now()
        }
      });
    } catch {
      // The export can still continue if Chrome storage is temporarily unavailable.
    }
  }

  async function clearResumeCheckpoint(resumeIdentity) {
    if (!resumeIdentity) {
      return;
    }

    try {
      const stored = await chrome.storage.local.get(RESUME_STORAGE_KEY);
      if (checkpointMatchesIdentity(stored[RESUME_STORAGE_KEY], resumeIdentity)) {
        await chrome.storage.local.remove(RESUME_STORAGE_KEY);
      }
    } catch {
      // A stale checkpoint is validated before it is ever used.
    }
  }

  function buildImageFilename(record, index, totalCount, extension) {
    const sequence = String(index + 1).padStart(String(totalCount).length, "0");
    const pinId = sanitizeFileLabel(record.pinId, 32);
    const rawTitle = record.title || record.alt || "image";
    const title = sanitizeFileLabel(rawTitle, MAX_IMAGE_TITLE_LENGTH) || "image";
    const prefix = [sequence, pinId].filter(Boolean).join("_");
    const maxBasenameLength = Math.max(
      prefix.length + 8,
      MAX_IMAGE_FILENAME_LENGTH - extension.length
    );
    const titleBudget = Math.max(8, maxBasenameLength - prefix.length - 1);
    const basename = [prefix, truncateFileLabel(title, titleBudget)]
      .filter(Boolean)
      .join("_");

    return `${truncateFileLabel(basename, maxBasenameLength)}${extension}`;
  }

  function sanitizeFileLabel(value, maxLength = 80) {
    if (!value) {
      return "";
    }

    const label = String(value)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLength);

    return label.replace(/_+$/g, "");
  }

  function truncateFileLabel(value, maxLength) {
    const label = String(value || "").replace(/_+$/g, "");
    if (label.length <= maxLength) {
      return label;
    }

    return label.slice(0, maxLength).replace(/_+$/g, "");
  }

  function buildScanMessage(collected, expected, waitingForMore = false) {
    const prefix = waitingForMore
      ? "Pinterest is loading more pins — still scanning"
      : "Scanning the board";
    if (expected > 0) {
      return `${prefix}… found ${collected} of ${expected} pins so far.`;
    }

    return `${prefix}… found ${collected} pins so far.`;
  }

  async function settlePage() {
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      if (document.querySelector(PIN_CARD_SELECTOR)) {
        await wait(600);
        return;
      }

      await wait(250);
    }
  }

  function renderOverlay() {
    if (
      state.run.stage === "idle" &&
      !state.run.cancelRequested &&
      !state.overlay?.host?.isConnected
    ) {
      return;
    }

    const overlay = ensureOverlay();
    const status = getSerializableStatus();

    overlay.title.textContent = EXTENSION_NAME;
    overlay.stage.textContent = buildOverlayStageLabel(status);
    overlay.message.textContent = status.message || "Ready.";
    overlay.meta.textContent = buildOverlayMeta(status);
    overlay.progress.style.width = `${computeOverlayProgress(status)}%`;

    overlay.cancel.hidden = !["scanning", "downloading", "zipping"].includes(
      status.stage
    );
    overlay.close.hidden = false;

    if (["done", "error", "cancelled"].includes(status.stage)) {
      overlay.host.classList.add("is-finished");
    } else {
      overlay.host.classList.remove("is-finished");
    }
  }

  function ensureOverlay() {
    if (state.overlay?.host?.isConnected) {
      return state.overlay;
    }

    document
      .getElementById("pinterest-board-zip-downloader-overlay")
      ?.remove();
    document.getElementById("pinterest-localboard-overlay")?.remove();

    const host = document.createElement("div");
    host.id = "pinterest-localboard-overlay";
    host.style.position = "fixed";
    host.style.top = "16px";
    host.style.right = "16px";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "open" });
    const logoUrl = chrome.runtime.getURL("assets/localboard-logo.png");
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .panel {
          width: 328px;
          padding: 14px;
          border: 1px solid rgba(118, 83, 65, 0.18);
          border-radius: 20px;
          background: rgba(255, 250, 245, 0.96);
          color: #171516;
          box-shadow: 0 22px 70px rgba(48, 31, 24, 0.24), 0 3px 10px rgba(48, 31, 24, 0.12);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          backdrop-filter: blur(18px) saturate(140%);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .logo {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          object-fit: cover;
          box-shadow: 0 4px 11px rgba(34, 83, 119, 0.18);
        }

        .title {
          color: #bd0025;
          font-family: ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", sans-serif;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.04em;
        }

        .stage {
          margin-left: auto;
          border-radius: 999px;
          background: #eaf7ec;
          color: #087a3d;
          padding: 6px 9px;
          font-size: 10px;
          font-weight: 800;
        }

        .message {
          margin-top: 13px;
          font-size: 13px;
          font-weight: 720;
          line-height: 1.4;
          color: #262224;
        }

        .meta {
          margin-top: 5px;
          font-size: 10.5px;
          line-height: 1.4;
          color: #767173;
        }

        .bar {
          height: 7px;
          margin-top: 12px;
          overflow: hidden;
          border-radius: 999px;
          background: #eee7e2;
        }

        .progress {
          height: 100%;
          width: 0%;
          border-radius: inherit;
          background: #bd0025;
          transition: width 0.18s ease;
        }

        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 12px;
        }

        button {
          appearance: none;
          border: 0;
          border-radius: 10px;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 8px 11px;
        }

        .cancel {
          background: #bd0025;
          color: white;
        }

        .close {
          background: #eee8e3;
          color: #4d494b;
        }
      </style>
      <div class="panel">
        <div class="brand">
          <img class="logo" src="${logoUrl}" alt="" />
          <div class="title"></div>
          <div class="stage"></div>
        </div>
        <div class="message"></div>
        <div class="meta"></div>
        <div class="bar"><div class="progress"></div></div>
        <div class="actions">
          <button class="cancel" type="button">Cancel</button>
          <button class="close" type="button">Hide</button>
        </div>
      </div>
    `;

    const title = shadow.querySelector(".title");
    const stage = shadow.querySelector(".stage");
    const message = shadow.querySelector(".message");
    const meta = shadow.querySelector(".meta");
    const progress = shadow.querySelector(".progress");
    const cancel = shadow.querySelector(".cancel");
    const close = shadow.querySelector(".close");

    cancel.addEventListener("click", () => requestCancel());
    close.addEventListener("click", () => host.remove());

    document.documentElement.appendChild(host);

    state.overlay = {
      host,
      title,
      stage,
      message,
      meta,
      progress,
      cancel,
      close
    };

    return state.overlay;
  }

  function buildOverlayStageLabel(status) {
    const labels = {
      scanning: "Scanning",
      downloading: "Saving",
      zipping: "Packing",
      done: "Complete",
      error: "Attention",
      cancelled: "Cancelled"
    };
    return labels[status.stage] || "Ready";
  }

  function buildOverlayMeta(status) {
    const parts = [];

    if (status.expected > 0) {
      parts.push(`expected ${status.expected}`);
    }

    if (status.collected > 0) {
      parts.push(`collected ${status.collected}`);
    }

    if (status.downloaded > 0 || status.stage === "downloading") {
      parts.push(`downloaded ${status.downloaded}`);
    }

    if (status.stage === "zipping") {
      parts.push(`${Math.round(status.zipProgress || 0)}% zipped`);
    }

    if (status.downloadName) {
      parts.push(status.downloadName);
    }

    return parts.join(" • ");
  }

  function computeOverlayProgress(status) {
    if (status.stage === "scanning") {
      return status.expected > 0
        ? Math.min(100, (status.collected / status.expected) * 100)
        : 12;
    }

    if (status.stage === "downloading") {
      return status.collected > 0
        ? Math.min(100, (status.downloaded / status.collected) * 100)
        : 0;
    }

    if (status.stage === "zipping") {
      return Math.max(0, Math.min(100, Number(status.zipProgress) || 0));
    }

    if (status.stage === "done") {
      return 100;
    }

    return 0;
  }

  /* ── Selection mode ── */

  function enterSelectionMode() {
    if (selection.active || state.jobPromise) return;
    selection.active = true;
    selection.selectedIds.clear();
    selection.acceptedBoardIds.clear();
    selection.recommendationIds.clear();

    injectSelectionStyles();
    refreshSelectionCheckboxes();

    selection.observer = new MutationObserver(debounce(refreshSelectionCheckboxes, 200));
    selection.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "aria-label",
        "aria-labelledby",
        "class",
        "data-board-id",
        "data-test-pin-id",
        "data-test-id",
        "hidden",
        "id",
        "role",
        "style"
      ]
    });

    selection.clickHandler = handleSelectionClick;
    document.addEventListener("click", selection.clickHandler, true);

    showSelectionBar();
    notifyStatusChange();
  }

  function exitSelectionMode() {
    if (!selection.active) return;
    selection.active = false;

    selection.styleEl?.remove();
    selection.styleEl = null;

    document.querySelectorAll("[data-lb-sel]").forEach((el) => el.removeAttribute("data-lb-sel"));
    document.querySelectorAll("[data-lb-selectable]").forEach((el) => el.removeAttribute("data-lb-selectable"));
    document.querySelectorAll(".__lb_chk__").forEach((el) => el.remove());

    if (selection.clickHandler) {
      document.removeEventListener("click", selection.clickHandler, true);
      selection.clickHandler = null;
    }

    selection.observer?.disconnect();
    selection.observer = null;
    selection.acceptedBoardIds.clear();
    selection.recommendationIds.clear();

    selection.barHost?.remove();
    selection.barHost = null;
    selection._barCountEl = null;
    selection._barDlBtn = null;

    selection.selectedIds.clear();
    notifyStatusChange();
  }

  function injectSelectionStyles() {
    const style = document.createElement("style");
    style.id = "__lb_sel_style__";
    style.textContent = `
      [data-test-id="pin"][data-test-pin-id][data-lb-selectable] {
        cursor: pointer !important;
        position: relative !important;
        transition: transform 0.15s ease !important;
      }
      [data-test-id="pin"][data-test-pin-id][data-lb-selectable]:hover .__lb_chk__ {
        transform: scale(1.08) !important;
        background: rgba(255,255,255,1) !important;
        border-color: rgba(0,0,0,0.32) !important;
      }
      .__lb_chk__ {
        position: absolute !important;
        top: 10px !important;
        left: 10px !important;
        width: 24px !important;
        height: 24px !important;
        border-radius: 50% !important;
        background: rgba(255,255,255,0.94) !important;
        border: 2px solid rgba(0,0,0,0.2) !important;
        pointer-events: none !important;
        z-index: 9999 !important;
        box-sizing: border-box !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.14) !important;
        transition:
          transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.4),
          background 0.15s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease !important;
      }
      [data-test-id="pin"][data-test-pin-id][data-lb-sel] {
        outline: 3px solid #e60023 !important;
        outline-offset: -3px !important;
      }
      [data-test-id="pin"][data-test-pin-id][data-lb-sel] .__lb_chk__ {
        background: #e60023 !important;
        border-color: #e60023 !important;
        transform: scale(1.1) !important;
        box-shadow: 0 3px 14px rgba(230, 0, 35, 0.45) !important;
      }
      [data-test-id="pin"][data-test-pin-id][data-lb-sel] .__lb_chk__::after {
        content: "" !important;
        display: block !important;
        position: absolute !important;
        top: 4px !important;
        left: 7px !important;
        width: 6px !important;
        height: 10px !important;
        border-right: 2.2px solid #fff !important;
        border-bottom: 2.2px solid #fff !important;
        transform: rotate(45deg) !important;
        box-sizing: border-box !important;
        animation: __lb_check_pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.4) !important;
      }
      @keyframes __lb_check_pop {
        from { opacity: 0; transform: rotate(45deg) scale(0.6); }
        to   { opacity: 1; transform: rotate(45deg) scale(1); }
      }
    `;
    document.head.appendChild(style);
    selection.styleEl = style;
  }

  function refreshSelectionCheckboxes() {
    if (!selection.active) return;

    for (const stalePin of document.querySelectorAll("[data-lb-selectable]")) {
      if (stalePin.matches(PIN_CARD_SELECTOR)) {
        continue;
      }
      stalePin.removeAttribute("data-lb-selectable");
      stalePin.removeAttribute("data-lb-sel");
      stalePin.querySelector(".__lb_chk__")?.remove();
    }

    const initialProps = parseInitialProps();
    const initialPins = initialProps?.initialReduxState?.pins || {};
    const context = getBoardContext();
    const recommendationCandidates = findRecommendationBoundaryCandidates(context);
    const recommendationBoundary = findRecommendationBoundary(
      initialPins,
      context,
      recommendationCandidates
    );
    const pins = document.querySelectorAll(PIN_CARD_SELECTOR);
    let selectionChanged = false;

    for (const pin of pins) {
      const pinId = pin.getAttribute("data-test-pin-id");
      const initialPin = pinId ? initialPins[pinId] : null;
      const explicitPinBoardId = getExplicitPinBoardId(initialPin, pin);
      const isAuthoritativeBoardPin = Boolean(
        context?.boardId && explicitPinBoardId === String(context.boardId)
      );
      const isExplicitForeignPin = Boolean(
        context?.boardId &&
        explicitPinBoardId &&
        explicitPinBoardId !== String(context.boardId)
      );
      const wasAcceptedAsBoardPin = Boolean(
        pinId && selection.acceptedBoardIds.has(pinId)
      );
      const shouldRememberAsBoardPin = Boolean(
        isAuthoritativeBoardPin || recommendationBoundary
      );
      const isBoundaryOccurrence = Boolean(
        isPinAtOrAfterRecommendationBoundary(pin, recommendationBoundary) ||
        isPinInRecommendationRegion(pin, context, recommendationCandidates)
      );
      const isRecommendationOccurrence = Boolean(
        isBoundaryOccurrence ||
        isExplicitForeignPin ||
        (
          !isAuthoritativeBoardPin &&
          !pinBelongsToBoard(initialPin, context, pin)
        )
      );
      const isRememberedRecommendation = Boolean(
        pinId &&
        selection.recommendationIds.has(pinId) &&
        !wasAcceptedAsBoardPin &&
        !isAuthoritativeBoardPin &&
        !recommendationBoundary
      );
      const isRecommendationPin = Boolean(
        isRecommendationOccurrence || isRememberedRecommendation
      );
      if (isRecommendationPin) {
        if (pinId) {
          selection.recommendationIds.add(pinId);
          if (isExplicitForeignPin || !wasAcceptedAsBoardPin) {
            selection.acceptedBoardIds.delete(pinId);
          }
        }
        pin.removeAttribute("data-lb-selectable");
        pin.removeAttribute("data-lb-sel");
        pin.querySelector(".__lb_chk__")?.remove();
        if (
          pinId &&
          (isExplicitForeignPin || !wasAcceptedAsBoardPin) &&
          selection.selectedIds.delete(pinId)
        ) {
          selectionChanged = true;
        }
        continue;
      }

      if (pinId) {
        if (shouldRememberAsBoardPin) {
          selection.acceptedBoardIds.add(pinId);
        }
        selection.recommendationIds.delete(pinId);
      }
      pin.setAttribute("data-lb-selectable", "1");
      if (pinId && selection.selectedIds.has(pinId)) {
        pin.setAttribute("data-lb-sel", "1");
      } else {
        pin.removeAttribute("data-lb-sel");
      }
      if (pin.querySelector(".__lb_chk__")) continue;
      const chk = document.createElement("span");
      chk.className = "__lb_chk__";
      pin.appendChild(chk);
    }

    updateSelectionBar();
    if (selectionChanged) {
      notifyStatusChange();
    }
  }

  function handleSelectionClick(e) {
    const pin = e.target.closest(PIN_CARD_SELECTOR);
    if (!pin || !pin.hasAttribute("data-lb-selectable")) return;
    e.preventDefault();
    e.stopPropagation();
    const pinId = pin.getAttribute("data-test-pin-id");
    if (!pinId) return;
    if (selection.selectedIds.has(pinId)) {
      selection.selectedIds.delete(pinId);
      pin.removeAttribute("data-lb-sel");
    } else {
      selection.selectedIds.add(pinId);
      pin.setAttribute("data-lb-sel", "1");
    }
    updateSelectionBar();
    notifyStatusChange();
  }

  function showSelectionBar() {
    const host = document.createElement("div");
    host.id = "__lb_sel_bar__";
    host.style.cssText = [
      "position:fixed",
      "bottom:0",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "pointer-events:none",
      "display:flex",
      "justify-content:center",
      "padding:0 16px 24px"
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const logoUrl = chrome.runtime.getURL("assets/localboard-logo.png");
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          display: inline-flex;
          align-items: center;
          max-width: calc(100vw - 32px);
          box-sizing: border-box;
          gap: 16px;
          padding: 10px 12px;
          border: 1px solid rgba(118, 83, 65, 0.18);
          background: rgba(255, 250, 245, 0.96);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-radius: 20px;
          box-shadow:
            0 16px 45px rgba(48, 31, 24, 0.2),
            0 2px 7px rgba(48, 31, 24, 0.1);
          color: #171516;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
          pointer-events: all;
          animation: lb-slide-up 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
        }
        @keyframes lb-slide-up {
          from { transform: translateY(140%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        .info {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .logo {
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 12px;
          object-fit: cover;
        }
        .count {
          font-size: 16px;
          font-weight: 680;
          color: #4d494b;
          letter-spacing: -0.005em;
          font-variant-numeric: tabular-nums;
        }
        .count em {
          font-style: normal;
          font-weight: 820;
          color: #bd0025;
        }
        .actions {
          display: inline-flex;
          gap: 8px;
        }
        button {
          appearance: none;
          border: 0;
          cursor: pointer;
          font: inherit;
          min-height: 46px;
          font-size: 15px;
          font-weight: 700;
          padding: 12px 18px;
          border-radius: 999px;
          letter-spacing: -0.005em;
          transition:
            background 0.15s ease,
            opacity 0.15s ease,
            transform 0.1s ease,
            box-shadow 0.18s ease;
        }
        button:active:not(:disabled) { transform: scale(0.96); }
        button:disabled { opacity: 0.35; cursor: default; }
        .exit {
          background: #eee8e3;
          color: #4d494b;
        }
        .exit:hover { background: #e2d9d2; color: #171516; }
        .dl {
          background: #bd0025;
          color: #fff;
          padding: 12px 20px;
          box-shadow: 0 7px 18px rgba(189, 0, 37, 0.2);
        }
        .dl:hover:not(:disabled) { background: #a50020; }
      </style>
      <div class="bar">
        <span class="info">
          <img class="logo" src="${logoUrl}" alt="" />
          <span class="count"><em id="cnt">0</em> selected</span>
        </span>
        <span class="actions">
          <button class="exit" type="button">Whole board</button>
          <button class="dl" type="button" disabled>Export selected</button>
        </span>
      </div>
    `;

    const countEl = shadow.getElementById("cnt");
    const exitBtn  = shadow.querySelector(".exit");
    const dlBtn    = shadow.querySelector(".dl");

    exitBtn.addEventListener("click", handleWholeBoardClick);
    dlBtn.addEventListener("click", () => {
      if (selection.selectedIds.size > 0) {
        const exportMode = selection.selectedIds.size >= SMART_PART_SIZE ? "parts" : "single";
        beginRun([...selection.selectedIds], exportMode);
      }
    });

    selection._barCountEl = countEl;
    selection._barDlBtn   = dlBtn;

    document.documentElement.appendChild(host);
    selection.barHost = host;
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const count = selection.selectedIds.size;
    if (selection._barCountEl) selection._barCountEl.textContent = count;
    if (selection._barDlBtn)   selection._barDlBtn.disabled = count === 0;
  }

  async function handleWholeBoardClick() {
    exitSelectionMode();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "OPEN_LOCALBOARD_POPUP"
      });
      if (response?.ok === false) {
        throw new Error(response.reason || "Could not open LocalBoard.");
      }
    } catch {
      showTransientNotice("Selection closed. Open LocalBoard from the toolbar to export the whole board.");
    }
  }

  function showTransientNotice(message) {
    document.getElementById("__lb_notice__")?.remove();

    const host = document.createElement("div");
    host.id = "__lb_notice__";
    host.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:24px",
      "z-index:2147483647",
      "transform:translateX(-50%)"
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const notice = document.createElement("div");
    notice.textContent = message;
    notice.style.cssText = [
      "max-width:min(420px,calc(100vw - 32px))",
      "box-sizing:border-box",
      "padding:13px 17px",
      "border:1px solid rgba(118,83,65,.18)",
      "border-radius:14px",
      "background:#fffaf5",
      "color:#262224",
      "box-shadow:0 14px 38px rgba(48,31,24,.22)",
      "font:700 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "text-align:center"
    ].join(";");
    shadow.appendChild(notice);
    document.documentElement.appendChild(host);
    window.setTimeout(() => host.remove(), 5000);
  }

  function wait(durationMs) {
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }

  function waitForRun(durationMs, runSignal) {
    assertNotCancelled(runSignal);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timer);
        runSignal?.removeEventListener("abort", onRunAbort);
        callback();
      };
      const onRunAbort = () => finish(() => reject(new CancelledError()));
      const timer = window.setTimeout(() => finish(resolve), durationMs);

      runSignal?.addEventListener("abort", onRunAbort, { once: true });
      if (runSignal?.aborted || state.run.cancelRequested) {
        onRunAbort();
      }
    });
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = null; fn(...args); }, ms);
    };
  }

  function startUrlWatcher() {
    let lastUrl = location.href;

    function onNavigate() {
      if (location.href === lastUrl) return;
      const previousPageKey = getBoardPageKey(lastUrl);
      const nextPageKey = getBoardPageKey(location.href);
      const boardPageChanged = Boolean(
        previousPageKey && nextPageKey && previousPageKey !== nextPageKey
      );
      lastUrl = location.href;

      state.contextCache = null;
      state.contextUrl   = "";

      if (boardPageChanged && selection.active) {
        exitSelectionMode();
      }

      if (boardPageChanged && state.jobPromise && !state.run.cancelRequested) {
        requestCancel();
      }
    }

    try {
      const origPush    = history.pushState.bind(history);
      const origReplace = history.replaceState.bind(history);
      history.pushState    = (...args) => { origPush(...args);    onNavigate(); };
      history.replaceState = (...args) => { origReplace(...args); onNavigate(); };
    } catch {
      /* ignore if history API is restricted */
    }

    window.addEventListener("popstate", onNavigate);
    window.setInterval(onNavigate, 800);
  }

  startUrlWatcher();
})();
