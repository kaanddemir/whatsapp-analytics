/* The one copy of search by meaning's state on this side of the worker.

   Every change arrives as an update from the worker's indexer, in order. The
   reply to a request is a snapshot, so it is used only when no update came
   after the request was sent; otherwise it could undo a newer state. Resetting
   (a chat opened or closed) also outdates replies still on their way, so a
   chat never shows another chat's state. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisClient } from "@/worker/client";
import type { SemanticState } from "@/semantic/indexer";

export type SemanticAction = "enable" | "pause" | "status" | "remove";

export function useSemanticSearch(client: Pick<AnalysisClient, "semantic" | "onSemantic">) {
  const [state, setState] = useState<SemanticState>({ status: "off" });
  const updates = useRef(0);

  useEffect(() => client.onSemantic((next) => {
    updates.current++;
    setState(next);
  }), [client]);

  const send = useCallback(async (action: SemanticAction) => {
    const at = updates.current;
    const snapshot = await client.semantic(action);
    if (updates.current === at) setState(snapshot);
  }, [client]);

  const reset = useCallback(() => {
    updates.current++;
    setState({ status: "off" });
  }, []);

  return { state, send, reset };
}
