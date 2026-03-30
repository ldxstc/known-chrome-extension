const setupView = document.getElementById("setupView");
const connectedView = document.getElementById("connectedView");
const apiKeyInput = document.getElementById("apiKeyInput");
const connectBtn = document.getElementById("connectBtn");
const createNewBtn = document.getElementById("createNewBtn");
const setupError = document.getElementById("setupError");
const disconnectBtn = document.getElementById("disconnectBtn");
const nodesValue = document.getElementById("nodesValue");
const insightsValue = document.getElementById("insightsValue");
const planValue = document.getElementById("planValue");
const statusText = document.getElementById("statusText");

document.addEventListener("DOMContentLoaded", async () => {
  const { knownApiKey } = await chrome.storage.local.get("knownApiKey");
  if (knownApiKey) {
    showConnectedView(knownApiKey);
  } else {
    showSetupView();
  }
});

// --- Setup View ---

function showSetupView() {
  setupView.style.display = "block";
  connectedView.style.display = "none";
  setupError.style.display = "none";
}

connectBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key.startsWith("kn_live_")) {
    showError("Key must start with kn_live_");
    return;
  }

  connectBtn.textContent = "Connecting...";
  connectBtn.disabled = true;

  try {
    // Verify the key works
    const response = await fetch("https://api.finallyknown.ai/stats", {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!response.ok) {
      showError("Invalid key — check and try again.");
      return;
    }

    const data = await response.json();

    // Store the key
    await chrome.storage.local.set({ knownApiKey: key });

    // Notify background script
    chrome.runtime.sendMessage({ type: "keyUpdated", key });

    showConnectedView(key, data);
  } catch (err) {
    showError("Can't reach Known Cloud. Check your internet.");
  } finally {
    connectBtn.textContent = "Connect";
    connectBtn.disabled = false;
  }
});

createNewBtn.addEventListener("click", async () => {
  createNewBtn.textContent = "Creating...";
  createNewBtn.disabled = true;

  try {
    const deviceId = "chrome-" + crypto.randomUUID().slice(0, 16);
    const response = await fetch(
      "https://api.finallyknown.ai/auth/auto-provision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_platform: "chrome-extension",
          device_id: deviceId,
          device_name: "Chrome Browser",
        }),
      }
    );

    const data = await response.json();
    if (!data.api_key) {
      showError("Failed to create account.");
      return;
    }

    await chrome.storage.local.set({ knownApiKey: data.api_key });
    chrome.runtime.sendMessage({ type: "keyUpdated", key: data.api_key });
    showConnectedView(data.api_key);
  } catch (err) {
    showError("Can't reach Known Cloud.");
  } finally {
    createNewBtn.textContent = "Create new account";
    createNewBtn.disabled = false;
  }
});

function showError(msg) {
  setupError.textContent = msg;
  setupError.style.display = "block";
}

// --- Connected View ---

async function showConnectedView(key, cachedData) {
  setupView.style.display = "none";
  connectedView.style.display = "block";

  if (cachedData) {
    renderStats(cachedData);
  } else {
    loadStats(key);
  }
}

async function loadStats(key) {
  statusText.textContent = "Loading...";
  try {
    const response = await fetch("https://api.finallyknown.ai/stats", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await response.json();
    renderStats(data);
  } catch {
    statusText.textContent = "Can't reach Known Cloud.";
  }
}

function renderStats(data) {
  nodesValue.textContent = fmt(data.nodes || 0);
  insightsValue.textContent = fmt(data.insights || 0);
  planValue.textContent = String(data.plan || "free").toUpperCase();
  statusText.textContent = "Memory is active on supported AI sites.";
}

disconnectBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("knownApiKey");
  chrome.runtime.sendMessage({ type: "keyUpdated", key: null });
  showSetupView();
});

function fmt(n) {
  return new Intl.NumberFormat().format(Number(n || 0));
}
