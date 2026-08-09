"use client";

import { useEffect, useState } from "react";
import { formatLocalDateTime, toDateTimeAttribute } from "@/lib/date-time";

type LocalDateTimeProps = {
  value: string | null | undefined;
  fallback?: string;
};

export function LocalDateTime({ value, fallback = "-" }: LocalDateTimeProps) {
  const [display, setDisplay] = useState(value || fallback);
  const dateTime = toDateTimeAttribute(value);

  useEffect(() => {
    setDisplay(formatLocalDateTime(value, { fallback }));
  }, [value, fallback]);

  return (
    <time dateTime={dateTime} title={dateTime || value || fallback}>
      {display}
    </time>
  );
}
