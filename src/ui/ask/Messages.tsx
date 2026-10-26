/* WhatsApp messages inside an answer: the evidence the engine cited, exactly
   as stored. Each can be opened in context (its neighbours, read from the
   worker on request); lists start short and page through what the engine
   already returned, then through the worker for searches that found more.
   Plan conversations (the timeline result) use the same message rows. */
import { useState } from "react";
import type { AnalysisClient } from "@/worker/client";
import type { Evidence, MessageView } from "@/conversation/types";
import type { ChatResult } from "@/ask/types";
import type { PlanTag } from "@/events/timeline";
import type { TranslationKey } from "@/i18n/en";
import { formatCount, formatDate } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";
import { CornerDownRight } from "lucide-react";
import { participantColor } from "../participantColors";
import { FIRST_MESSAGES, MORE_MESSAGES, highlightParts, type MessageGroup } from "./present";

export type MessagesPort = Pick<AnalysisClient, "context" | "timeline">;
/** Fetches cited messages beyond those already shown. */
export type LoadMessages = (offset: number, limit: number) => Promise<readonly Evidence[]>;

const day = (at: string) => at.slice(0, 10);
const time = (at: string) => at.slice(11, 16);

function MessageMeta({ view, base, tags }: { view: MessageView; base: string | null; tags?: readonly PlanTag[] | undefined }) {
  const { locale, t } = useI18n();
  // Within a transcript the day heading already says the date.
  const when = base === day(view.at) ? time(view.at) : `${formatDate(day(view.at), locale)}, ${time(view.at)}`;
  return (
    <p className="msg-meta">
      <span className="msg-dot" style={{ background: participantColor(String(view.sender)) }} aria-hidden="true" />
      <span className="msg-sender name">{view.senderName}</span>
      <time dateTime={view.at}>{when}</time>
      {view.edited && <span className="msg-flag">{t("x_edited")}</span>}
      {tags?.map((tag) => <span key={tag} className="msg-tag">{t(`ask.tag.${tag}` as TranslationKey)}</span>)}
    </p>
  );
}

function MessageText({ view, ranges = [] }: { view: MessageView; ranges?: Evidence["highlights"] }) {
  // Media, deleted and missing messages show the export's placeholder, set apart from typed text.
  if (view.kind !== "text") return <p className="msg-text placeholder">{view.text}</p>;
  return <p className="msg-text">{highlightParts(view.text, ranges).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}</p>;
}

function MessageItem({ group, transcript, client, tags }: { group: MessageGroup; transcript: boolean; client: MessagesPort; tags?: readonly PlanTag[] | undefined }) {
  const { t } = useI18n();
  const [context, setContext] = useState<readonly MessageView[] | "loading" | "failed" | null>(null);
  const m = group.match.message;
  const open = Array.isArray(context);
  const toggle = async () => {
    if (open) return setContext(null);
    setContext("loading");
    try {
      setContext(await client.context(m.id, 3, 4));
    } catch {
      setContext("failed");
    }
  };
  return (
    <li className={`msg${open ? " in-context" : ""}`}>
      {open ? (
        <ol className="msg-context" aria-label={t("ask.contextLabel")}>
          {(context as readonly MessageView[]).map((c) => (
            <li key={c.id} className={c.id === m.id ? "msg-line cited" : "msg-line"} aria-current={c.id === m.id ? "true" : undefined}>
              <MessageMeta view={c} base={day(m.at)} />
              <MessageText view={c} ranges={c.id === m.id ? group.match.highlights : []} />
            </li>
          ))}
        </ol>
      ) : (
        <>
          <MessageMeta view={m} base={transcript ? day(m.at) : null} tags={tags} />
          <MessageText view={m} ranges={group.match.highlights} />
          {group.reply && (
            <div className="msg-reply">
              <CornerDownRight size={16} />
              <div>
                <span className="sr-only">{t("ask.reply")}: </span>
                <MessageMeta view={group.reply.message} base={day(m.at)} />
                <MessageText view={group.reply.message} ranges={group.reply.highlights} />
              </div>
            </div>
          )}
        </>
      )}
      <button type="button" className="link-btn msg-toggle" aria-expanded={open} disabled={context === "loading"} onClick={() => void toggle()}>
        {context === "loading" && <span className="spinner" aria-hidden="true" />}
        {open ? t("ask.hideContext") : t("ask.context")}
      </button>
      {context === "failed" && <p className="msg-error" role="alert">{t("ask.contextFailed")}</p>}
    </li>
  );
}

