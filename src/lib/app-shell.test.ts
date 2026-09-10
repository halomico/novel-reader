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
  assert.match(navigation, /prefetch/);
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

  const framedPages = namedFiles(path.join(appRoot, "admin"), "page.tsx")
    .filter((file) => fs.readFileSync(file, "utf8").includes("<AdminFrame"));
  assert.equal(framedPages.length, 31);
  assert.ok(framedPages.every((file) => file.startsWith(panelRoot)));
});

test("removes the retired configurable settings preview", () => {
  assert.doesNotMatch(read("src/components/SettingsPanel.tsx"), /previewText|previewReader/);
  assert.doesNotMatch(read("src/app/admin/(panel)/settings/page.tsx"), /settingsPreviewText/);
  assert.doesNotMatch(read("src/app/styles/routes/account.css"), /previewReader/);
  assert.match(read("src/core/config/site-settings-schema.ts"), /LEGACY_SETTING_KEYS[\s\S]*"settingsPreviewText"/);
});

test("reuses the public auth shell for the admin login", () => {
  const login = read("src/app/admin/login/page.tsx");
  assert.match(login, /className="userPanel authPanel"/);
  assert.match(login, /className="authPrimaryButton"/);
  assert.doesNotMatch(login, /adminLoginShell|adminLoginPanel|adminLoginForm/);
});

