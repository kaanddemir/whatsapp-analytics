// The "Chat info" dialog body (chat menu, or the context bar's notes link).
// What users need about the open chat: the file, the kind of chat, its size,
// its span, and whether it was read in full. All values describe the whole
// imported chat, never the dashboard filters. Parser diagnostics stay in the
// report; only plain-language consequences are shown here.
import type { LoadSummary } from "@/worker/protocol";
import { formatCount, formatDateRange } from "../format";
import { importStatus } from "../importStatus";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/context";

export function ChatInfo({ summary }: { summary: LoadSummary }) {
  const { locale, t } = useI18n();
  const status = importStatus(summary, locale);
  // Only a group is known for sure; "probably one-to-one" is not shown.
  const kind = summary.chatType.kind === "group" ? t("groupChat") : null;
  const range = formatDateRange(summary.firstMessageAt.slice(0, 10), summary.lastMessageAt.slice(0, 10), locale);

  return (
    <div className="chat-info">
      <div className="chat-info-file">
        <span className="chat-info-mark" aria-hidden="true"><Icon name="file" size={18} /></span>
        <div className="chat-info-name">
          <p className="name" title={summary.file.fileName}>{summary.file.fileName}</p>
          {kind && <p className="muted">{kind}</p>}
        </div>
      </div>

      <dl className="chat-info-stats">
        <div><dt>{t("messages")}</dt><dd>{formatCount(summary.report.messages, locale)}</dd></div>
        <div><dt>{t("participants")}</dt><dd>{formatCount(summary.participantCount, locale)}</dd></div>
        <div className="span"><dt>{t("dates")}</dt><dd>{range}</dd></div>
      </dl>

      <div className={`chat-info-status ${status.level}`} role="status">
        <Icon name={status.level === "ok" ? "check" : "warning"} size={16} />
        <div>
          <p className="chat-info-title">{status.title}</p>
          {status.detail && <p>{status.detail}</p>}
          {status.points.length > 0 && (
            <ul aria-label={t("chatImportNotes")}>
              {status.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {status.advice && <p className="chat-info-advice">{status.advice}</p>}
        </div>
      </div>
    </div>
  );
}
