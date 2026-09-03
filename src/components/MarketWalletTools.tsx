"use client";

import {
  Cookie,
  CupSoda,
  TicketCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  exchangeCurrencyAction,
  redeemMarketCodeAction,
} from "@/app/market/actions";
import type { CurrencyExchangeDirection } from "@/lib/user-wallet";

function ExchangeAsset({ currency }: { currency: "cookie" | "soda" }) {
  const soda = currency === "soda";
  const Icon = soda ? CupSoda : Cookie;
  return (
    <span className="marketExchangeAsset">
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
      <strong>{soda ? "苏打" : "曲奇"}</strong>
    </span>
  );
}

function ExchangeSwapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M7.8 3V21L2.6 15.8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.2 21V3L21.4 8.2"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MarketWalletTools({
  cookieBalance,
  sodaBalance,
  cookieToSodaRate,
  bidirectionalExchangeEnabled,
}: {
  cookieBalance: number;
  sodaBalance: number;
  cookieToSodaRate: number;
  bidirectionalExchangeEnabled: boolean;
}) {
  const [direction, setDirection] = useState<CurrencyExchangeDirection>("cookie-to-soda");
  const [amount, setAmount] = useState("1");
  const amountValue = useMemo(() => {
    const value = Number(amount);
    return Number.isSafeInteger(value) ? value : 0;
  }, [amount]);
  const reverse = direction === "soda-to-cookie";
  const payCurrency = reverse ? "soda" : "cookie";
  const receiveCurrency = reverse ? "cookie" : "soda";
  const exactReverseAmount = !reverse || amountValue % cookieToSodaRate === 0;
  const receiveAmount = exactReverseAmount
    ? (reverse ? amountValue / cookieToSodaRate : amountValue * cookieToSodaRate)
    : null;
  const sourceBalance = reverse ? sodaBalance : cookieBalance;
  const canExchange = amountValue >= 1 && amountValue <= 1_000_000 && exactReverseAmount && amountValue <= sourceBalance;

  function swapDirection() {
    const next: CurrencyExchangeDirection = reverse ? "cookie-to-soda" : "soda-to-cookie";
    setDirection(next);
    setAmount(receiveAmount != null && receiveAmount >= 1
      ? String(receiveAmount)
      : next === "soda-to-cookie" ? String(cookieToSodaRate) : "1");
  }

  return (
    <div className="marketWalletTools">
      <form className="marketExchangeLine" action={exchangeCurrencyAction}>
        <header className="marketExchangeName"><strong>闪兑</strong></header>
        <div className="marketExchangeStack">
          <label className="marketExchangePanel">
            <span className="marketExchangeSide">支付</span>
            <span className="marketExchangeRow">
              <input
                name="sourceAmount"
                type="number"
                min={reverse ? cookieToSodaRate : 1}
                max="1000000"
                step={reverse ? cookieToSodaRate : 1}
                value={amount}
                placeholder="0"
                onChange={(event) => setAmount(event.target.value)}
                aria-label={reverse ? "支付苏打数量" : "支付曲奇数量"}
                required
              />
              <ExchangeAsset currency={payCurrency} />
            </span>
          </label>
          {bidirectionalExchangeEnabled ? (
            <button
              className={`marketExchangeSwap${reverse ? " isReversed" : ""}`}
              type="button"
              onClick={swapDirection}
              aria-label={`切换为${reverse ? "曲奇兑换苏打" : "苏打兑换曲奇"}`}
              title="调换兑换方向"
            >
              <ExchangeSwapIcon />
            </button>
          ) : (
            <span className="marketExchangeSwap isStatic" aria-hidden="true">
              <ExchangeSwapIcon />
            </span>
          )}
          <div className="marketExchangePanel isOutput">
            <span className="marketExchangeSide">获得</span>
            <span className="marketExchangeRow">
              <output aria-live="polite">{receiveAmount == null ? "—" : receiveAmount.toLocaleString("zh-CN")}</output>
              <ExchangeAsset currency={receiveCurrency} />
            </span>
          </div>
        </div>
        {reverse && !exactReverseAmount ? (
          <p className="marketExchangeHint">须为 {cookieToSodaRate.toLocaleString("zh-CN")} 的倍数</p>
        ) : null}
        <button className="marketExchangeSubmit" name="direction" type="submit" value={direction} disabled={!canExchange}>
          兑换
        </button>
      </form>

      <form className="marketCodeLine" action={redeemMarketCodeAction}>
        <strong>兑换码</strong>
        <div className="marketCodeInputRow">
          <label>
            <TicketCheck size={17} aria-hidden="true" />
            <span className="srOnly">兑换码</span>
            <input name="code" autoComplete="off" placeholder="输入兑换码" maxLength={120} required />
          </label>
          <button type="submit">兑换</button>
        </div>
      </form>
    </div>
  );
}
