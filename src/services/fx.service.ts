import { getBuimercApexBaseUrl } from '../config/company.config';

export interface FxRateResult {
  rate: number;          // from -> to conversion rate (0 when not found)
  rateDate?: string;     // the actual rate date used (YYYY-MM-DD)
  rateType?: string;
  found: boolean;
  error?: string;
}

// Fetch the currency conversion rate from `from` to `to` (functional, default
// AED) as of `date` (YYYY-MM-DD) — uses the latest rate on/before that date.
// Same currency short-circuits to rate 1 (no webservice call). Reads
// GET /currencies/dailyrates (ordered RATE_DATE DESC).
// NOTE: Currency rates webservice is centralized in BUIMERC and is shared across all companies
export const getConversionRate = async (
  from: string,
  to = 'AED',
  date?: string,
  rateType = 'Corporate',
): Promise<FxRateResult> => {
  if (!from || from.toUpperCase() === to.toUpperCase()) {
    return { rate: 1, rateType, rateDate: date, found: true };
  }
  try {
    const p = new URLSearchParams({ from_currency: from, to_currency: to, rate_type: rateType });
    if (date) p.append('date_to', date);       // latest rate on/before the date
    p.append('row_limit', '1');
    const res = await fetch(`${getBuimercApexBaseUrl()}/currencies/dailyrates?${p.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    const items: any[] = data.items || [];
    if (!items.length) {
      return { rate: 0, found: false, error: `No ${rateType} rate ${from}→${to}${date ? ' up to ' + date : ''}` };
    }
    const top = items[0];
    const rate = Number(top.rate ?? top.conversionRate ?? 0);
    return { rate, rateDate: top.rateDate, rateType: top.rateType || rateType, found: rate > 0 };
  } catch (e: any) {
    return { rate: 0, found: false, error: e?.message };
  }
};
