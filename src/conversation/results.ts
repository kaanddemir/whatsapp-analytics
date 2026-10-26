/* Transport-safe result projections shared by worker, Ask and presentation.
   These contracts contain evidence, never the worker-owned indexes or session. */
import type { Evidence } from "./types";
import type { PlanTag } from "@/events/timeline";
import type { DateMention } from "@/events/dates";

export interface TimelineMessage {
  readonly evidence: Evidence;
  readonly tags: readonly PlanTag[];
  readonly mentions: readonly DateMention[];
}
export interface TimelineThread {
  readonly from: string;
  readonly to: string;
  readonly participants: readonly string[];
  readonly messages: readonly TimelineMessage[];
  /** Plan-related messages in the conversation; `messages` holds at most MAX_THREAD_MESSAGES. */
  readonly size: number;
}
export interface TimelinePage {
  readonly total: number;
  readonly offset: number;
  readonly threads: readonly TimelineThread[];
  readonly datedMessages: number;
}
export interface SearchPage {
  readonly total: number;
  readonly offset: number;
  readonly items: readonly Evidence[];
  readonly terms: readonly string[];
}

