// In the browser: what a frame shows where, for platform-zones' layout check. A page that shows
// one frame (a story, a still, a frame of a film at its moment) runs it and hands the result to
// `zones.mjs layout <boxes.json>`; `zones.mjs layout <page.html>` runs it by itself.
//
//   await platformZonesMeasure()  → { size: [w, h], story, boxes: [{ kind, label, box: [x, y, w, h], clipped? }] }
//
// The frame is the page's <insta-story> (story: true), else its element with data-composition-id,
// else the window.
// kind:
//   text     the letters of each run of text of a block (not the element's box, not the line box),
//            in px of the frame; centred when it is set centred
//   sticker  each of Storrito's <insta-…> stickers, and every element with data-zone="sticker"
//   face     every element with data-zone="face" (a face, a product that must be seen)
// Text inside an element with data-zone="ignore" (texture, meant to run under the buttons) is left
// out. clipped: the letters run past an ancestor that hides its overflow.

(function () {
  const INLINE = new Set(["inline", "inline-block", "inline-flex", "contents", "ruby"]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function frameOf(doc) {
    return doc.querySelector("insta-story") || doc.querySelector("[data-composition-id]") || doc.body;
  }

  // how visible an element is: none when hidden or nearly transparent on the way up
  function shown(el, root) {
    for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return false;
      if (e.dataset?.zone === "ignore") return false;
    }
    return true;
  }

  // the block a piece of text belongs to: its nearest ancestor that is not inline
  function blockOf(el, root) {
    let e = el;
    while (e !== root && e.parentElement && INLINE.has(getComputedStyle(e).display)) e = e.parentElement;
    return e;
  }

  const union = (rects) => {
    const r = rects.filter((q) => q.right > q.left && q.bottom > q.top);
    if (!r.length) return null;
    const x0 = Math.min(...r.map((q) => q.left)), y0 = Math.min(...r.map((q) => q.top));
    const x1 = Math.max(...r.map((q) => q.right)), y1 = Math.max(...r.map((q) => q.bottom));
    return { left: x0, top: y0, right: x1, bottom: y1 };
  };

  window.platformZonesMeasure = async function (doc = document) {
    await doc.fonts?.ready;
    const tags = [...new Set([...doc.querySelectorAll("*")].map((e) => e.localName).filter((t) => t.startsWith("insta-")))];
    await Promise.race([Promise.all(tags.map((t) => customElements.whenDefined(t))), wait(5000)]);
    // Storrito's components draw their stickers after they are defined: its own wait for them
    if (window.__instaRender) await Promise.race([window.__instaRender.waitForComponents(), wait(15000)]);
    await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    await wait(400);

    const root = frameOf(doc);
    // a page whose frame is the body (a still, a card): the window is the frame, whatever the
    // body's own box (0 px tall with only absolute children, shifted by its margin)
    const whole = root === doc.body || root === doc.documentElement;
    const R = whole ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : root.getBoundingClientRect();
    const sx = !whole && root.offsetWidth ? R.width / root.offsetWidth : 1;
    const at = (q) => [q.left - R.left, q.top - R.top, q.right - q.left, q.bottom - q.top].map((v) => Math.round(v / sx));
    const boxes = [];

    // text, block by block: the run of text of one block between two others is one box (a label
    // above a heading and a date below it are two); each line by its letters, not its line box
    const ctx = doc.createElement("canvas").getContext("2d");
    const ink = (n, el, rects) => {
      const s = getComputedStyle(el);
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const t = s.textTransform === "uppercase" ? n.nodeValue.toUpperCase() : n.nodeValue;
      const m = ctx.measureText(t.trim());
      const full = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      return [...rects].filter((q) => q.width > 0 && q.height > 0).map((q) => {
        const k = full ? q.height / full : 1;
        return { left: q.left, right: q.right, top: q.top + (m.fontBoundingBoxAscent - m.actualBoundingBoxAscent) * k, bottom: q.top + (m.fontBoundingBoxAscent + m.actualBoundingBoxDescent) * k };
      });
    };
    const runs = [];
    let last = null;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim() || !n.parentElement) continue;
      const el = n.parentElement;
      // a sticker's own words are the sticker's
      if (el.closest("script, style, noscript, template, svg, [data-zone=sticker]") || tags.some((t) => t !== "insta-story" && el.closest(t))) continue;
      if (!shown(el, root)) continue;
      const range = doc.createRange();
      range.selectNodeContents(n);
      const b = blockOf(el, root);
      if (!last || last.block !== b) runs.push((last = { block: b, rects: [], words: [] }));
      last.rects.push(...ink(n, el, range.getClientRects()));
      last.words.push(n.nodeValue);
    }
    for (const { block: b, rects, words } of runs) {
      const u = union(rects);
      if (!u) continue;
      // past an ancestor that hides what overflows it
      let clipped = false;
      for (let e = b; e && e !== root.parentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const c = e.getBoundingClientRect();
        if (u.left < c.left - 2 || u.right > c.right + 2 || u.top < c.top - 2 || u.bottom > c.bottom + 2) clipped = true;
        break;
      }
      const label = words.join(" ").replace(/\s+/g, " ").trim().slice(0, 60);
      const centred = getComputedStyle(b).textAlign === "center";
      boxes.push({ kind: "text", label, box: at(u), ...(centred ? { centred } : {}), ...(clipped ? { clipped: true } : {}) });
    }

    // stickers and faces
    for (const el of root.querySelectorAll("*")) {
      const sticker = (el.localName.startsWith("insta-") && el.localName !== "insta-story") || el.dataset.zone === "sticker";
      const face = el.dataset.zone === "face";
      if (!sticker && !face) continue;
      if (!shown(el, root)) continue;
      const q = el.getBoundingClientRect();
      const what = el.getAttribute("text") || el.getAttribute("question") || el.getAttribute("title") || el.getAttribute("hashtag") || el.getAttribute("username") || el.getAttribute("location") || el.dataset.label || (el.dataset.zone === "sticker" ? el.innerText : "") || "";
      const kind = el.localName.startsWith("insta-") ? el.localName.replace("insta-", "") : sticker ? "sticker" : "face";
      boxes.push({ kind: sticker ? "sticker" : "face", label: `${kind}${what ? `: ${what.replace(/\s+/g, " ").trim()}` : ""}`.slice(0, 60), box: at(q) });
    }
    return { size: [Math.round(R.width / sx), Math.round(R.height / sx)], story: root.localName === "insta-story", viewport: [innerWidth, innerHeight], boxes };
  };
})();
