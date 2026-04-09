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
    jobPromise: null
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
        beginRun();
        sendResponse({ ok: true, status: getSerializableStatus() });
      } catch (error) {
        sendResponse({
          ok: false,
          reason: error?.message || "Could not start the downloader."
        });
      }

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
      stage: STAGES.has(state.run.stage) ? state.run.stage : "idle"
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

  function beginRun() {
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

    state.jobPromise = runDownloadWorkflow(context)
      .catch((error) => {
        console.error(`${EXTENSION_NAME}:`, error);
      })
      .finally(() => {
        state.jobPromise = null;
      });
  }

  function requestCancel() {
    if (!state.jobPromise) {
      return;
    }

    updateRun({
      cancelRequested: true,
      message: "Cancelling after the current step finishes…"
    });
  }

  function assertNotCancelled() {
    if (state.run.cancelRequested) {
      throw new CancelledError();
    }
  }

  async function runDownloadWorkflow(context) {
    const initialScrollY = window.scrollY;

    updateRun({
      stage: "scanning",
      message: "Scanning the board and collecting full-quality image links…",
      collected: 0,
      downloaded: 0,
      failed: 0,
      expected: context.pinCount || 0,
      zipProgress: 0,
      warning: context.warning || "",
      cancelRequested: false,
      startedAt: Date.now(),
      finishedAt: 0,
      downloadName: "",
      error: ""
    });

    try {
      const scanResult = await collectBoardRecords(context);
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

      const zipResult = await buildZip(records, context, scanResult);
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

  async function collectBoardRecords(context) {
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

    const sortedRecords = [...records.values()].sort((a, b) => a.order - b.order);
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
        if (Date.now() >= deadline || hasAdvanced()) {
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

  async function buildZip(records, context, scanResult) {
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
        const response = await fetchBestImage(record);
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

  async function fetchBestImage(record) {
    const errors = [];

    for (const candidate of record.candidates) {
      assertNotCancelled();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetchWithTimeout(candidate, 30000);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) {
            throw new Error(`Unexpected content type: ${blob.type || "unknown"}`);
          }

          return {
            blob,
            url: response.url || candidate
          };
        } catch (error) {
          errors.push(`${candidate} (attempt ${attempt}): ${error.message}`);
          if (attempt < 3 && isRetriableError(error)) {
            await wait(400 * attempt);
            continue;
          }

          break;
        }
      }
    }

    throw new Error(
      `Could not download pin ${record.pinId}. Tried ${record.candidates.length} URL candidates.`
    );
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit"
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isRetriableError(error) {
    const message = error?.message || "";
    return (
      message.includes("HTTP 429") ||
      message.includes("HTTP 500") ||
      message.includes("HTTP 502") ||
      message.includes("HTTP 503") ||
      message.includes("HTTP 504") ||
      error?.name === "AbortError"
    );
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

  function wait(durationMs) {
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }
})();
