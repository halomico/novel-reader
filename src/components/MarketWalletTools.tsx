"use client";

import {
  ArrowRight,
  Cookie,
  CupSoda,
  TicketCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  exchangeCookieForSodaAction,
  redeemMarketCodeAction,
} from "@/app/market/actions";

export function MarketWalletTools({
  cookieBalance,
  cookieToSodaRate,
}: {
  cookieBalance: number;
  cookieToSodaRate: number;
}) {
  const [amount, setAmount] = useState("1");
  const receiveAmount = useMemo(() => {
    const value = Math.min(Math.max(Math.floor(Number(amount) || 0), 0), 1_000_000);
    return value * cookieToSodaRate;
  }, [amount, cookieToSodaRate]);

  return (
    <div className="marketWalletTools">
      <form className="marketExchangeLine" action={exchangeCookieForSodaAction}>
        <span className="marketExchangeName">
          <strong>曲奇换苏打</strong>
          <small>1 : {cookieToSodaRate}</small>
        </span>
        <label className="marketExchangeValue">
          <Cookie size={17} aria-hidden="true" />
          <input
            name="cookieAmount"
            type="number"
            min="1"
            max="1000000"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="曲奇数量"
            required
          />
          <span>曲奇</span>
        </label>
        <ArrowRight className="marketExchangeArrow" size={16} aria-hidden="true" />
        <span className="marketExchangeValue isOutput">
          <CupSoda size={17} aria-hidden="true" />
          <output>{receiveAmount.toLocaleString("zh-CN")}</output>
          <span>苏打</span>
        </span>
        <button type="submit" disabled={cookieBalance < 1}>兑换</button>
      </form>

      <form className="marketCodeLine" action={redeemMarketCodeAction}>
        <TicketCheck size={17} aria-hidden="true" />
        <label>
          <span className="srOnly">兑换码</span>
          <input name="code" autoComplete="off" placeholder="输入兑换码" maxLength={120} required />
        </label>
        <button type="submit">兑换</button>
      </form>
    </div>
  );
}
