import { ArrowRight, BookOpenText } from "lucide-react";
import type { ReadingProgress } from "@/lib/reading-progress";
import { uiText, type AppLocale } from "@/lib/locale";
import Link from "./LocalizedLink";

export function ContinueReadingStrip({
  item,
  locale,
}: {
  item: ReadingProgress | null;
  locale: AppLocale;
}) {
  if (!item) return null;
  const progress = Math.max(Math.round(item.progressPercent), 1);
  return (
    <aside className="continueReadingStrip" aria-label={uiText(locale, "继续阅读")}>
      <span className="continueReadingIcon" aria-hidden="true"><BookOpenText size={18} /></span>
      <Link href={`/books/${item.novelId}?resume=1`}>
        <span>
          <small>{uiText(locale, "继续阅读")}</small>
          <strong>{item.title}</strong>
        </span>
        <span className="continueReadingMeta">
          <span>{progress}%</span>
          <ArrowRight size={17} aria-hidden="true" />
        </span>
        <i aria-hidden="true"><span style={{ width: `${progress}%` }} /></i>
      </Link>
    </aside>
  );
}
