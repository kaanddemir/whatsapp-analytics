import { useEffect, useState } from "react";
import { AnalysisClient } from "@/worker/client";

/**
 * One worker per mounted app; terminated (and the chat freed) on unmount.
 * `enabled = false` creates nothing (tests inject their own client).
 */
export function useAnalysisClient(enabled = true): AnalysisClient | null {
  const [client] = useState(() => (enabled ? new AnalysisClient() : null));
  useEffect(() => () => client?.dispose(), [client]);
  return client;
}
