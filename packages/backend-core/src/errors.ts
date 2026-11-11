import { createHash, timingSafeEqual } from "node:crypto";
import { ERROR_STATUS } from "../../contracts/src/errors";
export class ApiError extends Error {
  readonly status: number;
  constructor(
    public code: string,
    message?: string,
    public errors?: unknown[],
  ) {
    super(message ?? code.replaceAll("_", " ").toLowerCase());
    this.status = ERROR_STATUS[code] ?? 500;
  }
}
export function fail(code: string, message?: string): never {
  throw new ApiError(code, message);
}
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function secureEqual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
