import { Cookie, CupSoda } from "lucide-react";

export function AdminMarketPriceSelector({
  priceCookie = 1,
  priceSoda = null,
}: {
  priceCookie?: number | null;
  priceSoda?: number | null;
}) {
  const currency = priceSoda != null && priceCookie == null ? "soda" : "cookie";
  const price = currency === "soda" ? priceSoda ?? 10 : priceCookie ?? 1;

  return (
    <fieldset className="adminMarketPriceSelector">
      <legend>支付方式</legend>
      <div className="adminMarketCurrencyOptions">
        <label>
          <input name="currency" type="radio" value="cookie" defaultChecked={currency === "cookie"} />
          <span><Cookie size={15} aria-hidden="true" />曲奇</span>
        </label>
        <label>
          <input name="currency" type="radio" value="soda" defaultChecked={currency === "soda"} />
          <span><CupSoda size={15} aria-hidden="true" />苏打</span>
        </label>
      </div>
      <label className="adminMarketPriceAmount">
        <span>价格</span>
        <input name="price" type="number" min="0" defaultValue={price} required />
      </label>
    </fieldset>
  );
}
