type ErrorRecord = Record<string, unknown>;
export function errorChain(error: unknown): ErrorRecord[] {
  const pending: unknown[] = [error],
    seen = new Set<object>(),
    result: ErrorRecord[] = [];
  while (pending.length && result.length < 32) {
    const next = pending.shift();
    if (!next || typeof next !== "object" || seen.has(next)) continue;
    seen.add(next);
    const record = next as ErrorRecord;
    result.push(record);
    for (const key of ["cause", "meta", "driverAdapterError", "originalError"])
      if (record[key] && typeof record[key] === "object")
        pending.push(record[key]);
    if (Array.isArray(record.errors))
      pending.push(...record.errors.slice(0, 8));
  }
  return result;
}
const sqlPattern = /^(?:[0-9]{2}[A-Z0-9]{3}|P0[A-Z0-9]{3}|XX[A-Z0-9]{3})$/;
export function sqlState(error: unknown): string | undefined {
  for (const node of errorChain(error)) {
    for (const value of [node.originalCode, node.code])
      if (typeof value === "string" && sqlPattern.test(value)) return value;
  }
}
export function prismaErrorCode(error: unknown): string | undefined {
  for (const node of errorChain(error))
    for (const value of [node.code, node.errorCode])
      if (typeof value === "string" && /^P[0-9]{4}$/.test(value)) return value;
}
export function databaseConstraint(error: unknown): string | undefined {
  for (const node of errorChain(error)) {
    const value =
      typeof node.constraint === "string"
        ? node.constraint
        : (node.constraint as ErrorRecord | undefined)?.index;
    if (typeof value === "string" && /^[a-zA-Z0-9_]{1,128}$/.test(value))
      return value;
  }
}
export function connectionError(error: unknown) {
  return errorChain(error).some(
    (node) =>
      typeof node.code === "string" &&
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "EAI_AGAIN",
        "ENOTFOUND",
      ].includes(node.code as string),
  );
}
