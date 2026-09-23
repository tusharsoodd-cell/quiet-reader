(() => {
  if (globalThis.__quietReaderInstalled) return;
  globalThis.__quietReaderInstalled = true;

  function cleanArticle(article) {
    const root = document.createElement("div");
    root.innerHTML = DOMPurify.sanitize(article.content, {
      FORBID_TAGS: ["form", "iframe", "object", "embed", "video", "audio", "svg", "math"],
      FORBID_ATTR: ["style", "srcset"]
    });
    for (const element of root.querySelectorAll("*")) {
      for (const attr of ["href", "src"]) {
        if (!element.hasAttribute(attr)) continue;
        try {
          const url = new URL(element.getAttribute(attr), location.href);
          if (!["http:", "https:"].includes(url.protocol)) element.removeAttribute(attr);
          else element.setAttribute(attr, url.href);
        } catch {
          element.removeAttribute(attr);
        }
      }
      element.removeAttribute("id");
      element.removeAttribute("name");
      if (element.tagName === "A") {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
    return DOMPurify.sanitize(root.innerHTML, {
      FORBID_TAGS: ["form", "iframe", "object", "embed", "video", "audio", "svg", "math"],
      FORBID_ATTR: ["style", "srcset"]
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "EXTRACT_ARTICLE") return;
    try {
      if (!/^https?:$/.test(location.protocol)) throw new Error("This page cannot be opened in Reader.");
      const article = new Readability(document.cloneNode(true)).parse();
      if (!article?.content || !article.textContent?.trim()) {
        throw new Error("No readable article was found on this page.");
      }
      const url = new URL(location.href);
      url.hash = "";
      respond({
        ok: true,
        document: {
          url: url.href,
          title: (article.title || document.title || "Untitled article").trim(),
          byline: article.byline || "",
          siteName: article.siteName || location.hostname,
          excerpt: article.excerpt || "",
          html: cleanArticle(article),
          savedAt: Date.now()
        }
      });
    } catch (error) {
      respond({ ok: false, error: error.message || "Could not extract this article." });
    }
  });
})();