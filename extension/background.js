const DOWNLOAD_APPEAR_TIMEOUT_MS = 15_000;
const DOWNLOAD_COMPLETE_TIMEOUT_MS = 5 * 60_000;
const downloadVerifications = new Map();
const pendingVerificationCancellations = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_LOCALBOARD_POPUP") {
    openLocalBoardPopup(sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          reason: error?.message || "Could not open LocalBoard."
        });
      });
    return true;
  }

  if (message?.type === "VERIFY_BLOB_DOWNLOAD") {
    const verificationId = String(message.verificationId || "");
    const controller = new AbortController();
    if (verificationId) {
      downloadVerifications.get(verificationId)?.abort();
      downloadVerifications.set(verificationId, controller);
      if (pendingVerificationCancellations.delete(verificationId)) {
        controller.abort();
      }
    }

    verifyBlobDownload(message, controller.signal)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          reason: error?.message || "Chrome did not complete the ZIP download."
        });
      })
      .finally(() => {
        if (verificationId && downloadVerifications.get(verificationId) === controller) {
          downloadVerifications.delete(verificationId);
        }
      });
    return true;
  }

  if (message?.type === "CANCEL_BLOB_DOWNLOAD_VERIFICATION") {
    const verificationId = String(message.verificationId || "");
    const controller = downloadVerifications.get(verificationId);
    controller?.abort();
    if (verificationId && !controller) {
      pendingVerificationCancellations.add(verificationId);
      setTimeout(() => {
        pendingVerificationCancellations.delete(verificationId);
      }, DOWNLOAD_APPEAR_TIMEOUT_MS);
    }
    sendResponse({ ok: true, cancelled: Boolean(controller || verificationId) });
    return false;
  }

  return false;
});

async function openLocalBoardPopup(sender) {
  if (typeof chrome.action?.openPopup !== "function") {
    throw new Error("Opening the extension popup requires Chrome 127 or newer.");
  }

  const options = Number.isInteger(sender.tab?.windowId)
    ? { windowId: sender.tab.windowId }
    : undefined;

  if (options) {
    await chrome.action.openPopup(options);
  } else {
    await chrome.action.openPopup();
  }
}

async function verifyBlobDownload(message, signal) {
  const url = typeof message.objectUrl === "string"
    ? message.objectUrl
    : (typeof message.url === "string" ? message.url : "");
  const filename = typeof message.filename === "string" ? message.filename : "ZIP";
  const startedAt = Number(message.startedAt) || Date.now();

  if (!url.startsWith("blob:")) {
    throw new Error("LocalBoard received an invalid ZIP download URL.");
  }

  const appearedBy = Date.now() + DOWNLOAD_APPEAR_TIMEOUT_MS;
  const startedAfter = new Date(Math.max(0, startedAt - 5_000)).toISOString();
  let download = null;

  try {
    while (Date.now() < appearedBy) {
      throwIfAborted(signal);
      const candidates = await chrome.downloads.search({
        startedAfter,
        orderBy: ["-startTime"],
        limit: 50
      });
      download = candidates.find(
        (candidate) => candidate.url === url || candidate.finalUrl === url
      );
      if (download) {
        break;
      }
      await wait(250);
    }

    throwIfAborted(signal);
    if (!download) {
      throw new Error(
        `Chrome did not start ${filename}. Allow automatic downloads for Pinterest, then retry the export.`
      );
    }

    const completedBy = Date.now() + DOWNLOAD_COMPLETE_TIMEOUT_MS;
    while (Date.now() < completedBy) {
      throwIfAborted(signal);
      const [current] = await chrome.downloads.search({ id: download.id });
      if (!current) {
        throw new Error(`Chrome lost track of ${filename}. Retry this ZIP part.`);
      }
      if (current.state === "complete") {
        return { downloadId: current.id };
      }
      if (current.state === "interrupted") {
        throw new Error(
          `${filename} was interrupted${current.error ? ` (${current.error})` : ""}. Retry this ZIP part.`
        );
      }
      await wait(500);
    }

    throw new Error(`${filename} did not finish within five minutes. Retry this ZIP part.`);
  } catch (error) {
    if (signal?.aborted) {
      if (!download) {
        while (!download && Date.now() < appearedBy) {
          try {
            const candidates = await chrome.downloads.search({
              startedAfter,
              orderBy: ["-startTime"],
              limit: 50
            });
            download = candidates.find(
              (candidate) => candidate.url === url || candidate.finalUrl === url
            ) || null;
          } catch {
            break;
          }
          if (!download) {
            await wait(100);
          }
        }
      }
      if (Number.isInteger(download?.id)) {
        try {
          await chrome.downloads.cancel(download.id);
        } catch {
          // The download may have completed between the last poll and cancel.
        }
      }
      throw new Error(`${filename} download verification was cancelled.`);
    }
    throw error;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Download verification cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
