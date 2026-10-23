/** CNPJ digit helpers shared by tools (import-only; not discovered). */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCnpj(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(base[i]) * weights[i]!;
  }
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

/** Validate Brazilian CNPJ check digits. Accepts formatted or raw digits. */
export function isValidCnpj(value: string): boolean {
  const d = digitsOnly(value);
  if (!/^\d{14}$/.test(d)) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = checkDigit(d.slice(0, 12), w1);
  const d2 = checkDigit(d.slice(0, 12) + String(d1), w2);
  return d[12] === String(d1) && d[13] === String(d2);
}
