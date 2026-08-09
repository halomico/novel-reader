import { Clock3 } from "lucide-react";
import type { AppLocale } from "@/lib/locale";
import type { EntitlementRight, EntitlementTargetType, UserEntitlementPage } from "@/lib/entitlements";
import { Pagination } from "./Pagination";

const TYPE_LABELS: Record<EntitlementTargetType, string> = {
  novel: "小说",
  novel_source: "小说来源",
  video: "视频",
  video_category: "视频分类",
  video_tag: "视频标签",
  audio: "音频",
  audio_folder: "音频目录",
  file: "文件",
  file_folder: "文件目录",
};

const RIGHT_LABELS: Record<EntitlementRight, string> = {
  read: "阅读",
  play: "播放",
  view: "查看",
  download: "下载",
};

export function UserEntitlementList({ data, locale }: { data: UserEntitlementPage; locale: AppLocale }) {
  const dateLocale = locale === "zh-Hant" ? "zh-TW" : "zh-CN";
  return (
    <section className="accountEntitlements">
      {data.items.length ? (
        <div className="accountEntitlementList">
          {data.items.map((item) => (
            <article className={item.active ? "" : "isExpired"} key={item.id}>
              <span className="accountEntitlementCopy">
                <strong>{item.targetLabel}</strong>
                <small>{TYPE_LABELS[item.targetType]} · {item.rights.map((right) => RIGHT_LABELS[right]).join("、")}</small>
              </span>
              <span className="accountEntitlementExpiry">
                <Clock3 size={13} aria-hidden="true" />
                {item.expiresAt
                  ? `${item.active ? "有效至" : "已过期"} ${new Date(item.expiresAt).toLocaleDateString(dateLocale)}`
                  : "永久有效"}
              </span>
            </article>
          ))}
        </div>
      ) : <p className="messageEmpty">暂无资源权益</p>}
      <Pagination page={data.page} totalPages={data.totalPages} query="" basePath="/account" pageParam="rightsPage" extraParams={{ view: "growth", panel: "rights" }} />
    </section>
  );
}
