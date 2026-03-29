const nodesValue = document.getElementById("nodesValue");
const insightsValue = document.getElementById("insightsValue");
const planValue = document.getElementById("planValue");
const statusText = document.getElementById("statusText");
const settingsButton = document.getElementById("settingsButton");

document.addEventListener("DOMContentLoaded", async () => {
  await loadStats();
});

settingsButton.addEventListener("click", () => {
  statusText.textContent = "Settings are coming soon.";
});

async function loadStats() {
  statusText.textContent = "Loading memory stats...";

  chrome.runtime.sendMessage({ type: "getStats" }, (response) => {
    if (chrome.runtime.lastError) {
      renderError(chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok || !response.data) {
      renderError(response?.error || "Unable to load Known stats.");
      return;
    }

    const data = response.data;
    nodesValue.textContent = formatNumber(data.nodes || 0);
    insightsValue.textContent = formatNumber(data.insights || 0);
    planValue.textContent = String(data.plan || "free").toUpperCase();
    statusText.textContent = "Memory is active on supported AI sites.";
  });
}

function renderError(message) {
  nodesValue.textContent = "0";
  insightsValue.textContent = "0";
  planValue.textContent = "FREE";
  statusText.textContent = message;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}
