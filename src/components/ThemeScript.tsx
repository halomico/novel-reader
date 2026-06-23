export function ThemeScript() {
  const code = `
    (function () {
      try {
        var theme = localStorage.getItem("novel-theme") || "system";
        var uiMode = localStorage.getItem("novel-ui-mode") || "standard";
        var fontSize = Number(localStorage.getItem("novel-font-size") || "19");
        if (!Number.isFinite(fontSize) || fontSize < 5 || fontSize > 50) {
          fontSize = 19;
        }
        if (theme === "light" || theme === "dark") {
          document.documentElement.dataset.theme = theme;
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
        document.documentElement.dataset.uiMode = uiMode === "minimal" ? "minimal" : "standard";
        document.documentElement.style.setProperty("--reader-font-size", fontSize + "px");
      } catch (error) {}
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
