const $ = selector => document.querySelector(selector);
const body = $("#article-body");
const params = new URLSearchParams(location.search);
const demoMode = params.get("demo");
const demo = Boolean(demoMode);
const key = demo ? `quiet-reader-${demoMode}-demo` : params.get("key");
const demoDocument = {
  url: "https://example.org/field-notes/the-art-of-paying-attention",
  title: "The art of paying attention",
  byline: "A field note from Quiet Reader",
  siteName: "FIELD NOTES",
  savedAt: Date.now(),
  progress: 0,
  annotations: demoMode === "comments" ? [
    {
      id: "demo-highlight-one",
      type: "highlight",
      anchor: { exact: "quiet that arrives", prefix: "There is a particular kind of ", suffix: " when we decide to look closely." },
      createdAt: Date.now()
    },
    {
      id: "demo-comment-one",
      type: "comment",
      anchor: { exact: "quiet that arrives", prefix: "There is a particular kind of ", suffix: " when we decide to look closely." },
      highlightId: "demo-highlight-one",
      text: "This is the kind of quiet I want to make room for.",
      createdAt: Date.now()
    }
  ] : [],
  html: `<p>There is a particular kind of quiet that arrives when we decide to look closely. A sentence slows us down. A thought stays with us after we close the page.</p><p>Reading can be a small act of resistance against the rush of the day. We do not need to capture every idea. We only need to notice the ones that matter.</p><h2>Leave a trace</h2><p>Highlight a line worth returning to. Add a note if you have something to say. Later, your own words can help you find your way back to the moment you first understood it.</p><p>Not every useful thought is loud. Sometimes the most important idea is the one you nearly passed by.</p>`
};
const storage = {
  async get(name) {
    if (demo) {
      try { return JSON.parse(localStorage.getItem(name)) || demoDocument; }
      catch { return demoDocument; }
    }
    return (await chrome.storage.local.get(name))[name];
  },
  async set(name, value) {
    if (demo) localStorage.setItem(name, JSON.stringify(value));
    else await chrome.storage.local.set({ [name]: value });
  }
};
let article = null;
let pending = null;
let pendingRect = null;
let progressTimer, toastTimer;
let painting = false;

