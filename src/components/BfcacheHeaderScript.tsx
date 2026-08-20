const code = String.raw`
(() => {
  const selector = "[data-bfcache-header-snapshot]";
  let removeFrame = 0;
  let removeTimer = 0;

  const removeSnapshot = () => {
    document.querySelectorAll(selector).forEach((snapshot) => snapshot.remove());
  };

  const preserveStickyHeader = () => {
    if (removeFrame) cancelAnimationFrame(removeFrame);
    if (removeTimer) clearTimeout(removeTimer);
    removeFrame = 0;
    removeTimer = 0;
    removeSnapshot();
    if (!matchMedia("(max-width: 820px)").matches) return;

    const header = document.querySelector(
      ".siteHeader:not(.readerSiteHeader):not([data-bfcache-header-snapshot])",
    );
    if (!header) return;

    const bounds = header.getBoundingClientRect();
    if (
      getComputedStyle(header).position !== "sticky" ||
      scrollY <= 0 ||
      Math.abs(bounds.top) > 1 ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) return;

    const snapshot = header.cloneNode(true);
    snapshot.dataset.bfcacheHeaderSnapshot = "true";
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.setAttribute("inert", "");
    snapshot.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    snapshot.style.setProperty("position", "absolute", "important");
    snapshot.style.setProperty("top", scrollY + bounds.top + "px", "important");
    snapshot.style.setProperty("left", scrollX + bounds.left + "px", "important");
    snapshot.style.setProperty("width", bounds.width + "px", "important");
    snapshot.style.setProperty("height", bounds.height + "px", "important");
    snapshot.style.setProperty("margin", "0", "important");
    snapshot.style.setProperty("z-index", "19", "important");
    document.body.append(snapshot);
  };

  addEventListener("pagehide", preserveStickyHeader);
  addEventListener("pageshow", (event) => {
    if (!event.persisted) {
      removeSnapshot();
      return;
    }
    removeFrame = requestAnimationFrame(() => {
      removeFrame = 0;
      removeTimer = setTimeout(() => {
        removeTimer = 0;
        removeSnapshot();
      }, 240);
    });
  });
})();
`;

export function BfcacheHeaderScript() {
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
