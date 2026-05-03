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
  const EXTENSION_NAME = "Pinterest LocalBoard";
  const DOWNLOAD_HISTORY_STORAGE_KEY = "localBoardDownloadHistory";
  const LEGACY_DOWNLOAD_HISTORY_STORAGE_KEY = "downloadHistory";
  const MAX_DOWNLOAD_HISTORY_ITEMS = 20;
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
    styleEl: null,
    barHost: null,
    clickHandler: null,
    observer: null,
    _barCountEl: null,
    _barDlBtn: null,
  };

  class CancelledError extends Error {
    constructor(message = "Download cancelled.") {
      super(message);
      this.name = "CancelledError";
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
        beginRun(message.pinIds || null);
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
      error: ""
    };
  }

  function getSerializableStatus() {
    return {
      ...state.run,
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

  function beginRun(pinIds = null) {
    if (state.jobPromise) {
      return;
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
    state.jobPromise = runDownloadWorkflow(context, pinIds)
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

    state.abortController?.abort();
    updateRun({
      cancelRequested: true,
      message: "Cancelling…"
    });
  }

  function assertNotCancelled() {
    if (state.run.cancelRequested) {
      throw new CancelledError();
    }
  }

  async function runDownloadWorkflow(context, pinIds = null) {
    const initialScrollY = window.scrollY;

    updateRun({
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
      error: ""
    });

    try {
      const scanResult = await collectBoardRecords(context, pinIds);
      const records = scanResult.records;
      assertNotCancelled();

      window.scrollTo(0, initialScrollY);

      updateRun({
        stage: "downloading",
        message: `Downloading ${records.length} images and preparing the ZIP…`,
        collected: records.length,
        downloaded: 0,
        failed: 0
      });

      const zipResult = await buildZip(records, context, scanResult, state.abortController?.signal);
      assertNotCancelled();

      triggerBlobDownload(zipResult.blob, zipResult.filename);
      await appendDownloadHistoryEntry({
        boardName: context.boardName,
        boardUrl: location.href,
        fileName: zipResult.filename,
        downloadedCount: zipResult.downloadedCount,
        failedCount: zipResult.failedCount,
        createdAt: Date.now()
      });

      updateRun({
        stage: "done",
        message: zipResult.message,
        downloaded: zipResult.downloadedCount,
        failed: zipResult.failedCount,
        zipProgress: 100,
        finishedAt: Date.now(),
        downloadName: zipResult.filename,
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

    if (state.contextCache?.ok) {
      return state.contextCache;
    }

    const initialProps = parseInitialProps();
    const board =
      detectBoardFromInitialState(initialProps) ||
      detectBoardFromResources(initialProps) ||
      detectBoardFromPath();

    if (!board) {
      return {
        ok: false,
        reason: buildBoardDetectionFailureReason()
      };
    }

    state.contextCache = {
      ok: true,
      boardId: String(board.id || ""),
      boardName: board.name || document.title || "Pinterest board",
      boardUrl: board.url || location.pathname,
      ownerUsername: board.owner?.username || "",
      pinCount: Number(board.pin_count) || 0,
      sectionCount: Number(board.section_count) || 0,
      warning: board.warning || "",
      matchSource: board.matchSource || "Pinterest board JSON"
    };

    return state.contextCache;
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

    if (boardCandidates.length === 1 && isProbablyBoardPath(location.pathname)) {
      return {
        ...boardCandidates[0],
        matchSource: "Single board in page state"
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

    if (boardEntries.length === 1 && isProbablyBoardPath(location.pathname)) {
      return {
        ...boardEntries[0],
        matchSource: "Single board resource"
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

  async function collectBoardRecords(context, pinIds = null) {
    await settlePage();
    assertNotCancelled();

    const initialProps = parseInitialProps();
    const initialPins = initialProps?.initialReduxState?.pins || {};
    const records = new Map();

    window.scrollTo(0, 0);
    await wait(900);

    let stagnantPasses = 0;
    let lastCollectedCount = 0;
    let lastDomCount = 0;
    let lastHeight = 0;
    const maxPasses = Math.max(
      30,
      Math.ceil((context.pinCount || 60) / 8) + 20
    );

    for (let pass = 0; pass < maxPasses; pass += 1) {
      assertNotCancelled();

      collectVisiblePins(records, initialPins);

      updateRun({
        stage: "scanning",
        message: buildScanMessage(records.size, context.pinCount),
        collected: records.size
      });

      if (context.pinCount > 0 && records.size >= context.pinCount) {
        break;
      }

      const currentHeight = document.documentElement.scrollHeight;
      if (records.size === lastCollectedCount && currentHeight === lastHeight) {
        stagnantPasses += 1;
      } else {
        stagnantPasses = 0;
      }

      if (stagnantPasses >= 6) {
        break;
      }

      lastCollectedCount = records.size;
      lastDomCount = document.querySelectorAll(PIN_CARD_SELECTOR).length;
      lastHeight = currentHeight;

      scrollBoardForward(currentHeight);
      await waitForAdditionalPins(lastDomCount, currentHeight);
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

    if (pinIds && pinIds.length > 0) {
      const pinIdSet = new Set(pinIds.map(String));
      sortedRecords = sortedRecords.filter((r) => pinIdSet.has(String(r.pinId)));
      if (sortedRecords.length === 0) {
        throw new Error(
          "None of the selected pins were found while scanning the board. Try scrolling the board to load them first."
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
        boardUrl: location.href
      }
    };
  }

  function collectVisiblePins(records, initialPins) {
    const pinElements = document.querySelectorAll(PIN_CARD_SELECTOR);

    for (const pinElement of pinElements) {
      const pinId = pinElement.getAttribute("data-test-pin-id");
      if (!pinId) {
        continue;
      }

      const nextRecord = extractPinRecord(pinElement, initialPins[pinId], records.size);
      if (!nextRecord) {
        continue;
      }

      const existingRecord = records.get(pinId);
      if (!existingRecord) {
        records.set(pinId, nextRecord);
        continue;
      }

      existingRecord.title = existingRecord.title || nextRecord.title;
      existingRecord.alt = existingRecord.alt || nextRecord.alt;
      existingRecord.pinUrl = existingRecord.pinUrl || nextRecord.pinUrl;
      mergeCandidateLists(existingRecord.candidates, nextRecord.candidates);
    }
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

  async function waitForAdditionalPins(previousCount, previousHeight) {
    const deadline = Date.now() + 5000;

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
        return currentCount > previousCount || currentHeight > previousHeight;
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

  async function buildZip(records, context, scanResult, runSignal) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip was not loaded into the content script.");
    }

    const zip = new JSZip();
    const folderName = sanitizeFileLabel(context.boardName || "board") || "board";
    const archiveBaseName = `${folderName}_localboard`;
    const folder = zip.folder(folderName);

    const concurrency = Math.min(4, Math.max(2, navigator.hardwareConcurrency || 4));
    let downloaded = 0;
    let failed = 0;
    const failures = [];

    await runWithConcurrency(records, concurrency, async (record, index) => {
      assertNotCancelled();
      try {
        const response = await fetchBestImage(record, runSignal);
        assertNotCancelled();

        const extension = pickFileExtension(response.url, response.blob.type);
        const basename = [
          String(index + 1).padStart(String(records.length).length, "0"),
          record.pinId,
          record.title || record.alt || "image"
        ]
          .filter(Boolean)
          .join("_");

        folder.file(`${basename}${extension}`, response.blob);
        downloaded += 1;
      } catch (error) {
        failed += 1;
        failures.push({
          pinId: record.pinId,
          pinUrl: record.pinUrl || "",
          title: record.title || "",
          reason: error?.message || "Unknown download error"
        });
      }

      updateRun({
        stage: "downloading",
        downloaded,
        failed,
        collected: records.length,
        message:
          failed > 0
            ? `Downloaded ${downloaded} of ${records.length} images, ${failed} failed…`
            : `Downloaded ${downloaded} of ${records.length} images…`
      });
    });

    assertNotCancelled();

    if (downloaded === 0) {
      throw new Error("Every image download failed for this board.");
    }

    const report = {
      generatedAt: new Date().toISOString(),
      board: {
        name: context.boardName,
        url: location.href,
        id: context.boardId || ""
      },
      scan: scanResult?.scanReport || null,
      results: {
        requestedCount: records.length,
        downloadedCount: downloaded,
        failedCount: failed
      },
      failures
    };

    folder.file("_download_report.json", JSON.stringify(report, null, 2));

    updateRun({
      stage: "zipping",
      zipProgress: 0,
      message: "Compressing the ZIP file…"
    });

    const zipBlob = await zip.generateAsync(
      {
        type: "blob",
        compression: "STORE",
        streamFiles: true
      },
      (metadata) => {
        updateRun({
          stage: "zipping",
          zipProgress: Number(metadata.percent) || 0,
          message: `Compressing the ZIP file… ${Math.round(
            Number(metadata.percent) || 0
          )}%`
        });
      }
    );

    const timestamp = new Date().toISOString().slice(0, 10);
    const warningParts = [];

    if (scanResult?.scanReport?.missingCount > 0) {
      warningParts.push(
        `Pinterest exposed ${scanResult.scanReport.collectedCount} of ${scanResult.scanReport.expectedCount} expected pins.`
      );
    }

    if (failed > 0) {
      warningParts.push(`${failed} images failed and were listed in _download_report.json.`);
    }

    return {
      blob: zipBlob,
      filename: `${archiveBaseName}_${timestamp}.zip`,
      downloadedCount: downloaded,
      failedCount: failed,
      message:
        failed > 0
          ? `ZIP ready: ${archiveBaseName}_${timestamp}.zip (${downloaded} saved, ${failed} failed)`
          : `ZIP ready: ${archiveBaseName}_${timestamp}.zip`,
      warning: warningParts.join(" ")
    };
  }

  async function fetchBestImage(record, runSignal) {
    const errors = [];
    const MAX_ATTEMPTS = 3;

    for (const candidate of record.candidates) {
      assertNotCancelled();

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchWithTimeout(candidate, 30000, runSignal);
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

          return { blob, url: response.url || candidate };
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          errors.push(`${candidate} (attempt ${attempt}): ${error.message}`);

          if (attempt < MAX_ATTEMPTS && isRetriableError(error)) {
            await wait(retryDelay(attempt));
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

  async function fetchWithTimeout(url, timeoutMs, runSignal) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    const onRunAbort = () => controller.abort();
    runSignal?.addEventListener("abort", onRunAbort, { once: true });

    try {
      return await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit"
      });
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

    await Promise.all(runners);
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

  function triggerBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();

    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
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

  function sanitizeFileLabel(value) {
    if (!value) {
      return "";
    }

    return String(value)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
  }

  function buildScanMessage(collected, expected) {
    if (expected > 0) {
      return `Scanning the board… collected ${collected} of ${expected} pins so far.`;
    }

    return `Scanning the board… collected ${collected} pins so far.`;
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

    const host = document.createElement("div");
    host.id = "pinterest-localboard-overlay";
    host.style.position = "fixed";
    host.style.top = "16px";
    host.style.right = "16px";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .panel {
          width: 320px;
          padding: 16px;
          border-radius: 18px;
          background: rgba(18, 16, 14, 0.92);
          color: #fff9f2;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .title {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #ffb692;
        }

        .message {
          margin-top: 10px;
          font-size: 14px;
          line-height: 1.45;
          color: #fff9f2;
        }

        .meta {
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.4;
          color: #e7d6ca;
        }

        .bar {
          height: 10px;
          margin-top: 14px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
        }

        .progress {
          height: 100%;
          width: 0%;
          border-radius: inherit;
          background: linear-gradient(90deg, #ff7253 0%, #ffb05c 100%);
          transition: width 0.18s ease;
        }

        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 14px;
        }

        button {
          appearance: none;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 9px 12px;
        }

        .cancel {
          background: #ff7253;
          color: white;
        }

        .close {
          background: rgba(255, 255, 255, 0.12);
          color: #fff9f2;
        }
      </style>
      <div class="panel">
        <div class="title"></div>
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
      message,
      meta,
      progress,
      cancel,
      close
    };

    return state.overlay;
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

    injectSelectionStyles();
    refreshSelectionCheckboxes();

    selection.observer = new MutationObserver(debounce(refreshSelectionCheckboxes, 200));
    selection.observer.observe(document.body, { childList: true, subtree: true });

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
    document.querySelectorAll(".__lb_chk__").forEach((el) => el.remove());

    if (selection.clickHandler) {
      document.removeEventListener("click", selection.clickHandler, true);
      selection.clickHandler = null;
    }

    selection.observer?.disconnect();
    selection.observer = null;

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
      [data-test-id="pin"][data-test-pin-id] {
        cursor: pointer !important;
        position: relative !important;
        transition: transform 0.15s ease !important;
      }
      [data-test-id="pin"][data-test-pin-id]:hover .__lb_chk__ {
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
    const pins = document.querySelectorAll(PIN_CARD_SELECTOR);
    for (const pin of pins) {
      if (pin.querySelector(".__lb_chk__")) continue;
      const chk = document.createElement("span");
      chk.className = "__lb_chk__";
      pin.appendChild(chk);
      const pinId = pin.getAttribute("data-test-pin-id");
      if (pinId && selection.selectedIds.has(pinId)) {
        pin.setAttribute("data-lb-sel", "1");
      }
    }
  }

  function handleSelectionClick(e) {
    const pin = e.target.closest(PIN_CARD_SELECTOR);
    if (!pin) return;
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
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          display: inline-flex;
          align-items: center;
          gap: 14px;
          padding: 9px 9px 9px 18px;
          background: rgba(18, 19, 22, 0.88);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-radius: 999px;
          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.22),
            0 2px 6px rgba(0, 0, 0, 0.12),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.08);
          color: #fff;
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
          gap: 8px;
        }
        .ico {
          width: 16px;
          height: 16px;
          color: #ff5168;
          flex-shrink: 0;
        }
        .count {
          font-size: 13px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          letter-spacing: -0.005em;
          font-variant-numeric: tabular-nums;
        }
        .count em {
          font-style: normal;
          font-weight: 700;
          color: #fff;
        }
        .actions {
          display: inline-flex;
          gap: 6px;
        }
        button {
          appearance: none;
          border: 0;
          cursor: pointer;
          font: inherit;
          font-size: 12.5px;
          font-weight: 600;
          padding: 8px 14px;
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
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.85);
        }
        .exit:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
        .dl {
          background: #fff;
          color: #0c0d10;
          padding: 8px 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        }
        .dl:hover:not(:disabled) { background: #f4f4f4; }
        .dl-icon {
          width: 13px;
          height: 13px;
          margin-right: 5px;
          vertical-align: -2px;
        }
      </style>
      <div class="bar">
        <span class="info">
          <svg class="ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18"/>
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>
            <path d="M5 8.2l2.2 2.2 3.8-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="count"><em id="cnt">0</em> selected</span>
        </span>
        <span class="actions">
          <button class="exit" type="button">Exit</button>
          <button class="dl"   type="button" disabled>
            <svg class="dl-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2.5v7.6m0 0l2.6-2.6M8 10.1L5.4 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.2 12.5v.4a1 1 0 001 1h7.6a1 1 0 001-1v-.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>Download
          </button>
        </span>
      </div>
    `;

    const countEl = shadow.getElementById("cnt");
    const exitBtn  = shadow.querySelector(".exit");
    const dlBtn    = shadow.querySelector(".dl");

    exitBtn.addEventListener("click", exitSelectionMode);
    dlBtn.addEventListener("click", () => {
      if (selection.selectedIds.size > 0) {
        beginRun([...selection.selectedIds]);
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

  function wait(durationMs) {
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
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
      lastUrl = location.href;

      state.contextCache = null;
      state.contextUrl   = "";

      if (selection.active) {
        exitSelectionMode();
      }

      if (state.jobPromise && !state.run.cancelRequested) {
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