function idFor(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
function sameAnchor(left, right) {
  return left?.exact === right?.exact && left?.prefix === right?.prefix && left?.suffix === right?.suffix;
}
function highlightAnnotations() {
  return article.annotations.filter(annotation => annotation.type === "highlight");
}
function commentAnnotations() {
  return article.annotations.filter(annotation => annotation.type === "comment");
}
function migrateAnnotations() {
  const migrated = [];
  for (const annotation of article.annotations || []) {
    if (!annotation?.anchor) continue;
    if (annotation.type === "highlight" || annotation.type === "comment") {
      migrated.push({
        ...annotation,
        type: annotation.type,
        text: annotation.type === "comment" ? (annotation.text || annotation.note || "") : undefined
      });
      continue;
    }
    // Older MVP records combined the highlight and optional note. Split them
    // once on load so highlights and comments can now be edited independently.
    const highlightId = `${annotation.id || idFor("legacy")}-highlight`;
    migrated.push({ id: highlightId, type: "highlight", anchor: annotation.anchor, createdAt: annotation.createdAt });
    if (annotation.note?.trim()) {
      migrated.push({
        id: `${annotation.id || idFor("legacy")}-comment`,
        type: "comment",
        anchor: annotation.anchor,
        highlightId,
        text: annotation.note.trim(),
        createdAt: annotation.createdAt
      });
    }
  }
  article.annotations = migrated;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}
function setTheme(theme, persist = true) {
  if (!["light", "paper", "night"].includes(theme)) theme = "paper";
  document.body.dataset.theme = theme;
  document.querySelectorAll("[data-set-theme]").forEach(button => {
    button.classList.toggle("active", button.dataset.setTheme === theme);
    button.setAttribute("aria-pressed", String(button.dataset.setTheme === theme));
  });
  if (persist) {
    if (demo) localStorage.setItem("quiet-reader-theme", theme);
    else chrome.storage.local.set({ "quiet-reader-theme": theme });
  }
}
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}
function showError() {
  $("#error").hidden = false;
  $("#reading-view").hidden = true;
  $("#annotation-rail").hidden = true;
  $("#progress-label").textContent = "";
}
function renderArticle() {
  painting = true;
  // Rebuild from the original sanitized article, never from annotation markup.
  body.innerHTML = DOMPurify.sanitize(article.html, {
    FORBID_TAGS: ["form", "iframe", "object", "embed", "video", "audio", "svg", "math"],
    FORBID_ATTR: ["style", "srcset"]
  });
  body.querySelectorAll("[href],[src]").forEach(el => {
    for (const attr of ["href", "src"]) {
      if (el.hasAttribute(attr) && !safeUrl(el.getAttribute(attr))) el.removeAttribute(attr);
    }
    if (el.tagName === "A") {
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
  });
  const highlights = highlightAnnotations();
  const visualAnchors = highlights.map(annotation => ({ ...annotation, className: "highlight-mark" }));
  for (const comment of commentAnnotations()) {
    if (!highlights.some(highlight => highlight.id === comment.highlightId)) {
      visualAnchors.push({ ...comment, className: "comment-anchor" });
    }
  }
  QuietAnchors.paint(body, visualAnchors);
  painting = false;
  requestAnimationFrame(positionComments);
}
function jumpTo(id) {
  const annotation = article.annotations.find(item => item.id === id);
  const targetId = annotation?.type === "comment" && highlightAnnotations().some(item => item.id === annotation.highlightId)
    ? annotation.highlightId : id;
  const mark = [...body.querySelectorAll("mark[data-annotation-ids]")].find(el =>
    el.dataset.annotationIds.split(",").includes(targetId)
  );
  if (!mark) { toast("This highlight could not be found in the article."); return; }
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  mark.classList.add("flash");
  setTimeout(() => mark.classList.remove("flash"), 1700);
}
function actionButton(label, action) {
  const button = document.createElement("button");
  button.textContent = label;
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}
async function save() {
  try { await storage.set(key, article); }
  catch { toast("Could not save. Check available storage space."); }
}
function targetMarkFor(annotation) {
  const targetId = annotation?.type === "comment" && highlightAnnotations().some(item => item.id === annotation.highlightId)
    ? annotation.highlightId : annotation?.id;
  if (!targetId) return null;
  return [...body.querySelectorAll("mark[data-annotation-ids]")].find(element =>
    element.dataset.annotationIds.split(",").includes(targetId)
  );
}
function positionFloating(element, rect) {
  if (!element || !rect) return;
  element.hidden = false;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - element.offsetWidth / 2), window.innerWidth - element.offsetWidth - 12);
  const below = rect.bottom + 10;
  const top = below + element.offsetHeight < window.innerHeight ? below : Math.max(10, rect.top - element.offsetHeight - 10);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
