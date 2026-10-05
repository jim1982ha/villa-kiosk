// src/utils/money.ts
// THE way VESTA writes an amount of money (2.496.263).
//
// The currency is ALWAYS Home Assistant's own (Settings → System → General →
// Currency — `get_config.currency`): set once, centrally, and every amount in
// the app follows it. The look is the reader's locale's standard currency
// style (Intl), so "€1,250", "IDR 450,000" and "1 250 €" each read the way
// that reader expects.
//
// ⚠️ TWO FORMATTERS, TWO LOOKS, FOR ONE AMOUNT. Facility wrote
// "IDR 450,000" (the ISO code, then the number, always rounded), Energy wrote
// Intl currency style from the cost statistic's own unit — so the same money
// read differently on two screens, and Energy could follow a different
// currency than the one the owner set. One rule now, for both and the report.
//
// Decimals: whole units from 100 up (450,000 / €1,250), cents below (€12.50,
// €0.25 a kWh) — the rule Energy already used, now everywhere.

/** Write `amount` in `currency` (an ISO 4217 code — Home Assistant's own).
 *  No currency, or one Intl does not know: the grouped number alone, then the
 *  code if there was one — never a mislabelled symbol. */
export function formatMoney(amount: number, currency: string | undefined, locale?: string): string {
  const v = Number.isFinite(amount) ? amount : 0;
  const digits = Math.abs(v) >= 100 ? 0 : 2;
  const code = currency?.trim().toUpperCase() ?? "";
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(locale ?? [], {
        style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(v);
    } catch { /* not a currency Intl knows — written plainly below */ }
  }
  const n = new Intl.NumberFormat(locale ?? [], { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(v);
  return code ? `${n} ${code}` : n;
}
