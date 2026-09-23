const openButton = document.getElementById("open");
const status = document.getElementById("status");
const home = document.getElementById("home");
const saved = document.getElementById("saved");
const list = document.getElementById("saved-list");
const documentKey = url => `document:${url}`;

async function openReader(key) {
  const target = chrome.runtime.getURL(`reader.html?key=${encodeURIComponent(key)}`);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === target);
  if (existing) {
    await chrome.tabs.reload(existing.id);
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target });
  }
  window.close();
}

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  openButton.textContent = "Preparing article…";
  status.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
      throw new Error("Open a web article first, then try again.");
    }
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_ARTICLE" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/Readability.js", "lib/DOMPurify.js", "content.js"]
      });
      result = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_ARTICLE" });
    }
    if (!result?.ok) throw new Error(result?.error || "Could not read this page.");
    const key = documentKey(result.document.url);
    const previous = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({
      [key]: { ...result.document, annotations: previous?.annotations || [], progress: previous?.progress || 0,
        savedAt: previous?.savedAt || result.document.savedAt }
    });
    await openReader(key);
  } catch (error) {
    status.textContent = error.message || "Could not open this page. Try another article.";
    openButton.disabled = false;
    openButton.innerHTML = 'Open in Reader <span aria-hidden="true">↗</span>';
  }
});

document.getElementById("saved-link").addEventListener("click", async () => {
  home.hidden = true;
  saved.hidden = false;
  const values = await chrome.storage.local.get(null);
  const documents = Object.entries(values).filter(([key, value]) =>
    key.startsWith("document:") && value?.html && value?.url
  ).sort((a, b) => b[1].savedAt - a[1].savedAt);
  list.replaceChildren();
  if (!documents.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No saved articles yet. Open an article to start your library.";
    list.append(empty);
  }
  for (const [key, doc] of documents) {
    const button = document.createElement("button");
    button.className = "saved-item";
    const title = document.createElement("strong");
    title.textContent = doc.title;
    const site = document.createElement("small");
    const highlights = doc.annotations?.filter(annotation => annotation.type === "highlight").length || 0;
    const comments = doc.annotations?.filter(annotation => annotation.type === "comment").length || 0;
    site.textContent = `${doc.siteName} · ${highlights} highlight${highlights === 1 ? "" : "s"} · ${comments} comment${comments === 1 ? "" : "s"}`;
    button.append(title, site);
    button.addEventListener("click", () => openReader(key));
    list.append(button);
  }
});
document.getElementById("back").addEventListener("click", () => {
  saved.hidden = true;
  home.hidden = false;
});