interface ListProps {
  groups: readonly MessageGroup[];
  /** Messages behind the list; more than `groups` only when `load` can fetch them. */
  total: number;
  load?: LoadMessages | undefined;
  /** Chronological, under day headings (a day's or a period's messages, a plan conversation). */
  transcript: boolean;
  client: MessagesPort;
  label: string;
  tags?: ReadonlyMap<number, readonly PlanTag[]>;
  first?: number;
}

export function MessageList({ groups, total, load, transcript, client, label, tags, first = FIRST_MESSAGES }: ListProps) {
  const { locale, t } = useI18n();
  const [extra, setExtra] = useState<readonly MessageGroup[]>([]);
  const [shown, setShown] = useState(first);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const all = extra.length ? [...groups, ...extra] : groups;
  const visible = all.slice(0, shown);
  const count = Math.max(total, all.length);
  const hasMore = shown < all.length || (load !== undefined && all.length < count);

  const more = async () => {
    if (shown + MORE_MESSAGES <= all.length || !load || all.length >= count) return setShown(shown + MORE_MESSAGES);
    setState("loading");
    try {
      const items = await load(all.length, MORE_MESSAGES);
      setExtra((x) => [...x, ...items.map((match) => ({ match, reply: null }))]);
      setShown(shown + MORE_MESSAGES);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="msgs">
      {visible.length < count && (
        <p className="msgs-count">{t("ask.messagesShown", { shown: formatCount(visible.length, locale), total: formatCount(count, locale) })}</p>
      )}
      <ol className="msg-list" aria-label={label}>
        {visible.map((g, i) => {
          const d = day(g.match.message.at);
          const heading = transcript && (i === 0 || day(visible[i - 1]!.match.message.at) !== d);
          return [
            heading && <li key={`d${d}`} className="msg-day"><span>{formatDate(d, locale)}</span></li>,
            <MessageItem key={g.match.message.id} group={g} transcript={transcript} client={client} tags={tags?.get(g.match.message.id)} />,
          ];
        })}
      </ol>
      {hasMore && (
        <button type="button" className="btn ghost msgs-more" disabled={state === "loading"} onClick={() => void more()}>
          {state === "loading" && <span className="spinner" aria-hidden="true" />}
          {t("ask.showMore")}
        </button>
      )}
      {state === "failed" && <p className="msg-error" role="alert">{t("ask.moreFailed")}</p>}
    </div>
  );
}

/** Plan-related messages a conversation shows before saying how many more it has. */
const PLAN_MESSAGES = 4;

/** Plan conversations, newest first, as one transcript: each conversation under its dates, its plan messages tagged. */
export function Plans({ result, client }: { result: Extract<ChatResult, { kind: "timeline" }>; client: MessagesPort }) {
  const { locale, t } = useI18n();
  const page = result.page!;
  const [threads, setThreads] = useState(page.threads);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const more = async () => {
    setState("loading");
    try {
      const next = await client.timeline(result.filters, "newest", threads.length, 3);
      setThreads((ts) => [...ts, ...next.threads]);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="msgs">
      <ol className="msg-list" aria-label={t("ask.messages")}>
        {threads.map((th) => {
          const from = day(th.from), to = day(th.to), shown = th.messages.slice(0, PLAN_MESSAGES);
          return [
            <li key={`d${th.from}`} className="msg-day"><span>{from === to ? formatDate(from, locale) : `${formatDate(from, locale)} – ${formatDate(to, locale)}`}</span></li>,
            ...shown.map((m) => (
              <MessageItem key={m.evidence.message.id} group={{ match: m.evidence, reply: null }} transcript={from === to} client={client} tags={m.tags} />
            )),
            th.size > shown.length && (
              <li key={`n${th.from}`} className="msg-note">{t("ask.planMore", { count: formatCount(th.size - shown.length, locale) })}</li>
            ),
          ];
        })}
      </ol>
      {threads.length < page.total && (
        <button type="button" className="btn ghost msgs-more" disabled={state === "loading"} onClick={() => void more()}>
          {state === "loading" && <span className="spinner" aria-hidden="true" />}
          {t("ask.morePlans")}
        </button>
      )}
      {state === "failed" && <p className="msg-error" role="alert">{t("ask.moreFailed")}</p>}
    </div>
  );
}
