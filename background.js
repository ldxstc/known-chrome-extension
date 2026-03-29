const API_BASE_URL = "https://api.finallyknown.ai";
const STORAGE_KEYS = {
  apiKey: "knownApiKey",
  userId: "knownUserId",
  deviceId: "knownDeviceId"
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureProvisioned();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    sendResponse?.({ ok: false, error: "Missing message type" });
    return false;
  }

  if (message.type === "ingest") {
    ingestConversation(message.text, message.source)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        console.error("Known ingest failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "understand") {
    getContext(message.question, message.source)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => {
        console.error("Known understand failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "getStats") {
    getStats()
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => {
        console.error("Known getStats failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  return false;
});

async function ensureProvisioned() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.deviceId
  ]);

  if (stored[STORAGE_KEYS.apiKey]) {
    return stored[STORAGE_KEYS.apiKey];
  }

  const deviceId =
    stored[STORAGE_KEYS.deviceId] || `chrome-${crypto.randomUUID().slice(0, 16)}`;

  const response = await fetch(`${API_BASE_URL}/auth/auto-provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_platform: "chrome-extension",
      device_id: deviceId,
      device_name: "Chrome Browser"
    })
  });

  if (!response.ok) {
    throw new Error(`Auto-provision failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data?.api_key) {
    throw new Error("Auto-provision response missing api_key");
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.apiKey]: data.api_key,
    [STORAGE_KEYS.userId]: data.user_id || null,
    [STORAGE_KEYS.deviceId]: deviceId
  });

  return data.api_key;
}

async function getApiKey() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
  if (stored[STORAGE_KEYS.apiKey]) {
    return stored[STORAGE_KEYS.apiKey];
  }
  return ensureProvisioned();
}

async function ingestConversation(text, source = "unknown") {
  if (!text?.trim()) {
    return { skipped: true, reason: "empty-text" };
  }

  const apiKey = await getApiKey();
  const response = await fetch(`${API_BASE_URL}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      text,
      source
    })
  });

  if (!response.ok) {
    throw new Error(`Ingest failed with status ${response.status}`);
  }

  const data = await safeJson(response);
  await refreshBadge();
  return data;
}

async function getContext(question, source = "unknown") {
  if (!question?.trim()) {
    return null;
  }

  const apiKey = await getApiKey();
  const url = new URL(`${API_BASE_URL}/understand`);
  url.searchParams.set("q", question);
  url.searchParams.set("source", source);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Understand failed with status ${response.status}`);
  }

  return safeJson(response);
}

async function getStats() {
  const apiKey = await getApiKey();
  const response = await fetch(`${API_BASE_URL}/stats`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Stats failed with status ${response.status}`);
  }

  const data = await safeJson(response);
  const normalized = {
    nodes: Number(data?.nodes || 0),
    insights: Number(data?.insights || 0),
    plan: data?.plan || "free"
  };
  await setBadge(normalized.nodes);
  return normalized;
}

async function refreshBadge() {
  try {
    await getStats();
  } catch (error) {
    console.warn("Known badge refresh skipped", error);
    await setBadge("");
  }
}

async function setBadge(value) {
  const text = value === "" ? "" : formatBadgeValue(value);
  await chrome.action.setBadgeBackgroundColor({ color: "#b89a6a" });
  await chrome.action.setBadgeTextColor({ color: "#070706" });
  await chrome.action.setBadgeText({ text });
}

function formatBadgeValue(value) {
  const number = Number(value || 0);
  if (!number) {
    return "";
  }
  if (number > 999) {
    return "999+";
  }
  return String(number);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
