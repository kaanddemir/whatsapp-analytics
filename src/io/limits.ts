/* Input limits: a memory budget, not a fixed file-size cap.

   The former 25 MB cap guarded memory, since the whole chat is parsed into
   objects. It is replaced by an estimate of the parse's working set,
   checked against what the device can spare. Basis (benchmark of
   this import path, Node 22 on an M1 8 GB, peak RSS of read + parse +
   analyze): 220 MB for 4.9 MB of text (100k messages), 530 MB for 24.7 MB
   (500k), 960 MB for 49.4 MB (1M), i.e. 150 MB plus 14–16× the text; with
   search, behaviour and timeline structures built as well, 241 MB (100k),
   629 MB (500k), 1,025 MB with search at 1M. The factor below covers the
   worst of those with margin. Chrome measured lower
   growth in the browser benchmark (about 1.2 GB for 113 MB). The budget is a fraction of
   device memory, so a chat that fits leaves room for the browser and other
   apps.

   Absolute ceilings: a JavaScript string holds at most about 2^29 characters
   (V8), so text above 512 MB cannot be decoded in one piece at all; and
   ZIP archives above 4 GB need ZIP64, which is not supported. */

/** Chat text the app can never hold, on any device. */
export const MAX_TEXT_BYTES = 512 * 1024 * 1024;
/** Largest archive accepted; only the chat entry inside is read. */
export const MAX_ZIP_BYTES = 4 * 1024 * 1024 * 1024 - 1;

/** Estimated peak working set per byte of chat text, and the fixed part. */
export const WORKING_SET_PER_BYTE = 20;
export const WORKING_SET_BASE_MB = 150;
/** Share of device memory one import may use. */
export const DEVICE_SHARE = 0.4;
/** Assumed when the browser does not report device memory (Safari, Firefox). */
export const DEFAULT_DEVICE_GB = 4;

export interface MemoryEnv {
  /** navigator.deviceMemory: GB, rounded down and capped at 8 by browsers. */
  readonly deviceMemoryGB?: number | undefined;
  /** performance.memory.jsHeapSizeLimit in MB (Chromium only). */
  readonly heapLimitMB?: number | undefined;
}

export function runtimeMemoryEnv(): MemoryEnv {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const perf = typeof performance === "undefined" ? undefined : (performance as Performance & { memory?: { jsHeapSizeLimit?: number } });
  const heap = perf?.memory?.jsHeapSizeLimit;
  return { deviceMemoryGB: nav?.deviceMemory, heapLimitMB: heap ? heap / 1024 / 1024 : undefined };
}

export function estimateWorkingSetMB(textBytes: number): number {
  return WORKING_SET_BASE_MB + (WORKING_SET_PER_BYTE * textBytes) / 1024 / 1024;
}

/** Memory one import may use on this device, in MB. */
export function importBudgetMB(env: MemoryEnv = runtimeMemoryEnv()): number {
  const device = (env.deviceMemoryGB && env.deviceMemoryGB > 0 ? env.deviceMemoryGB : DEFAULT_DEVICE_GB) * 1024 * DEVICE_SHARE;
  // The parse lives in the JS heap; keep a quarter of the heap limit free.
  return env.heapLimitMB ? Math.min(device, env.heapLimitMB * 0.75) : device;
}

/** Largest chat text, in bytes, this device is expected to import safely. */
export function textBudgetBytes(env: MemoryEnv = runtimeMemoryEnv()): number {
  const bytes = ((importBudgetMB(env) - WORKING_SET_BASE_MB) / WORKING_SET_PER_BYTE) * 1024 * 1024;
  return Math.max(0, Math.min(MAX_TEXT_BYTES, Math.floor(bytes)));
}
