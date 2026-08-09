export const DEFAULT_LOCALE = "zh-Hans";
export const TRADITIONAL_LOCALE = "zh-Hant";
export const LOCALE_COOKIE = "novel-locale";
export const LOCALE_REQUEST_HEADER = "x-novel-locale";
export const TRADITIONAL_PATH_PREFIX = "/zh-hant";

export type AppLocale = typeof DEFAULT_LOCALE | typeof TRADITIONAL_LOCALE;

const UNPREFIXED_PATHS = [
  "/admin",
  "/api",
  "/media-file",
  "/site-icon",
  "/sitemap",
  "/robots.txt",
  "/favicon.ico",
  "/_next",
] as const;

const TRADITIONAL_UI_TEXT: Readonly<Record<string, string>> = {
  "首页": "首頁",
  "小说": "小說",
  "标签": "標籤",
  "视频": "視頻",
  "音频": "音頻",
  "文件": "文件",
  "资源": "資源",
  "名称": "名稱",
  "大小": "大小",
  "时长": "時長",
  "文件夹": "資料夾",
  "未知作者": "未知作者",
  "搜索视频": "搜尋視頻",
  "搜索标题、作者或目录": "搜尋標題、作者或目錄",
  "搜索文件或目录": "搜尋文件或目錄",
  "清除资源搜索": "清除資源搜尋",
  "清除搜索": "清除搜尋",
  "搜索资源": "搜尋資源",
  "视频分类": "視頻分類",
  "视频标签": "視頻標籤",
  "按标签浏览站内视频。": "按標籤瀏覽站內視頻。",
  "标签与简介": "標籤與簡介",
  "筛选与排序": "篩選與排序",
  "排序": "排序",
  "播放量": "播放量",
  "全部标签": "全部標籤",
  "不限标签": "不限標籤",
  "全部": "全部",
  "没有找到匹配的资源。": "沒有找到符合的資源。",
  "暂无视频。": "暫無視頻。",
  "当前文件夹暂无资源。": "目前資料夾暫無資源。",
  "项": "項",
  "个文件夹": "個資料夾",
  "项资源": "項資源",
  "资源不存在": "資源不存在",
  "视频信息": "視頻資訊",
  "作者与简介": "作者與簡介",
  "未标注作者": "未標示作者",
  "作者": "作者",
  "没有找到匹配的标签。": "沒有找到符合的標籤。",
  "个视频": "個視頻",
  "个": "個",
  "位": "位",
  "视频操作": "視頻操作",
  "下载文件": "下載文件",
  "更多视频": "更多視頻",
  "播完暂停": "播完暫停",
  "自动连播": "自動連播",
  "单曲循环": "單曲循環",
  "播放": "播放",
  "当前浏览器无法播放这个音频。": "目前瀏覽器無法播放這個音頻。",
  "切换音频": "切換音頻",
  "上一首": "上一首",
  "下一首": "下一首",
  "播放模式": "播放模式",
  "同目录音频": "同目錄音頻",
  "首": "首",
  "公告": "公告",
  "站点公告与更新。": "站點公告與更新。",
  "暂无公告": "暫無公告",
  "公告不存在": "公告不存在",
  "随便看看": "隨便看看",
  "登录后可用": "登入後可用",
  "返回首页": "返回首頁",
  "前往小说": "前往小說",
  "导航菜单": "導覽選單",
  "消息": "訊息",
  "消息分类": "訊息分類",
  "站务": "站務",
  "处理中": "處理中",
  "已结束": "已結束",
  "回复": "回覆",
  "补充说明": "補充說明",
  "发送": "傳送",
  "联系": "聯絡",
  "主题": "主題",
  "内容": "內容",
  "设置": "設定",
  "登录": "登入",
  "注册": "註冊",
  "用户名": "使用者名稱",
  "密码": "密碼",
  "确认密码": "確認密碼",
  "显示名称": "顯示名稱",
  "可留空，默认使用用户名": "可留空，預設使用使用者名稱",
  "保持登录状态": "保持登入狀態",
  "登录暂未开放。": "登入暫未開放。",
  "注册暂未开放。": "註冊暫未開放。",
  "还没有账号？": "還沒有帳號？",
  "去注册": "去註冊",
  "已有账号？": "已有帳號？",
  "去登录": "去登入",
  "退出": "登出",
  "成长": "成長",
  "动态": "動態",
  "最近": "最近",
  "收藏": "收藏",
  "账户": "帳戶",
  "用户中心": "使用者中心",
  "资料": "資料",
  "保存": "儲存",
  "安全": "安全",
  "更新后，其他登录状态会自动失效。": "更新後，其他登入狀態會自動失效。",
  "当前密码": "目前密碼",
  "新密码": "新密碼",
  "更新": "更新",
  "苏打": "蘇打",
  "等级进度": "等級進度",
  "累计成长": "累計成長",
  "已达最高等级": "已達最高等級",
  "当前等级权限": "目前等級權限",
  "今日已签到": "今日已簽到",
  "每日签到": "每日簽到",
  "获得": "獲得",
  "今日份惊喜等你开启": "今天的驚喜等你開啟",
  "试试手气": "試試手氣",
  "已签到": "已簽到",
  "苏打记录": "蘇打記錄",
  "上传中": "上傳中",
  "上传头像": "上傳頭像",
  "查看今日排行榜": "查看今日排行榜",
  "今日排行榜": "今日排行榜",
  "今日苏打榜": "今日蘇打榜",
  "今日获得": "今日獲得",
  "今日尚未签到": "今日尚未簽到",
  "正在读取": "正在讀取",
  "排行榜读取失败": "排行榜讀取失敗",
  "我": "我",
  "今天还没有签到记录": "今天還沒有簽到記錄",
  "阅读设置": "閱讀設定",
  "外观": "外觀",
  "阅读": "閱讀",
  "布局": "版面",
  "界面": "介面",
  "标准": "標準",
  "明暗": "明暗",
  "跟随系统": "跟隨系統",
  "浅色": "淺色",
  "暗色": "深色",
  "配色": "配色",
  "字号": "字號",
  "行距": "行距",
  "文章标签": "文章標籤",
  "展开": "展開",
  "收起": "收起",
  "关闭": "關閉",
  "文末热词": "文末熱詞",
  "语言": "語言",
  "简体": "簡體",
  "繁体": "繁體",
  "阅读记录": "閱讀記錄",
  "设置保存失败，请稍后重试": "設定儲存失敗，請稍後再試",
  "清空最近": "清空最近",
  "继续阅读": "繼續閱讀",
  "暂无记录": "暫無記錄",
  "还没有最近阅读": "還沒有最近閱讀",
  "去看看小说": "去看看小說",
  "记录已删除": "記錄已刪除",
  "删除失败，请稍后重试": "刪除失敗，請稍後重試",
  "最近记录已清空": "最近記錄已清空",
  "清空失败，请稍后重试": "清空失敗，請稍後重試",
  "完成管理": "完成管理",
  "管理最近记录": "管理最近記錄",
  "选择": "選擇",
  "已读完": "已讀完",
  "阅读进度": "閱讀進度",
  "确认清空": "確認清空",
  "个人内容": "個人內容",
  "收藏类型": "收藏類型",
  "收藏小说": "收藏小說",
  "还没有收藏视频": "還沒有收藏視頻",
  "还没有收藏音频": "還沒有收藏音頻",
  "还没有收藏小说": "還沒有收藏小說",
  "管理": "管理",
  "管理收藏": "管理收藏",
  "完成": "完成",
  "全选": "全選",
  "取消收藏": "取消收藏",
  "确认取消收藏": "確認取消收藏",
  "已取消收藏": "已取消收藏",
  "操作失败，请稍后重试": "操作失敗，請稍後再試",
  "取消": "取消",
  "删除": "刪除",
  "清空": "清空",
  "搜索": "搜尋",
  "搜索小说名": "搜尋小說名稱",
  "多个关键词用空格分隔": "多個關鍵詞用空格分隔",
  "搜索全部小说正文，多个关键词用空格分隔": "搜尋全部小說正文，多個關鍵詞用空格分隔",
  "搜索本文": "搜尋本文",
  "请先打开小说正文页再搜索本文": "請先開啟小說正文頁再搜尋本文",
  "请输入要查找的文字": "請輸入要尋找的文字",
  "当前小说没有匹配内容": "目前小說沒有符合內容",
  "收起搜索框": "收起搜尋框",
  "展开搜索框": "展開搜尋框",
  "本文查找结果": "本文搜尋結果",
  "上一个匹配项": "上一個符合項目",
  "下一个匹配项": "下一個符合項目",
  "关闭本文查找": "關閉本文搜尋",
  "搜索范围": "搜尋範圍",
  "正在搜索正文": "正在搜尋正文",
  "搜索进度": "搜尋進度",
  "正在启动搜索任务": "正在啟動搜尋任務",
  "搜索任务状态读取失败": "搜尋任務狀態讀取失敗",
  "搜索结果读取失败": "搜尋結果讀取失敗",
  "搜索失败": "搜尋失敗",
  "搜索启动失败": "搜尋啟動失敗",
  "全文搜索任务已取消": "全文搜尋任務已取消",
  "搜索标签": "搜尋標籤",
  "清空搜索": "清空搜尋",
  "清空搜索条件": "清空搜尋條件",
  "所有标签": "所有標籤",
  "按标签浏览小说。": "按標籤瀏覽小說。",
  "按分组浏览已打标签的小说。": "按分組瀏覽已加標籤的小說。",
  "登录后可查看标签": "登入後可查看標籤",
  "标签显示状态": "標籤顯示狀態",
  "浏览": "瀏覽",
  "已隐藏": "已隱藏",
  "未分组": "未分組",
  "暂无子标签。": "暫無子標籤。",
  "没有隐藏标签": "沒有隱藏標籤",
  "暂无标签": "暫無標籤",
  "没有匹配的标签": "沒有符合的標籤",
  "标签不存在": "標籤不存在",
  "别名": "別名",
  "随分组隐藏": "隨分組隱藏",
  "前往已隐藏标签": "前往已隱藏標籤",
  "显示此标签": "顯示此標籤",
  "隐藏此标签": "隱藏此標籤",
  "这个标签下暂无小说": "這個標籤下暫無小說",
  "标题": "標題",
  "正文": "正文",
  "本文": "本文",
  "高级": "進階",
  "高级搜索": "進階搜尋",
  "标题关键词": "標題關鍵詞",
  "正文关键词": "正文關鍵詞",
  "可选": "可選",
  "可选，多关键词用空格分隔": "可選，多個關鍵詞用空格分隔",
  "清除已选标签": "清除已選標籤",
  "清除已选": "清除已選",
  "已选标签条件": "已選標籤條件",
  "标签条件": "標籤條件",
  "包含": "包含",
  "排除": "排除",
  "筛选标签或别名": "篩選標籤或別名",
  "请选择标签或输入标题、正文关键词": "請選擇標籤或輸入標題、正文關鍵詞",
  "全文搜索": "全文搜尋",
  "共": "共",
  "本": "本",
};

