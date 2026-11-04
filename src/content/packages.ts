/**
 * Packages page (/packages): introductory prices in shekels, VAT included.
 * Prices may change; purchase is manual for now (the buyer contacts us, an admin sets the plan).
 * Daily limits shown on the page come from the database (plan_features), not from here.
 */
export const INTRO_PRICES = {
  pro: { monthly: 59, yearly: 590 },
  max: { monthly: 129, yearly: 1290 },
  apiStarter: { monthly: 399 },
  apiBusiness: { monthly: 1199 },
} as const;

export function shekels(n: number, locale: string): string {
  return `₪${n.toLocaleString(locale)}`;
}