function positionComments() {
  const rail = $("#annotation-rail");
  if (!rail || !article) return;
  const layout = $(".layout");
  const layoutRect = layout.getBoundingClientRect();
  const comments = [...document.querySelectorAll(".comment-card")];
  const items = comments.map(card => ({
    card,
    target: targetMarkFor(article.annotations.find(item => item.id === card.dataset.commentId))
  })).filter(item => item.target);
  items.sort((left, right) => left.target.getBoundingClientRect().top - right.target.getBoundingClientRect().top);
  const cursors = { left: 16, right: 16 };
  items.forEach(({ card, target }, index) => {
    const side = index % 2 === 0 ? "right" : "left";
    card.classList.toggle("comment-side-left", side === "left");
    card.classList.toggle("comment-side-right", side === "right");
    const targetRect = target.getBoundingClientRect();
    const desired = targetRect.top + window.scrollY - layoutRect.top - 20;
    const top = Math.max(cursors[side], desired);
    card.style.top = `${top}px`;
    cursors[side] = top + card.offsetHeight + 20;
  });
  rail.style.minHeight = `${Math.max(window.innerHeight, cursors.left + 40, cursors.right + 40)}px`;
  requestAnimationFrame(drawCommentConnectors);
}
function drawCommentConnectors() {
  const svg = $("#connector-layer");
  if (!svg || !article) return;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
  svg.setAttribute("width", window.innerWidth);
  svg.setAttribute("height", window.innerHeight);
  const highlights = highlightAnnotations();
  for (const comment of commentAnnotations()) {
    const targetId = highlights.some(item => item.id === comment.highlightId) ? comment.highlightId : comment.id;
    const mark = targetMarkFor(comment);
    const card = [...document.querySelectorAll(".comment-card")].find(element =>
      element.dataset.commentId === comment.id
    );
    if (!mark || !card) continue;
    const target = mark.getBoundingClientRect();
    const destination = card.getBoundingClientRect();
    if (target.bottom < 0 || target.top > window.innerHeight || destination.bottom < 0 || destination.top > window.innerHeight) continue;
    const side = card.classList.contains("comment-side-left") ? "left" : "right";
    const x1 = side === "left" ? target.left - 5 : target.right + 5;
    const y1 = target.top + target.height / 2;
    const x2 = side === "left" ? destination.right + 8 : destination.left - 8;
    const y2 = destination.top + 25;
    if (side === "right" && x2 <= x1) continue;
    if (side === "left" && x2 >= x1) continue;
    const curve = Math.max(18, (x2 - x1) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", side === "left"
      ? `M ${x1} ${y1} C ${x1 - Math.abs(curve)} ${y1}, ${x2 + Math.abs(curve)} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", "comment-connector");
    svg.append(path);
  }
}
function renderNotes() {
  const list = $("#annotation-rail");
  list.replaceChildren();
  if (!commentAnnotations().length) {
    list.style.minHeight = "0";
    return;
  }
  const comments = [...commentAnnotations()].reverse();
  for (const annotation of comments) {
    const card = document.createElement("section");
    card.className = "note-card comment-card";
    card.dataset.commentId = annotation.id;
    const quote = document.createElement("blockquote");
    quote.textContent = `“${annotation.anchor.exact}”`;
    quote.title = "Go to commented text";
    quote.addEventListener("click", () => jumpTo(annotation.id));
    card.append(quote);
    const note = document.createElement("p");
    note.className = "comment-text";
    note.textContent = annotation.text;
    card.append(note);
    const actions = document.createElement("div");
    actions.className = "note-actions";
    actions.append(
      actionButton("Go to text", () => jumpTo(annotation.id)),
      actionButton("Copy quote", async () => {
        try {
          await navigator.clipboard.writeText(`“${annotation.anchor.exact}”\n${article.url}`);
          toast("Quote and source URL copied.");
        } catch { toast("Clipboard unavailable in this browser."); }
      }),
      actionButton("Edit", () => {
        if (card.querySelector("textarea")) return;
        const field = document.createElement("textarea");
        field.className = "note-edit";
        field.setAttribute("aria-label", "Edit comment");
        field.value = annotation.text;
        field.rows = 3;
        const controls = document.createElement("div");
        controls.className = "composer-actions";
        controls.append(
          actionButton("Cancel", () => renderNotes()),
          actionButton("Save comment", async () => {
            const next = field.value.trim();
            if (!next) { toast("A comment needs some text."); return; }
            annotation.text = next;
            await save();
            renderNotes();
            toast("Comment updated.");
          })
        );
        card.append(field, controls);
        field.focus();
      }),
      actionButton("Delete", async () => {
        if (!confirm("Delete this comment? The highlight will stay.")) return;
        article.annotations = article.annotations.filter(item => item.id !== annotation.id);
        renderArticle();
        renderNotes();
        await save();
        toast("Comment deleted.");
      })
    );
    card.append(actions);
    list.append(card);
  }
  requestAnimationFrame(positionComments);
}
function updateProgress() {
  if (!article || painting) return;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const fraction = Math.min(1, Math.max(0, window.scrollY / max));
  $("#progress-bar").style.width = `${Math.round(fraction * 100)}%`;
  $("#progress-label").textContent = `${Math.round(fraction * 100)}% read`;
  if (Math.abs((article.progress || 0) - fraction) < 0.01) return;
  article.progress = fraction;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(save, 700);
}
function showSelection() {
  if (!article || !$("#selection-menu").hidden || !$("#comment-editor").hidden) return;
  const selection = window.getSelection();
  const anchor = QuietAnchors.getSelectionAnchor(body, selection);
  if (!anchor || anchor.exact.length > 2000) return;
  pending = anchor;
  pendingRect = selection.getRangeAt(0).getBoundingClientRect();
  positionFloating($("#selection-menu"), pendingRect);
}
function openCommentEditor(rect = null) {
  if (!pending) return;
  $("#selection-menu").hidden = true;
  $("#annotation-actions").hidden = true;
  $("#comment-preview").textContent = `“${pending.exact}”`;
  $("#new-note").value = "";
  const editor = $("#comment-editor");
  positionFloating(editor, rect || pendingRect);
  $("#new-note").focus();
}
function cancelSelection() {
  pending = null;
  pendingRect = null;
  $("#selection-menu").hidden = true;
  $("#comment-editor").hidden = true;
  $("#annotation-actions").hidden = true;
  window.getSelection()?.removeAllRanges();
}
function existingHighlight(anchor) {
  return highlightAnnotations().find(annotation => sameAnchor(annotation.anchor, anchor));
}
async function createHighlight() {
  if (!pending || !article) return;
  if (existingHighlight(pending)) {
    cancelSelection();
    toast("That passage is already highlighted.");
    return;
  }
  article.annotations.push({ id: idFor("highlight"), type: "highlight", anchor: pending, createdAt: Date.now() });
  cancelSelection();
  renderArticle();
  renderNotes();
  await save();
  toast("Highlight saved.");
}
async function createComment() {
  if (!pending || !article) return;
  const text = $("#new-note").value.trim();
  if (!text) { toast("Write a comment before saving it."); $("#new-note").focus(); return; }
  const highlight = existingHighlight(pending) || {
    id: idFor("highlight"), type: "highlight", anchor: pending, createdAt: Date.now()
  };
  if (!existingHighlight(pending)) article.annotations.push(highlight);
  article.annotations.push({
    id: idFor("comment"),
    type: "comment",
    anchor: pending,
    highlightId: highlight.id,
    text,
    createdAt: Date.now()
  });
  cancelSelection();
  renderArticle();
  renderNotes();
  await save();
  toast("Comment saved beside the passage.");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}
function exportBodyHtml() {
  const exportBody = document.createElement("div");
  exportBody.innerHTML = DOMPurify.sanitize(article.html, {
    ALLOWED_TAGS: ["p", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "a", "strong", "em", "b", "i", "code", "pre", "br", "hr"],
    ALLOWED_ATTR: ["href", "target", "rel"]
  });
  exportBody.querySelectorAll("a").forEach(link => {
    if (!safeUrl(link.getAttribute("href"))) link.removeAttribute("href");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  const highlights = highlightAnnotations();
  const visualAnchors = highlights.map(annotation => ({ ...annotation, className: "highlight-mark" }));
  for (const comment of commentAnnotations()) {
    if (!highlights.some(highlight => highlight.id === comment.highlightId)) {
      visualAnchors.push({ ...comment, className: "comment-anchor" });
    }
  }
  QuietAnchors.paint(exportBody, visualAnchors);
  return exportBody.innerHTML;
}
function exportHtml() {
  const comments = commentAnnotations();
  const commentMarkup = comments.length ? comments.map((comment, index) => `
    <article class="comment">
      <div class="comment-index">${String(index + 1).padStart(2, "0")}</div>
      <blockquote>“${escapeHtml(comment.anchor.exact)}”</blockquote>
      <p>${escapeHtml(comment.text)}</p>
    </article>`).join("") : `<p class="quiet">No comments on this article.</p>`;
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(article.title)} — Quiet Reader</title>
<style>
:root{color-scheme:light;--paper:#f8f5ed;--ink:#26342d;--muted:#79827b;--line:#d9d8cc;--accent:#3b604c;--highlight:#e5d6a4}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,Helvetica,sans-serif}
.sheet{max-width:1040px;margin:0 auto;padding:58px 48px 80px}.masthead{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:42px}
.eyebrow{color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.2em}.masthead h1{font:normal clamp(38px,5vw,64px)/1.06 Georgia,"Times New Roman",serif;letter-spacing:-.045em;margin:22px 0 17px;max-width:760px}
.meta{font-size:12px;color:var(--muted)}.meta a{color:var(--accent);text-decoration:none}.source{margin-top:17px;font-size:11px;color:var(--muted)}
.content{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:58px;align-items:start}.article{font:18px/1.85 Georgia,"Times New Roman",serif;overflow-wrap:anywhere}.article p{margin:0 0 1.4em}.article h2,.article h3,.article h4{line-height:1.2;margin:1.7em 0 .65em}.article blockquote{border-left:2px solid var(--accent);color:var(--muted);font-style:italic;margin:2em 0;padding-left:18px}.article pre{background:#eeece3;overflow:auto;padding:14px;font:13px/1.55 monospace}.article mark{background:var(--highlight);border-radius:2px;color:var(--ink);padding:0 .04em}.article mark.comment-anchor{background:transparent;border-bottom:1px dashed var(--accent);border-radius:0}
.comments{border-top:1px solid var(--line);padding-top:16px}.comments h2{color:var(--accent);font-size:10px;letter-spacing:.2em;margin:0 0 20px}.comment{border-top:1px solid var(--line);padding:17px 0 18px;position:relative}.comment:first-of-type{border-top:0}.comment-index{color:var(--accent);font-size:10px;letter-spacing:.15em}.comment blockquote{font:italic 12px/1.45 Georgia,serif;margin:9px 0 12px;padding-left:10px;border-left:1px solid var(--accent)}.comment p{font-family:"Bradley Hand","Segoe Print","Comic Sans MS",cursive;font-size:17px;line-height:1.4;margin:0}.quiet{color:var(--muted);font:italic 14px Georgia,serif}.footer{border-top:1px solid var(--line);color:var(--muted);font-size:10px;margin-top:60px;padding-top:14px}
@media(max-width:760px){.sheet{padding:34px 22px 55px}.content{display:block}.comments{margin-top:46px}.article{font-size:17px}}
@media print{body{background:#fff}.sheet{padding:0}.masthead{margin-top:0}.footer{margin-top:30px}}
</style>
</head>
<body>
<main class="sheet">
  <header class="masthead">
    <div class="eyebrow">QUIET READER · ANNOTATED COPY</div>
    <h1>${escapeHtml(article.title)}</h1>
    <div class="meta">${escapeHtml(article.byline || article.siteName || "")}</div>
    <div class="source">Saved ${escapeHtml(date)} · <a href="${escapeHtml(safeUrl(article.url))}">${escapeHtml(article.url)}</a></div>
  </header>
  <div class="content">
    <article class="article">${exportBodyHtml()}</article>
    <aside class="comments"><h2>COMMENTS</h2>${commentMarkup}</aside>
  </div>
  <footer class="footer">A private copy from Quiet Reader · Highlights and comments stored locally</footer>
</main>
</body>
</html>`;
}
async function downloadAnnotatedPage() {
  if (!article) return;
  await save();
  const blob = new Blob([exportHtml()], { type: "text/html;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = (article.title || "quiet-reader-annotated")
    .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70) || "quiet-reader-annotated";
  link.href = href;
  link.download = `${filename}-annotated.html`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  toast("Downloaded your annotated copy.");
}
function showAnnotationActions(mark) {
  const highlightId = mark.dataset.annotationIds.split(",").find(id =>
    highlightAnnotations().some(annotation => annotation.id === id)
  );
  const highlight = highlightAnnotations().find(annotation => annotation.id === highlightId);
  if (!highlight) return;
  pending = highlight.anchor;
  $("#annotation-actions").dataset.highlightId = highlight.id;
  positionFloating($("#annotation-actions"), mark.getBoundingClientRect());
}
async function deleteHighlight() {
  const id = $("#annotation-actions").dataset.highlightId;
  if (!id) return;
  if (!confirm("Remove this highlight? Any comments on it will remain connected to the passage.")) return;
  article.annotations = article.annotations.filter(annotation => annotation.id !== id);
  cancelSelection();
  renderArticle();
  renderNotes();
  await save();
  toast("Highlight removed.");
}
async function init() {
  if (!key || (!demo && !key.startsWith("document:"))) { showError(); return; }
  try {
    const preference = demo ? localStorage.getItem("quiet-reader-theme") :
      (await chrome.storage.local.get("quiet-reader-theme"))["quiet-reader-theme"];
    setTheme(preference || "paper", false);
    article = await storage.get(key);
  } catch { showError(); return; }
  if (!article?.html || !safeUrl(article.url)) { showError(); return; }
  migrateAnnotations();
  document.title = `${article.title} — Quiet Reader`;
  $("#site-name").textContent = article.siteName || new URL(article.url).hostname;
  $("#article-title").textContent = article.title;
  $("#byline").textContent = article.byline || "";
  const temp = document.createElement("div");
  temp.innerHTML = DOMPurify.sanitize(article.html);
  $("#read-time").textContent = `${Math.max(1, Math.ceil((temp.textContent || "").trim().split(/\s+/).length / 220))} min read`;
  $("#saved-date").textContent = `Saved ${new Date(article.savedAt || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  $("#source-link").href = $("#end-source").href = article.url;
  $("#reading-view").hidden = false;
  renderArticle();
  renderNotes();
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (article.progress > 0) window.scrollTo(0, Math.round(max * Math.min(1, article.progress)));
    updateProgress();
  });
}
document.querySelectorAll("[data-set-theme]").forEach(button =>
  button.addEventListener("click", () => setTheme(button.dataset.setTheme))
);
$("#home-link").addEventListener("click", event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
$("#download-copy").addEventListener("click", downloadAnnotatedPage);
$("#cancel-highlight").addEventListener("click", cancelSelection);
$("#highlight-selection").addEventListener("click", createHighlight);
$("#comment-selection").addEventListener("click", () => openCommentEditor());
$("#save-comment").addEventListener("click", createComment);
$("#add-comment-existing").addEventListener("click", () => openCommentEditor($("#annotation-actions").getBoundingClientRect()));
$("#copy-highlight").addEventListener("click", async () => {
  const highlight = highlightAnnotations().find(annotation => annotation.id === $("#annotation-actions").dataset.highlightId);
  if (!highlight) return;
  try {
    await navigator.clipboard.writeText(`“${highlight.anchor.exact}”\n${article.url}`);
    toast("Quote and source URL copied.");
  } catch { toast("Clipboard unavailable in this browser."); }
});
$("#delete-highlight").addEventListener("click", deleteHighlight);
body.addEventListener("mouseup", () => setTimeout(showSelection, 0));
body.addEventListener("keyup", event => { if (event.key === "Shift" || event.key.startsWith("Arrow")) showSelection(); });
body.addEventListener("click", event => {
  const mark = event.target.closest("mark[data-annotation-ids]");
  if (!mark) return;
  showAnnotationActions(mark);
});
window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("scroll", () => requestAnimationFrame(positionComments), { passive: true });
window.addEventListener("resize", () => {
  updateProgress();
  requestAnimationFrame(positionComments);
});
init();