/* Plain-text quote anchoring; source HTML is always the source of truth. */
(function (root) {
  function textNodes(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("script,style,noscript") ?
          NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let node, offset = 0;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: offset, end: offset + node.textContent.length });
      offset += node.textContent.length;
    }
    return nodes;
  }
  function getSelectionAnchor(container, selection) {
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
    const nodes = textNodes(container);
    const fullText = nodes.map(item => item.node.textContent).join("");
    let start = null, end = null;
    for (const item of nodes) {
      if (!range.intersectsNode(item.node)) continue;
      const a = item.node === range.startContainer ? range.startOffset : 0;
      const b = item.node === range.endContainer ? range.endOffset : item.node.textContent.length;
      if (b <= a) continue;
      if (start === null) start = item.start + a;
      end = item.start + b;
    }
    if (start === null || end === null) return null;
    while (start < end && /\s/.test(fullText[start])) start++;
    while (end > start && /\s/.test(fullText[end - 1])) end--;
    if (start === end) return null;
    return {
      exact: fullText.slice(start, end),
      prefix: fullText.slice(Math.max(0, start - 48), start),
      suffix: fullText.slice(end, end + 48)
    };
  }
  function commonSuffix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }
  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
  function locate(text, anchor) {
    if (!anchor?.exact) return -1;
    let best = -1, score = -1, from = 0;
    while (from < text.length) {
      const index = text.indexOf(anchor.exact, from);
      if (index < 0) break;
      const before = text.slice(Math.max(0, index - (anchor.prefix || "").length), index);
      const after = text.slice(index + anchor.exact.length, index + anchor.exact.length + (anchor.suffix || "").length);
      const current = commonSuffix(before, anchor.prefix || "") + commonPrefix(after, anchor.suffix || "");
      if (current > score) { best = index; score = current; }
      from = index + 1;
    }
    return best;
  }
  function paint(container, annotations) {
    const nodes = textNodes(container);
    const text = nodes.map(item => item.node.textContent).join("");
    const resolved = annotations.map(annotation => ({
      annotation,
      start: locate(text, annotation.anchor)
    })).filter(item => item.start >= 0);
    for (const item of nodes) {
      if (item.start === item.end) continue;
      const boundaries = new Set([0, item.end - item.start]);
      const spans = [];
      for (const { annotation, start } of resolved) {
        const from = Math.max(0, start - item.start);
        const to = Math.min(item.end - item.start, start + annotation.anchor.exact.length - item.start);
        if (from < to) {
          boundaries.add(from);
          boundaries.add(to);
          spans.push({ from, to, id: annotation.id, className: annotation.className || "" });
        }
      }
      if (!spans.length) continue;
      const points = [...boundaries].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < points.length - 1; i++) {
        const part = item.node.textContent.slice(points[i], points[i + 1]);
        const covering = spans.filter(span => span.from <= points[i] && span.to >= points[i + 1]);
        const ids = covering.map(span => span.id);
        if (ids.length) {
          const mark = document.createElement("mark");
          mark.dataset.annotationIds = ids.join(",");
          const classes = [...new Set(covering.flatMap(span => span.className.split(" ").filter(Boolean)))];
          if (classes.length) mark.className = classes.join(" ");
          mark.textContent = part;
          fragment.append(mark);
        } else fragment.append(document.createTextNode(part));
      }
      item.node.replaceWith(fragment);
    }
    return new Set(resolved.map(item => item.annotation.id));
  }
  root.QuietAnchors = { getSelectionAnchor, locate, paint };
})(globalThis);