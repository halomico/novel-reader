export function ThemeScript({
  defaultTheme = "system",
  defaultFontSize = 17,
}: {
  defaultTheme?: "system" | "light" | "dark";
  defaultFontSize?: number;
}) {
  const code = `
    (function () {
      try {
        var theme = localStorage.getItem("novel-theme") || ${JSON.stringify(defaultTheme)};
        var uiMode = localStorage.getItem("novel-ui-mode") || "standard";
        var fontSize = Number(localStorage.getItem("novel-font-size") || ${JSON.stringify(defaultFontSize)});
        if (!Number.isFinite(fontSize) || fontSize < 5 || fontSize > 50) {
          fontSize = ${JSON.stringify(defaultFontSize)};
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
