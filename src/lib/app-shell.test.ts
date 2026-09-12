import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appRoot = path.join(projectRoot, "src", "app");

function read(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? cssFiles(target) : entry.name.endsWith(".css") ? [target] : [];
  });
}

function namedFiles(directory: string, name: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return namedFiles(target, name);
    return entry.name === name ? [target] : [];
  });
}

test("keeps the root document shell independent from request-only state", () => {
  const layout = read("src/app/layout.tsx");
  assert.doesNotMatch(layout, /next\/headers|next\/cookies|getCurrentUser|getEntryDrawerAnnouncement/);
  assert.match(layout, /RootRuntime/);
  assert.match(layout, /styles\/core\.css/);
});

test("loads migrated styles from the owning route family", () => {
  const owners = new Map([
    ["src/app/page.tsx", "home"],
    ["src/app/books/layout.tsx", "reader"],
    ["src/app/novels/layout.tsx", "catalog"],
    ["src/app/tags/layout.tsx", "catalog"],
    ["src/app/search/layout.tsx", "catalog"],
    ["src/app/media/layout.tsx", "media"],
    ["src/app/original/layout.tsx", "original"],
    ["src/app/(workspace)/account/layout.tsx", "account"],
    ["src/app/(workspace)/activity/layout.tsx", "account"],
    ["src/app/favorites/layout.tsx", "account"],
    ["src/app/(workspace)/settings/layout.tsx", "account"],
    ["src/app/announcements/layout.tsx", "station"],
    ["src/app/(workspace)/messages/layout.tsx", "station"],
    ["src/app/(workspace)/market/layout.tsx", "market"],
    ["src/app/login/layout.tsx", "auth"],
    ["src/app/register/layout.tsx", "auth"],
    ["src/app/verify-email/layout.tsx", "auth"],
    ["src/app/access-denied/layout.tsx", "auth"],
  ]);

  const workspaceLayout = read("src/app/(workspace)/layout.tsx");
  assert.match(workspaceLayout, /styles\/common\.css/);
  assert.match(workspaceLayout, /workspace\.css/);

  for (const [file, owner] of owners) {
    const source = read(file);
    assert.match(source, new RegExp(`styles/routes/${owner}\\.css`), `${file} must load ${owner} styles`);
  }
});

test("keeps authenticated workspace chrome in one persistent route group", () => {
  const layout = read("src/app/(workspace)/layout.tsx");
  assert.match(layout, /UserWorkspace/);
  assert.match(layout, /force-dynamic/);

  for (const page of [
    "src/app/(workspace)/account/page.tsx",
    "src/app/(workspace)/activity/page.tsx",
    "src/app/(workspace)/messages/page.tsx",
    "src/app/(workspace)/market/page.tsx",
    "src/app/(workspace)/settings/page.tsx",
    "src/app/(workspace)/original/mine/page.tsx",
  ]) {
    assert.doesNotMatch(read(page), /<UserWorkspace\b/, `${page} must render content only`);
  }

  const navigation = read("src/components/UserWorkspaceRouteState.tsx");
  assert.match(navigation, /AppLink/);
  assert.doesNotMatch(navigation, /\sprefetch\n/);
});

test("marks messages after navigation instead of during RSC prefetch", () => {
  const page = read("src/app/(workspace)/messages/page.tsx");
  assert.match(page, /MessageReadTracker/);
  assert.doesNotMatch(page, /markAllUserMessagesRead|markStationThreadRead/);
  assert.match(read("src/app/api/messages/read/route.ts"), /validateSameOriginMutation/);
});

test("keeps authenticated admin chrome in one persistent route group", () => {
  const panelRoot = path.join(appRoot, "admin", "(panel)");
  const layout = read("src/app/admin/(panel)/layout.tsx");
  const rootLayout = read("src/app/admin/layout.tsx");
  const frame = read("src/app/admin/(panel)/AdminFrame.tsx");
  const navigation = read("src/components/AdminNavigation.tsx");
  const adminStyles = read("src/app/styles/routes/admin.css");

  assert.match(layout, /AdminSidebarNavigation/);
  assert.match(layout, /AdminRouteTopbar/);
  assert.match(layout, /className="adminShell adminLayout"/);
  assert.match(layout, /getAdminSession/);
  assert.match(layout, /routes\/admin\.css/);
  assert.doesNotMatch(rootLayout, /routes\/admin\.css/);
  assert.match(read("src/app/admin/media/[id]/preview/layout.tsx"), /routes\/media\.css[\s\S]*routes\/admin\.css/);
  assert.match(read("src/app/admin/(panel)/station/layout.tsx"), /routes\/station\.css/);
  assert.match(read("src/app/admin/(panel)/tags/layout.tsx"), /routes\/catalog\.css/);
  assert.match(read("src/app/admin/(panel)/indexes/layout.tsx"), /routes\/catalog\.css/);
  assert.match(frame, /getAdminAccessState/);
  assert.match(frame, /getAdminSession/);
  assert.doesNotMatch(frame, /AdminSidebarNavigation|AdminRouteTopbar|countAdminUnreadMessages|<main\b/);
  assert.match(navigation, /usePathname/);
  assert.match(navigation, /router\.prefetch/);
  assert.match(navigation, /onPointerDown/);
  assert.doesNotMatch(adminStyles, /\.adminSideNav \.isActive::before/);
  assert.match(adminStyles, /\.adminSideNav \.isActive\s*\{[^}]*var\(--accent\) 7%/);
  assert.match(adminStyles, /\.adminShell \.adminUploadForm \.adminNovelUploadMode button\.isActive[\s\S]*var\(--accent\) 7%/);

  const framedPages = namedFiles(path.join(appRoot, "admin"), "page.tsx")
    .filter((file) => fs.readFileSync(file, "utf8").includes("<AdminFrame"));
  assert.equal(framedPages.length, 31);
  assert.ok(framedPages.every((file) => file.startsWith(panelRoot)));
});