test("keeps the original composer toolbar pinned while only the document scrolls", () => {
  const composer = read("src/features/original-editor/OriginalComposerShell.tsx");
  const styles = read("src/features/original-editor/OriginalComposer.module.css");

  assert.match(composer, /<LexicalComposer[\s\S]*<header className=\{styles\.topBar\}>[\s\S]*<ComposerToolbar/);
  assert.match(composer, /className=\{styles\.statusBar\}/);
  assert.match(styles, /\.shell\s*\{[\s\S]*height:\s*100dvh;[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.topBar\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
  assert.match(styles, /\.workspace\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /min-height:\s*var\(--action-height, 34px\)/);

  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 720px)"));
  assert.doesNotMatch(mobileStyles, /\.toolbar\s*\{[^}]*position:\s*fixed;/);
  assert.match(mobileStyles, /\.toolbar\s*\{[\s\S]*grid-row: 4[\s\S]*flex-wrap: nowrap/);
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

  assert.match(core, /--action-radius:\s*4px;/);
  assert.match(core, /--action-font-size:\s*13px;/);
  assert.match(original, /\.originalPrimaryButton\s*\{[\s\S]*border-radius:\s*var\(--action-radius\)/);
  assert.match(original, /\.originalPrimaryButton\s*\{[\s\S]*font-size:\s*var\(--action-font-size\)/);
  assert.match(station, /\.stationReplyForm button\s*\{[\s\S]*border-radius:\s*var\(--action-radius\)/);
  assert.match(station, /\.stationReplyForm button\s*\{[\s\S]*font-size:\s*var\(--action-font-size\)/);
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
  const controls = read("src/components/ReaderExperienceControls.tsx");
  assert.doesNotMatch(controls, /上一页|下一页/);
  assert.doesNotMatch(controls, /href=\{(?:previous|next) \? [^}]+ : "#"\}/);
  assert.match(controls, /const previousLabel = "上一篇"/);
  assert.match(controls, /const nextLabel = "下一篇"/);
  const reader = read("src/components/NovelReaderView.tsx");
  const pageTurnController = read("src/components/ReaderPageTurnController.tsx");
  assert.match(reader, /previousContentBytes=\{previousContentBytes\}/);
  assert.match(reader, /nextContentBytes=\{nextContentBytes\}/);
  assert.match(pageTurnController, /shouldPrefetchReaderRoute/);
  assert.match(pageTurnController, /requestIdleCallback/);
  assert.match(pageTurnController, /prefetchAdjacent\(true\)/);
  assert.match(pageTurnController, /timeout: 500/);
  assert.match(read("src/app/styles/routes/reader.css"), /data-reader-page-turn="slide"[^\n]*[\s\S]*readerChapterNavigation/);
  const navigationProgress = read("src/components/NavigationProgress.tsx");
  assert.match(navigationProgress, /SHOW_DELAY_MS = 120/);
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
  assert.doesNotMatch(contentSearch, /nextCursor|cursorTrail|pageHistory/);
  assert.doesNotMatch(originalStyles, /readerSiteHeader\.hasMobileContext > \.brand/);
  assert.match(originalStyles, /readerSiteHeader \.mobileContextHeader\s*\{\s*align-self: center/);
  assert.doesNotMatch(read("src/components/OriginalReaderExperienceControls.tsx"), /originalDesktopOutline|目录大纲/);
  assert.doesNotMatch(read("src/components/OriginalReaderExperienceControls.tsx"), /item\.index|index \+ 1/);
  assert.doesNotMatch(read("src/app/styles/routes/reader.css"), /\.readerSidePanel\.is-settings[\s\S]*width: 340px/);
  assert.match(read("src/app/styles/routes/catalog.css"), /\.catalogFilterPopover[\s\S]*min-width: 176px/);
  assert.match(read("src/components/SiteHeader.tsx"), /isStandardHeader/);
  assert.match(read("src/app/styles/core.css"), /--font-brand: "OpenAI Sans"/);
  assert.match(read("src/app/styles/core.css"), /\.brand:hover,[\s\S]*color-mix\(in srgb, var\(--accent-text/);
  assert.doesNotMatch(read("src/app/styles/core.css"), /\.brand:hover,[\s\S]*opacity: 0\.85/);
  const composer = read("src/features/original-editor/OriginalComposerShell.tsx");
  assert.doesNotMatch(composer, /FloatingSelectionToolbarPlugin/);
  assert.doesNotMatch(composer, /serverTimer/);
  // The writing toolbar is one flat row of exactly the commands long-form fiction
  // needs. Lists, inline code and sub-heading levels stay supported as Markdown
  // syntax but do not earn a permanent button; 目录 belongs with 设置 in the top bar.
  // Lockable formats are declared through `formatButton`, so both spellings count.
  for (const label of ["撤销", "重做", "清除格式", "加粗", "斜体", "下划线", "删除线", "章节标题", "引用", "链接", "分隔线", "付费分界"]) {
    assert.ok(
      composer.includes(`label="${label}"`) || composer.includes(`, "${label}",`),
      `toolbar is missing ${label}`,
    );
  }
  const desktopToolbar = composer.slice(composer.indexOf("styles.desktopToolbar"), composer.indexOf("styles.mobileToolbar"));
  assert.doesNotMatch(desktopToolbar, /label="(无序列表|有序列表|行内代码|小节标题|正文|目录)"/);
  assert.doesNotMatch(desktopToolbar, /toolGroup|toolDivider|toolSpacer/);
  // Icon-only buttons must say what they are; the attribute existed but nothing drew it.
  assert.match(composer, /data-tooltip=\{hint \? `\$\{label\} · \$\{hint\}` : label\}/);
  assert.match(
    read("src/features/original-editor/OriginalComposer.module.css"),
    /\.toolbar button\[data-tooltip\]::after[\s\S]*content: attr\(data-tooltip\)/,
  );
  assert.match(composer, /styles\.outlineButton[\s\S]*aria-label="目录"/);
  assert.match(composer, /<Eraser size=\{18\}/);
  // A single click must act at once. Waiting out a double-click timer made every
  // format land a third of a second late; the pair is read from `event.detail`.
  assert.doesNotMatch(composer, /clickTimerRef/);
  assert.match(composer, /event\.detail >= 2/);
  assert.match(composer, /toolLocked/);
  // Escape releases a format lock without editing a character of the draft, and the
  // lock is reachable without a double click on a touch screen.
  assert.match(composer, /KEY_ESCAPE_COMMAND/);
  // Word count, outline and the paid-boundary flag are debounced, never deferred again
  // to requestIdleCallback: a writer who does not pause — or a throttled tab — was left
  // looking at numbers and a paid state that belonged to an older draft.
  assert.doesNotMatch(composer, /requestIdleCallback\(/);
  assert.match(composer, /flushEditorMetadata/);
  assert.match(composer, /MOBILE_LOCKABLE_FORMATS/);
  assert.match(composer, /formatLockToggle/);
  assert.doesNotMatch(composer, /styles\.primaryButton.*发布/);
  assert.match(composer, /styles\.topPublishButton/);
  assert.match(composer, /styles\.bottomPublishButton/);
  assert.match(composer, /<Settings2 size=\{17\}[\s\S]*<span>设置<\/span>/);
  assert.doesNotMatch(composer, /styles\.modeSegmented|styles\.modeSegmentButton/);
  assert.match(composer, /readerShell originalReaderShell[\s\S]*readerPage originalDetail[\s\S]*originalDetailIdentity[\s\S]*readerText originalBody/);
  assert.match(composer, /paidGateHint/);
  assert.match(composer, /在正文插入付费分界/);
  assert.match(composer, /!preview \? <header className=\{styles\.topBar\}/);
  assert.match(composer, /!preview \? <footer className=\{styles\.statusBar\}/);
  // No timed server autosave and no online-retry listener: saving to the server stays
  // an explicit action. Unsaved work is instead protected by a local recovery copy and
  // the unload guard, which replaced the history trap the composer used to install.
  // That trap pushed a duplicate entry on mount and called history.back() again from
  // its own popstate handler, so one Back press consumed two entries and left the dead
  // /original/write/<id> URL behind for the exit replace to skip past.
  assert.doesNotMatch(composer, /AUTOSAVE_DEBOUNCE_MS|addEventListener\("online"/);
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
  assert.match(composerCss, /\.publishButton[\s\S]*var\(--composer-accent/);
  assert.match(composerCss, /\.publishDialog\s*\{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(composerCss, /\.publishDialog\s*\{[\s\S]*max-width: 100vw/);
  assert.match(composerCss, /\.publishDialogBody\s*\{[\s\S]*overflow-y: auto/);
  assert.match(composerCss, /scrollbar-gutter: stable/);
  assert.match(composerCss, /\.publishDialog:not\(\[open\]\)\s*\{\s*display: none/);
  assert.match(composerCss, /\.publishTypeOptionActive/);
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
  assert.doesNotMatch(composer, /window\.(prompt|confirm)/);
  assert.match(read("src/app/api/original/tags/route.ts"), /export async function GET/);
  assert.match(read("src/features/original-editor/server.ts"), /listOriginalEditorTagsByIds/);
  // The boundary the writer places and the gate the reader meets are one feature seen
  // at two moments, so the editing card borrows the reader gate's card shape rather
  // than being a bare rule across the page.
  assert.match(composerCss, /\.paidGateCard\s*\{[\s\S]*border-radius: 9px;[\s\S]*justify-items: center/);
  assert.match(composerCss, /\.paidGateRemove\s*\{/);
  assert.match(composerCss, /\.editorParagraph\s*\{ margin: 0 0 1em;/);
  assert.match(read("src/app/styles/core.css"), /--original-font-size: 17px;[\s\S]*--original-line-height: 1\.7;/);
  assert.match(originalStyles, /originalMarkdownParagraph \+ \.originalMarkdownParagraph[\s\S]*1em/);
  const minePage = read("src/app/(workspace)/original/mine/page.tsx");
  assert.match(minePage, /className="originalDraftEditAction">\{tr\("编辑"\)\}/);
  assert.doesNotMatch(minePage, /继续编辑/);
  assert.match(originalStyles, /\.originalDraftEditAction\s*\{/);
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
