import { Cookie, CupSoda } from "lucide-react";

export type CurrencyKind = "cookie" | "soda";

export function CurrencyBalance({
  currency,
  label,
  amount,
  className = "",
}: {
  currency: CurrencyKind;
  label: string;
  amount: number;
  className?: string;
}) {
  const Icon = currency === "cookie" ? Cookie : CupSoda;

  return (
    <span
      className={`currencyBalance${className ? ` ${className}` : ""}`}
      aria-label={`${label} ${amount}`}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      <strong>{amount}</strong>
    </span>
  );
}
