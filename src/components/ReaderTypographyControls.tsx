import { Minus, Plus } from "lucide-react";
import {
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

export function ReaderLineHeightStepper({
  value,
  onChange,
}: {
  value: ReaderLineHeight;
  onChange: (value: ReaderLineHeight) => void;
}) {
  const activeIndex = Math.max(0, READER_LINE_HEIGHTS.indexOf(value));
  return (
    <div className="fontSizeStepper readerLineHeightStepper" role="group" aria-label="正文行距">
      <button
        type="button"
        onClick={() => onChange(READER_LINE_HEIGHTS[activeIndex - 1] || READER_LINE_HEIGHTS[0])}
        disabled={activeIndex <= 0}
        aria-label="减小行距"
        title="减小行距"
      >
        <Minus size={17} aria-hidden="true" />
      </button>
      <output aria-live="polite">{value.toFixed(1)}</output>
      <button
        type="button"
        onClick={() => onChange(READER_LINE_HEIGHTS[activeIndex + 1] || READER_LINE_HEIGHTS[READER_LINE_HEIGHTS.length - 1])}
        disabled={activeIndex >= READER_LINE_HEIGHTS.length - 1}
        aria-label="增大行距"
        title="增大行距"
      >
        <Plus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