test("removes the retired configurable settings preview", () => {
  assert.doesNotMatch(read("src/components/SettingsPanel.tsx"), /previewText|previewReader/);
  assert.doesNotMatch(read("src/app/admin/(panel)/settings/page.tsx"), /settingsPreviewText/);
  assert.doesNotMatch(read("src/app/styles/routes/account.css"), /previewReader/);
  // The retired keys no longer need a stripping pass: every field is read by name, so a
  // key this build does not know is simply never looked at.
  assert.doesNotMatch(read("src/core/config/site-settings-schema.ts"), /LEGACY_SETTING_KEYS|removeLegacySettings/);
});

test("reuses the public auth shell for the admin login", () => {
  const login = read("src/app/admin/login/page.tsx");
  assert.match(login, /className="userPanel authPanel"/);
  assert.match(login, /className="authPrimaryButton"/);
  assert.doesNotMatch(login, /adminLoginShell|adminLoginPanel|adminLoginForm/);
});

test("the reader tracks code fences by length, not by counting them", () => {
  const markdown = read("src/components/OriginalMarkdown.tsx");
  // A document that quotes a three-backtick block inside a four-backtick one has an odd
  // number of fence lines; a naive toggle left everything after it marked as code, and
  // every underline from there on was dropped as disallowed raw HTML.
  assert.match(markdown, /let fence: \{ marker: string; length: number \} \| null = null;/);
  assert.match(markdown, /length >= fence\.length && !run\[2\]\.trim\(\)/);
  assert.doesNotMatch(markdown, /inFence = !inFence/);
  assert.doesNotMatch(markdown, /==\(\[\^=/u, "`==` is no longer an underline marker");
});

test("administrators edit originals in the same composer everyone else uses", () => {
  assert.throws(() => read("src/components/OriginalEditorForm.tsx"), /ENOENT/,
    "the second, Markdown-only editor is gone");
  const adminArticle = read("src/app/admin/(panel)/original/[id]/page.tsx");
  assert.match(adminArticle, /href=\{`\/original\/\$\{article\.slug\}\/edit`\}/);
  assert.doesNotMatch(adminArticle, /OriginalEditorForm|updateOriginalArticleAdminAction/);
  assert.doesNotMatch(read("src/app/admin/original/actions.ts"), /updateOriginalArticleAsAdmin/);

  // Editing on someone's behalf is not authoring: the article keeps its author, the
  // administrator pays no fee, and their own uploads are usable alongside the author's.
  const editor = read("src/features/original-editor/server.ts");
  assert.match(editor, /let articleAuthorId = input\.author\.id;/);
  assert.match(editor, /if \(articleAuthorId !== input\.author\.id && !isAdmin\)/);
  assert.match(editor, /if \(!isAdmin\) \{\s*await updateBalancesForFee\(/);
  assert.match(editor, /updateAssets\(tx, \[articleAuthorId, input\.author\.id\]/);
  assert.match(read("src/app/api/original/drafts/route.ts"), /asAdmin: user\.role === "admin"/);
});

test("keeps the original composer toolbar pinned while only the document scrolls", () => {
  const composer = read("src/features/original-editor/OriginalComposerShell.tsx");
  const styles = read("src/features/original-editor/OriginalComposer.module.css");

  assert.match(composer, /<LexicalComposer[\s\S]*<header className=\{styles\.topBar\}>[\s\S]*<ComposerToolbar/);
  assert.match(composer, /className=\{styles\.statusBar\}/);
  // A full-height column: bars keep their height, and only the page between them scrolls.
  assert.match(styles, /\.shell\s*\{[\s\S]*display:\s*flex;[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*hidden;/);
  assert.match(styles, /\.topBar\s*\{[^}]*flex:\s*0 0 auto;/);
  assert.match(styles, /\.workspace\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /min-height:\s*var\(--action-height, 34px\)/);

  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 720px)"));
  assert.doesNotMatch(mobileStyles, /\.toolbar\s*\{[^}]*position:\s*fixed;/);
  assert.match(mobileStyles, /\.toolbar\s*\{[^}]*order: 4;/);
});

test("keeps settings and admin palettes on one dual-swatch picker", () => {
  const picker = read("src/components/PalettePicker.tsx");
  const settings = read("src/components/SettingsPanel.tsx");
  const admin = read("src/components/AdminPaletteField.tsx");
  const common = read("src/app/styles/common.css");
  const account = read("src/app/styles/routes/account.css");
  const adminCss = read("src/app/styles/routes/admin.css");

  assert.match(picker, /className="paletteSwatches"/);
  assert.match(picker, /palette\.lightAccent/);
  assert.match(picker, /palette\.darkAccent/);
  assert.match(settings, /<PalettePicker className="settingPalettePicker"/);
  assert.equal((settings.match(/segmentedControl settingCompactSegments/g) || []).length, 6);
  assert.doesNotMatch(settings, /settingToggleOnly/);
  assert.match(common, /\.segmentedControl\.settingCompactSegments button\.isActive\s*\{[^}]*color-mix\(in srgb, var\(--accent\) 9%/);
  assert.doesNotMatch(account, /settingCompactSegments/);
  assert.match(admin, /<PalettePicker name="defaultPalette"/);
  assert.match(common, /\.paletteSwatches\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*18px;/);
  assert.match(common, /\.palettePicker \.selectControl select\s*\{[\s\S]*min-height:\s*var\(--action-height\)/);
  assert.doesNotMatch(account, /paletteSwatches|settingPaletteRandomButton/);
  assert.doesNotMatch(adminCss, /adminPaletteSelectRow|adminPaletteDiceButton/);
});

test("keeps filled primary actions on the shared rectangular token", () => {
  const original = read("src/app/original.css");
  const station = read("src/app/styles/routes/station.css");
  const core = read("src/app/styles/core.css");

  assert.match(core, /--action-radius:\s*3px;/);
  // Filled controls take the palette fill for the theme with a white label.
  assert.match(core, /--accent-fill: var\(--palette-light-fill\);\s*--accent-fill-strong: var\(--palette-light-fill-strong\);\s*--accent-foreground: #fff;/);
  assert.match(core, /--accent-fill: var\(--palette-dark-fill\);\s*--accent-fill-strong: var\(--palette-dark-fill-strong\);\s*--accent-foreground: #fff;/);
  assert.match(core, /--action-font-size:\s*13px;/);
  // Filled actions are one component in core.css; page rules only add layout.
  const component = read("src/app/styles/components.css");
  assert.match(read("src/app/layout.tsx"), /import "\.\/styles\/core\.css";\s*import "\.\/styles\/components\.css";/);
  assert.match(component, /\.uiButton,[\s\S]*border-radius:\s*var\(--action-radius\)[\s\S]*font-size:\s*var\(--action-font-size\)/);
  assert.match(component, /\.originalPrimaryButton/);
  assert.match(component, /\.stationReplyForm\b[^{]*\) button/);
  assert.doesNotMatch(original, /\.originalPrimaryButton\s*\{[^}]*background:\s*var\(--accent-fill\)/);
  assert.doesNotMatch(station, /\.stationReplyForm button\s*\{[^}]*border-radius:\s*9px/);
});

test("keeps full editor serialization and long-source copies outside the keystroke hot path", () => {
  const composer = read("src/features/original-editor/OriginalComposerShell.tsx");
  const hotPath = composer.slice(
    composer.indexOf("const handleEditorState"),
    composer.indexOf("const handleEditorReady"),
  );
  const publishPath = composer.slice(composer.indexOf("async function publish()"));

  assert.match(hotPath, /scheduleEditorMetadata\(state\)/);
  assert.doesNotMatch(hotPath, /JSON\.stringify|setEditorJson/);
  assert.match(composer, /EDITOR_METADATA_DEBOUNCE_MS = 260/);
  assert.match(composer, /sourceUndoRef\.current\.slice\(-19\)/);
  assert.match(composer, /now - sourceHistoryAtRef\.current > 700/);
  assert.match(publishPath, /captureLatestEditorSnapshot\(\)/);
});

test("home width is independent of shared route CSS and next titles wrap from the start edge", () => {
  const common = read("src/app/styles/common.css");
  const home = read("src/app/styles/routes/home.css");
  assert.match(common, /\.appShell:not\(\.homePortalShell\) > :not\(\.siteHeader\)/);
  assert.doesNotMatch(common, /\.appShell > :not\(\.siteHeader\)/);
  assert.match(home, /\.homePortalShell > \.homePortalGrid\s*\{\s*width: min\(980px, 100%\);\s*margin-inline: auto;/);
  const nextTitleRules = [...common.matchAll(/\.readerNovelLink\.readerNovelNext \.readerNovelTitle\s*\{([^}]+)\}/g)];
  assert.equal(nextTitleRules.length, 2);
  for (const [, declarations] of nextTitleRules) {
    assert.match(declarations, /text-align: start;/);
    assert.doesNotMatch(declarations, /text-align: (end|right);/);
  }
  assert.match(common, /\.readerNovelLink\.readerNovelNext \.readerNovelTitle\s*\{[^}]*justify-self: end/);
  assert.match(common, /\.readerNovelNavigation\.isSingle > \.readerNovelNext \{ grid-column: 2; \}/);
  assert.match(read("src/app/original/[slug]/page.tsx"), /originalArticleNavigation\$\{Boolean\(displayPrevious\) !== Boolean\(displayNext\) \? " isSingle"/);
  assert.match(read("src/components/NovelReaderView.tsx"), /readerNovelNext[\s\S]*prefetch=\{false\} scroll/);
});

test("navigation keeps the current surface while loading and paged readers avoid route flashes", () => {
  const core = read("src/app/styles/core.css");
  assert.doesNotMatch(core, /@view-transition|view-transition-old|view-transition-new/);
  for (const file of [
    "src/app/(workspace)/loading.tsx",
    "src/app/admin/(panel)/loading.tsx",
    "src/app/books/[id]/loading.tsx",
    "src/app/novels/loading.tsx",
    "src/app/tags/loading.tsx",
    "src/app/original/loading.tsx",
    "src/app/media/loading.tsx",
    "src/app/original/[slug]/loading.tsx",
    "src/app/original/write/[draftId]/loading.tsx",
  ]) {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), false, `${file} must not flash a skeleton on navigation`);
  }
  const appLink = read("src/components/AppLink.tsx");
  assert.match(appLink, /prefetch=\{prefetch \?\? \(prefetchPolicy === "default"\)\}/);
  const primaryNavigation = read("src/components/HeaderPrimaryNav.tsx");
  assert.equal((primaryNavigation.match(/prefetchPolicy="default"/g) || []).length, 4);
  const trackedTagLink = read("src/components/TagTrackedLink.tsx");
  assert.doesNotMatch(trackedTagLink, /prefetch=\{false\}|prefetchPolicy="never"/);
  const userMenu = read("src/components/HeaderUserMenu.tsx");
  assert.match(userMenu, /hidden=\{!open\}/);
  assert.match(userMenu, /loading="eager"/);
  // The panel is laid out with `display: grid`, which outranks the user-agent rule for
  // [hidden]: without this the mounted-while-closed panel is permanently on screen.
  assert.match(read("src/app/styles/common.css"), /\.userMenuPanel\[hidden\]\s*\{\s*display: none;/);
  const nextConfig = read("next.config.ts");
  assert.match(nextConfig, /source: "\/avatars\/:path\*"[\s\S]*max-age=31536000, immutable/);
  const controls = read("src/components/ReaderExperienceControls.tsx");
  assert.doesNotMatch(controls, /上一页|下一页/);
  assert.doesNotMatch(controls, /href=\{(?:previous|next) \? [^}]+ : "#"\}/);
  assert.match(controls, /const previousLabel = "上一篇"/);
  assert.match(controls, /const nextLabel = "下一篇"/);
  assert.doesNotMatch(controls, /isTheme|日间|夜间/);
  assert.match(controls, /className="readerToolItem isMore"/);
  assert.match(read("src/components/SiteHeader.tsx"), /<ThemeToggle \/>/);
  assert.doesNotMatch(read("src/components/SiteHeader.tsx"), /!readerMode \? <ThemeToggle/);
  assert.doesNotMatch(read("src/components/OriginalReaderExperienceControls.tsx"), /isTheme|日间|夜间/);
  assert.match(read("src/components/ReaderDisplayPreferences.tsx"), /segmentedControl settingCompactSegments/);
  assert.match(read("src/app/admin/(panel)/original/page.tsx"), /AdminOriginalArticleActions/);
  assert.match(read("src/components/AdminOriginalArticleActions.tsx"), /deleteOriginalArticleAction/);
  const reader = read("src/components/NovelReaderView.tsx");
  const pageTurnController = read("src/components/ReaderPageTurnController.tsx");
  assert.match(reader, /previousContentBytes=\{previousContentBytes\}/);
  assert.match(reader, /nextContentBytes=\{nextContentBytes\}/);
  assert.match(pageTurnController, /shouldPrefetchReaderRoute/);
  assert.match(pageTurnController, /isReaderResumeNavigation/);
  assert.match(pageTurnController, /requestIdleCallback/);
  assert.match(pageTurnController, /prefetchAdjacent\(true\)/);
  assert.match(pageTurnController, /timeout: 500/);
  assert.match(read("src/components/ReadingHistoryList.tsx"), /scroll=\{false\}/);
  assert.match(read("src/components/NovelViewTracker.tsx"), /1_500/);
  assert.doesNotMatch(read("src/components/NovelViewTracker.tsx"), /IntersectionObserver/);
  assert.match(read("src/app/styles/routes/reader.css"), /data-reader-page-turn="instant"[^\n]*[\s\S]*readerChapterNavigation/);
  assert.doesNotMatch(read("src/app/styles/routes/reader.css"), /page-turn="slide"/, "the translate mode is retired");
  const readerCss = read("src/app/styles/routes/reader.css");
  assert.match(readerCss, /novelReaderShell > \.readerPage > \.readerTagsBlock/);
  assert.match(readerCss, /data-reader-tags="hidden"\] \.readerPage\.hasReaderPreferences \.readerTagsBlock/);
  const novelReader = read("src/components/NovelReaderView.tsx");
  assert.match(novelReader, /<ReaderTagLinks tags=\{tags\} library=\{library\} \/>/);
  assert.match(novelReader, /<ReaderTagLinks\s+tags=\{displayTags\}/);
  const navigationProgress = read("src/components/NavigationProgress.tsx");
  assert.match(navigationProgress, /requestAnimationFrame/);
  // The sweep bar is the only progress feedback. A busy cursor on top of it says the same
  // thing twice, and on Windows it is the spinner beside the pointer.
  assert.doesNotMatch(navigationProgress, /isNavigationPending/);
  assert.doesNotMatch(core, /cursor:\s*progress/);
  assert.match(core, /@keyframes navigationProgressSweep/);
  assert.match(core, /\.navigationProgress \{[^}]*height: 2px;/);
  const common = read("src/app/styles/common.css");
  assert.match(common, /\.readerToolRail[\s\S]*background: var\(--reader-paper\);[\s\S]*backdrop-filter: blur\(16px\)/);
  assert.match(common, /\.readerSidePanel\s*\{[\s\S]*width: min\(420px/);
  const originalControls = read("src/components/OriginalBrowseControls.tsx");
  const originalStyles = read("src/app/original.css");
  assert.match(originalControls, /<ArrowUpDown size=\{16\}/);
  assert.match(originalControls, /tr\("排序"\)/);
  assert.match(originalControls, /originalSearchToggle/);
  assert.match(originalControls, /收起搜索框/);
  assert.ok(originalControls.indexOf("originalSearchForm") < originalControls.indexOf("catalogMenuControl"));
  assert.match(originalStyles, /originalSearchForm\.isCollapsed/);
  assert.match(originalStyles, /originalSearchToggle/);
  assert.doesNotMatch(originalControls, /originalSearchToggle\$\{expanded/);
  assert.doesNotMatch(originalStyles, /originalSearchToggle\.isActive/);
  assert.match(originalStyles, /\.originalSearchForm\.isExpanded \.originalSearchToggle[\s\S]*background:\s*transparent/);
  assert.match(originalStyles, /\.pageContextBar\.hasMediaSearch \.pageContextActions \.originalSearchForm\.isExpanded\s*\{[^}]*width:\s*clamp\(118px, 31vw, 124px\);[^}]*flex:\s*0 0 clamp\(118px, 31vw, 124px\)/);
  assert.doesNotMatch(originalStyles, /grid-template-columns:\s*36px minmax\(0, 1fr\) 26px/);
  assert.match(common, /\.catalogMenuTrigger \{\r?\n  width: 30px;\r?\n  height: 30px;\r?\n  border: 0;\r?\n  border-radius: 6px;/);
  assert.match(common, /\.catalogMenuTrigger:hover,\r?\n\.catalogMenuTrigger:focus-visible \{/);
  assert.doesNotMatch(common, /\.catalogMenuTrigger:hover,\r?\n\.catalogMenuTrigger:focus-visible,\r?\n\.catalogMenuTrigger\.isActive/);
  assert.doesNotMatch(originalControls, /ListFilter|<Filter/);
  const originalComposer = read("src/components/OriginalCommentComposer.tsx");
  const originalArticlePage = read("src/app/original/[slug]/page.tsx");
  assert.match(originalComposer, /ReaderSidePanel/);
  assert.match(originalComposer, /kind="reply"/);
  assert.match(originalComposer, /originalCommentReplyButton/);
  assert.match(originalArticlePage, /originalCommentsHeading/);
  assert.ok(originalArticlePage.indexOf("OriginalCommentComposer") < originalArticlePage.indexOf("originalCommentList"));
  assert.match(originalStyles, /originalReaderShell \.originalDetailHeader \.originalDetailTitleLine/);
  assert.match(originalStyles, /readerSidePanel\.is-reply/);
  assert.doesNotMatch(originalStyles, /originalLoginHint/);
  const contentSearch = read("src/components/ContentSearchClient.tsx");
  assert.match(contentSearch, /<ResultCount count=\{totalNovels\}/);
  assert.match(contentSearch, /<Pagination page=\{page\} totalPages=\{totalPages\}/);
  // Every search now reports a real total, so results page like the rest of the site
  // instead of offering only the neighbouring page behind an opaque cursor.
  assert.doesNotMatch(contentSearch, /nextCursor|cursorsRef/);
  assert.doesNotMatch(contentSearch, /if \(loading \|\| nextPage/);
  const rootShell = read("src/lib/root-shell.ts");
  assert.match(rootShell, /process\.env\.DOCKER_BUILD === "1"/);
  assert.match(rootShell, /defaultSiteSettings\(\)/);
  assert.doesNotMatch(originalStyles, /readerSiteHeader\.hasMobileContext > \.brand/);
  assert.match(originalStyles, /readerSiteHeader \.mobileContextHeader\s*\{\s*align-self: center/);
  assert.doesNotMatch(originalStyles, /readerSiteHeader \.headerTools \{\s*display: none/);
  assert.match(common, /\.segmentedControl\.settingCompactSegments button \{/);
  assert.match(common, /\.readerMoreMenu \{/);
  assert.doesNotMatch(read("src/components/OriginalReaderExperienceControls.tsx"), /originalDesktopOutline|目录大纲/);
  assert.doesNotMatch(read("src/components/OriginalReaderExperienceControls.tsx"), /item\.index|index \+ 1/);
  assert.doesNotMatch(read("src/app/styles/routes/reader.css"), /\.readerSidePanel\.is-settings[\s\S]*width: 340px/);
  assert.match(read("src/app/styles/routes/catalog.css"), /\.catalogFilterPopover[\s\S]*min-width: 176px/);
  assert.match(read("src/components/SiteHeader.tsx"), /isStandardHeader/);
  assert.match(read("src/app/styles/core.css"), /--font-brand: "OpenAI Sans"/);
  assert.match(read("src/app/styles/core.css"), /\.brand\s*\{[\s\S]*color:\s*var\(--accent-text/);
  assert.match(read("src/app/styles/core.css"), /\.brand:hover,\s*\.brand:focus-visible\s*\{[^}]*color:\s*color-mix\(in oklab, var\(--accent-text/);
  assert.doesNotMatch(read("src/app/styles/core.css"), /\.brand:hover,[\s\S]*opacity: 0\.85/);
  // The composer is split by responsibility; its contract is checked across the modules.
  const composer = [
    "OriginalComposerShell.tsx",
    "ComposerToolbar.tsx",
    "ComposerOutline.tsx",
    "ComposerDialogs.tsx",
    "PublishDialog.tsx",
  ].map((name) => read(`src/features/original-editor/${name}`)).join("\n");
  assert.doesNotMatch(composer, /FloatingSelectionToolbarPlugin/);
  assert.doesNotMatch(composer, /serverTimer/);
  // The writing toolbar is one flat row of exactly the commands long-form fiction
  // needs, each an icon over its name. Lists, inline code and sub-heading levels stay
  // supported as Markdown syntax but do not earn a permanent button; 目录 belongs with
  // 设置 in the top bar. Text formats are declared in TEXT_FORMAT_BUTTONS.
  for (const label of ["撤销", "重做", "清除格式", "加粗", "斜体", "下划线", "删除线", "章节", "引用", "链接", "分割线", "付费分界"]) {
    assert.ok(
      composer.includes(`label="${label}"`) || composer.includes(`label: "${label}"`),
      `toolbar is missing ${label}`,
    );
  }
  const desktopToolbar = composer.slice(composer.indexOf("styles.desktopToolbar"), composer.indexOf("styles.mobileToolbar"));
  assert.doesNotMatch(desktopToolbar, /label="(无序列表|有序列表|行内代码|小节标题|正文|目录)"/);
  assert.doesNotMatch(desktopToolbar, /toolGroup|toolDivider|toolSpacer/);
  assert.match(composer, /\{children\}\s*<span>\{label\}<\/span>/);
  assert.match(composer, /styles\.outlineButton[\s\S]*aria-label="目录"/);
  assert.match(composer, /<Eraser size=\{18\}/);
  // One click turns a format on and the next turns it off. There is no double-click
  // lock: it made a quick second click do something different from a slow one.
  assert.doesNotMatch(composer, /clickTimerRef|event\.detail|toolLocked|lockTextFormat|KEY_ESCAPE_COMMAND|formatLockToggle|MOBILE_LOCKABLE_FORMATS/);
  assert.doesNotMatch(read("src/features/original-editor/editor-commands.ts"), /LockedFormats/);
  // Word count, outline and the paid-boundary flag are debounced, never deferred again
  // to requestIdleCallback: a writer who does not pause — or a throttled tab — was left
  // looking at numbers and a paid state that belonged to an older draft.
  assert.doesNotMatch(composer, /requestIdleCallback\(/);
  assert.match(composer, /flushEditorMetadata/);
  assert.doesNotMatch(composer, /styles\.primaryButton.*发布/);
  assert.match(composer, /styles\.topPublishButton/);
  assert.match(composer, /styles\.bottomPublishButton/);
  assert.match(composer, /topBarActions[\s\S]*previewButton[\s\S]*outlineButton/);
  assert.match(composer, /statusActions[\s\S]*wordCount[\s\S]*bottomPublishButton/);
  assert.match(composer, /<Settings2 size=\{15\}[\s\S]*<span>设置<\/span>/);
  assert.doesNotMatch(composer, /styles\.modeSegmented|styles\.modeSegmentButton/);
  assert.match(composer, /readerShell originalReaderShell[\s\S]*readerPage originalDetail[\s\S]*originalDetailIdentity[\s\S]*readerText originalBody/);
  assert.match(composer, /paidGateHint/);
  assert.match(composer, /在正文插入付费分界/);
  assert.match(composer, /!preview \? <header className=\{styles\.topBar\}/);
  assert.match(composer, /!preview \? <footer className=\{styles\.statusBar\}/);
  // Saving is manual only: the save button and Ctrl+S. Nothing writes in the
  // background, and leaving with unsaved edits asks whether to keep them.
  assert.doesNotMatch(composer, /AUTOSAVE|autosaveTimers|scheduleAutosave|addEventListener\("online"/);
  // The save status is itself the save control; there is no second save button.
  assert.match(composer, /className=\{styles\.saveStatus\}[\s\S]*onClick=\{\(\) => void manualSave\(\)\}/);
  assert.doesNotMatch(composer, /styles\.saveButton/);
  assert.match(composer, /key === "s"/);
  assert.match(composer, /function UnsavedChangesDialog/);
  assert.match(composer, /保存为草稿？/);
  assert.doesNotMatch(composer, /local-draft|恢复本机草稿|ComposerConfirmDialog/);
  assert.equal(fs.existsSync(path.join(projectRoot, "src/features/original-editor/local-draft.ts")), false);
  // The unload guard replaced a history trap that pushed a duplicate entry on mount and
  // called history.back() again from its own popstate handler, so one Back press
  // consumed two entries.
  assert.doesNotMatch(composer, /originalComposerGuard|"popstate"/);
  assert.match(composer, /addEventListener\("beforeunload"/);
  assert.doesNotMatch(composer, /ImagePlus|ImagePastePlugin|uploadImage|图片已插入|ComposerPromptDialog|pendingImage|图片替代文本/);
  // Markdown shortcuts are Lexical's own engine over the project's transformer list —
  // there is no second, hand-rolled scanner. The previous one called editor.update()
  // from inside an update listener, which merged the following keystrokes into a
  // tagged update; Lexical's engine then saw the caret jump two offsets at once and
  // skipped the transform, so block syntax never rendered and lists never continued.
  const shortcutPlugins = read("src/features/original-editor/plugins.tsx");
  assert.match(shortcutPlugins, /MarkdownShortcutPlugin transformers=\{ORIGINAL_MARKDOWN_TRANSFORMERS\}/);
  assert.doesNotMatch(composer, /buffered-markdown|commitBufferedMarkdown/);
  const imageNode = read("src/features/original-editor/nodes/OriginalImageNode.tsx");
  assert.match(imageNode, /document\.createElement\("div"\)/);
  assert.match(imageNode, /isInline\(\): false/);
  const assetRoute = read("src/app/original/assets/[id]/route.ts");
  assert.match(assetRoute, /purchase\.buyer_id = \$2/);
  assert.doesNotMatch(assetRoute, /purchase\.user_id/);
  const composerCss = read("src/features/original-editor/OriginalComposer.module.css");
  assert.match(composerCss, /\.publishButton\s*\{\s*composes: uiButton isPrimary from global;/);
  assert.match(composerCss, /\.publishDialog\s*\{[\s\S]*grid-template-rows: auto auto auto[\s\S]*align-content: start/);
  assert.match(composerCss, /\.publishDialog\s*\{[\s\S]*max-width: 100vw/);
  assert.match(composerCss, /\.publishDialogBody\s*\{[\s\S]*overflow-y: auto/);
  assert.match(composerCss, /scrollbar-gutter: stable/);
  assert.match(composerCss, /\.publishDialog:not\(\[open\]\)\s*\{\s*display: none/);
  assert.match(composerCss, /\.publishTypePicker\s*\{[\s\S]*border-radius:\s*999px/);
  assert.match(composerCss, /\.publishTypeOptionActive\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--composer-accent\) 9%/);
  assert.doesNotMatch(composer, /open && hasPaidGate && price === 0/);
  assert.doesNotMatch(composer, /titleCounter|original-title-limit/);
  assert.match(composer, /DismissibleNotice message=\{errorMessage\} tone="error"/);
  assert.match(composerCss, /\.priceControl input\s*\{[\s\S]*color:\s*var\(--text/);
  assert.match(composerCss, /\.tagPickerButton\s*\{[\s\S]*top:\s*50%/);
  assert.match(composerCss, /\.dialog\.publishDialog:has\(\.tagDrawerBackdrop\)\s*\{[^}]*height:\s*min\(620px/);
  assert.match(composerCss, /\.tagPicker\s*\{[^}]*height:\s*min\(520px, calc\(100% - 16px\)\)/);
  assert.match(composer, /<label htmlFor="publish-soda-price"/);
  assert.doesNotMatch(composer, /<label className=\{styles\.fieldLabel\}>\s*<span>价格<\/span>/);
  assert.doesNotMatch(composer, /所有读者可直接阅读|读者解锁后阅读/);
  assert.match(composer, /onCreateTag/);
  assert.match(composer, /输入标签，回车添加/);
  assert.match(composer, /aria-label="选择已有标签"/);
  assert.match(composerCss, /\.tagComposer\s*\{/);
  assert.match(composerCss, /\.tagPicker\s*\{[\s\S]*position:\s*(?:static|relative)/);
  assert.match(composer, /<Tags size=\{17\}/);
  assert.match(composer, /className="tagChip contentTagLink"/);
  assert.match(composer, /aria-label=\{`取消标签 \$\{tag\.name\}`\}/);
  assert.doesNotMatch(composerCss, /\.tagSuggestions\s*\{/);
  assert.match(composerCss, /\.tagSelection :global\(\.tagChip\) \{ cursor: pointer; \}/);
  assert.doesNotMatch(composerCss, /\.tagSelection :global\(\.tagChip\) \{[^}]*padding/);
  assert.match(read("src/components/TagIntersectionSearchForm.tsx"), /tagChip contentTagLink advancedTagOption/);
  assert.doesNotMatch(composer, /window\.(prompt|confirm)/);
  assert.match(read("src/app/api/original/tags/route.ts"), /export async function GET/);
  assert.match(read("src/features/original-editor/server.ts"), /listOriginalEditorTagsByIds/);
  // The paid boundary is a thin labelled rule in the flow of the text. Like every
  // non-text block it is selected by one click, so Backspace, Delete and the arrow keys
  // can act on it instead of the caret having nowhere to go.
  assert.match(composerCss, /\.paidGateMarker\s*\{[\s\S]*display: flex;/);
  assert.match(composerCss, /\.paidGateRemove\s*\{/);
  assert.match(composerCss, /\.blockSelected\s*\{/);
  assert.match(read("src/features/original-editor/nodes/PaidGateNode.tsx"), /useBlockSelection/);
  assert.match(read("src/features/original-editor/nodes/DividerNode.tsx"), /useBlockSelection/);
  assert.match(shortcutPlugins, /<BlockNavigationPlugin|registerBlockNavigation/);
  assert.match(composer, /<BlockNavigationPlugin \/>/);
  // Manuscript typography: 16px / 1.67 with a 1.4em paragraph gap.
  assert.match(composerCss, /\.contentEditable\s*\{[^}]*font: 400 16px \/ 1\.67/);
  assert.match(composerCss, /\.editorParagraph\s*\{ margin: 0 0 1\.4em;/);
  assert.match(read("src/app/styles/core.css"), /--original-font-size: 16px;[\s\S]*--original-line-height: 1\.6;/);
  assert.match(originalStyles, /width: min\(690px, calc\(100vw - 40px\)\)/);
  assert.match(originalStyles, /originalMarkdownParagraph \+ \.originalMarkdownParagraph[\s\S]*1\.4em/);
  assert.match(originalStyles, /font-size: 1\.2em;/);
  assert.doesNotMatch(originalStyles, /originalReaderShell \.originalBody \{ font-size: 17px/);
  const minePage = read("src/app/(workspace)/original/mine/page.tsx");
  assert.match(minePage, /<OriginalDraftManager/);
  assert.match(read("src/components/OriginalDraftManager.tsx"), /!managing \? <span className="originalDraftEditAction">\{tr\("编辑"\)\}/);
  assert.doesNotMatch(minePage, /继续编辑/);
  assert.match(originalStyles, /\.originalDraftEditAction\s*\{/);
  assert.doesNotMatch(originalStyles, /\.originalDraftItem\.isSelected\s*\{/);
  assert.doesNotMatch(read("src/app/styles/routes/account.css"), /\.readingHistoryItem\.isSelected\s*\{/);
});

test("does not restore the historical global cascade or exceed its migration budget", () => {
  assert.equal(fs.existsSync(path.join(appRoot, "globals.css")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "ui-final.css")), false);
  const migrated = cssFiles(path.join(appRoot, "styles"));
  const bytes = migrated.reduce((total, file) => total + fs.statSync(file).size, 0);
  assert.ok(bytes <= 500 * 1024, `migrated route CSS is ${bytes} bytes`);
  assert.ok(fs.statSync(path.join(appRoot, "styles", "core.css")).size <= 24 * 1024);
  assert.ok(fs.statSync(path.join(appRoot, "styles", "common.css")).size <= 120 * 1024);
});
