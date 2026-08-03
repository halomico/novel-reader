import { Minus, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import {
  DEFAULT_READER_LINE_HEIGHT,
  READER_LINE_HEIGHTS,
  type ReaderLineHeight,
} from "@/lib/ui-preferences";

export function ReaderFontSizeStepper({
  value,
  onChange,
  min = 8,
  max = 25,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="fontSizeStepper" role="group" aria-label="正文字号">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="减小字号" title="减小字号">
        <Minus size={17} aria-hidden="true" />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="增大字号" title="增大字号">
        <Plus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ReaderLineHeightSlider({
  value,
  onChange,
}: {
  value: ReaderLineHeight;
  onChange: (value: ReaderLineHeight) => void;
}) {
  const activeIndex = Math.max(0, READER_LINE_HEIGHTS.indexOf(value));
  return (
    <div
      className="readerLineHeightControl"
      style={{ "--reader-line-height-progress": `${(activeIndex / (READER_LINE_HEIGHTS.length - 1)) * 100}%` } as CSSProperties}
    >
      <div className="readerLineHeightSlider">
        <span className="readerLineHeightEdge isSmall" aria-hidden="true">小</span>
        <span className="readerLineHeightTrack" aria-hidden="true" />
        <input
          aria-label="正文行距"
          aria-valuetext={`${value.toFixed(1)} 倍`}
          type="range"
          min="1"
          max={READER_LINE_HEIGHTS.length}
          step="1"
          value={activeIndex + 1}
          onChange={(event) => onChange(READER_LINE_HEIGHTS[Number(event.target.value) - 1] || DEFAULT_READER_LINE_HEIGHT)}
        />
        <span className="readerLineHeightEdge isLarge" aria-hidden="true">大</span>
      </div>
    </div>
  );
}
