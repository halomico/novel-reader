"use client";

import {
  ArrowDown,
  ArrowUpDown,
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
        <header className="marketExchangeName"><strong>兑换</strong></header>
        <div className="marketExchangeStack">
          <label className="marketExchangeValue">
            <span className="marketExchangeMeta"><span>支付</span><small>余额 {sourceBalance.toLocaleString("zh-CN")}</small></span>
            <span className="marketExchangeAmount">
              <input
                name="sourceAmount"
                type="number"
                min={reverse ? cookieToSodaRate : 1}
                max="1000000"
                step={reverse ? cookieToSodaRate : 1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label={reverse ? "支付苏打数量" : "支付曲奇数量"}
                required
              />
              <span className="marketExchangeCurrency">
                {reverse ? <CupSoda size={17} aria-hidden="true" /> : <Cookie size={17} aria-hidden="true" />}
                <strong>{reverse ? "苏打" : "曲奇"}</strong>
              </span>
            </span>
          </label>
          {bidirectionalExchangeEnabled ? (
            <button
              className="marketExchangeSwap"
              type="button"
              onClick={swapDirection}
              aria-label={`切换为${reverse ? "曲奇兑换苏打" : "苏打兑换曲奇"}`}
              title="调换兑换方向"
            >
              <ArrowUpDown size={16} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : (
            <span className="marketExchangeSwap isStatic" aria-hidden="true">
              <ArrowDown size={16} strokeWidth={1.9} />
            </span>
          )}
          <div className="marketExchangeValue isOutput">
            <span className="marketExchangeMeta"><span>获得</span></span>
            <span className="marketExchangeAmount">
              <output aria-live="polite">{receiveAmount == null ? "—" : receiveAmount.toLocaleString("zh-CN")}</output>
              <span className="marketExchangeCurrency">
                {reverse ? <Cookie size={17} aria-hidden="true" /> : <CupSoda size={17} aria-hidden="true" />}
                <strong>{reverse ? "曲奇" : "苏打"}</strong>
              </span>
            </span>
          </div>
        </div>
        <button name="direction" type="submit" value={direction} disabled={!canExchange}>兑换</button>
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