export function normalizeLocale(value: string | null | undefined): AppLocale {
  return value?.toLowerCase() === TRADITIONAL_LOCALE.toLowerCase()
    ? TRADITIONAL_LOCALE
    : DEFAULT_LOCALE;
}

export function localeFromPathname(pathname: string): AppLocale {
  return pathname === TRADITIONAL_PATH_PREFIX ||
    pathname.startsWith(`${TRADITIONAL_PATH_PREFIX}/`)
    ? TRADITIONAL_LOCALE
    : DEFAULT_LOCALE;
}

export function stripLocalePath(pathname: string): string {
  if (pathname === TRADITIONAL_PATH_PREFIX) {
    return "/";
  }
  if (pathname.startsWith(`${TRADITIONAL_PATH_PREFIX}/`)) {
    return pathname.slice(TRADITIONAL_PATH_PREFIX.length) || "/";
  }
  return pathname || "/";
}

export function isLocaleAwarePath(pathname: string): boolean {
  const normalized = stripLocalePath(pathname);
  return !UNPREFIXED_PATHS.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  ));
}

export function withLocalePath(href: string, locale: AppLocale): string {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return href;
  }

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  if (!pathname.startsWith("/")) {
    return href;
  }

  const normalizedPath = stripLocalePath(pathname);
  if (!isLocaleAwarePath(normalizedPath)) {
    return `${normalizedPath}${search}${hash}`;
  }
  const localizedPath = locale === TRADITIONAL_LOCALE
    ? `${TRADITIONAL_PATH_PREFIX}${normalizedPath === "/" ? "" : normalizedPath}`
    : normalizedPath;
  return `${localizedPath || "/"}${search}${hash}`;
}

export function languageAlternates(pathname: string): Record<string, string> {
  return {
    "zh-Hans": withLocalePath(pathname, DEFAULT_LOCALE),
    "zh-Hant": withLocalePath(pathname, TRADITIONAL_LOCALE),
    "x-default": withLocalePath(pathname, DEFAULT_LOCALE),
  };
}

export function uiText(locale: AppLocale, text: string): string {
  return locale === TRADITIONAL_LOCALE
    ? TRADITIONAL_UI_TEXT[text] || text
    : text;
}

export function prefersTraditionalLanguage(acceptLanguage: string | null, country: string | null): boolean {
  const normalized = acceptLanguage?.toLowerCase() || "";
  if (/(^|,|\s)zh-(?:hant|tw|hk|mo)(?:[,;\s-]|$)/.test(normalized)) {
    return true;
  }
  return country === "TW" || country === "HK" || country === "MO";
}
