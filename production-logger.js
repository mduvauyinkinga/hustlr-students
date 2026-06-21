export function logError(code) {
  // Production-safe breadcrumb only; do not leak stack traces, ids, uids, tokens, or Firebase internals.
  try {
    console.error(`[HUSTLR:${code}]`);
  } catch {
    // no-op
  }
}

