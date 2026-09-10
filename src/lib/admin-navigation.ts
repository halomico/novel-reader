export type AdminNavKey =
  | "home"
  | "books"
  | "indexes"
  | "settings"
  | "users"
  | "analytics"
  | "media"
  | "market"
  | "tags"
  | "original"
  | "access"
  | "station";

const ADMIN_SECTION_TITLES: Record<AdminNavKey, string> = {
  home: "后台首页",
  books: "小说管理",
  indexes: "搜索索引",
  settings: "系统设置",
  users: "用户管理",
  analytics: "数据分析",
  media: "资源管理",
  market: "集市管理",
  tags: "标签管理",
  original: "原创管理",
  access: "内容访问",
  station: "站务中心",
};

export function adminNavKeyForPathname(pathname: string): AdminNavKey {
  const section = pathname.split("/").filter(Boolean)[1];
  return section && Object.hasOwn(ADMIN_SECTION_TITLES, section)
    ? section as AdminNavKey
    : "home";
}

export function adminTitleFor(active: AdminNavKey): string {
  return ADMIN_SECTION_TITLES[active];
}
