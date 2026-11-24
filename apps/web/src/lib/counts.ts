export function countValue(value: unknown): bigint {
  const text = String(value ?? "0");
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}
export function countLabel(value: unknown) {
  return countValue(value).toLocaleString("vi-VN");
}
