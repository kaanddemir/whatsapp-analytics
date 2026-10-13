// The parse report: what was counted, what was skipped and why. Counts only,
// never message text.
import type { ParseReport } from "@/model";
import { describeWarning, formatCount } from "../format";
import { useI18n } from "../i18n/context";

interface Props {
  report: ParseReport;
}

const COMPLETENESS = {
  complete: "Every line was read.",
  partial: "Some lines could not be used; see below.",
  empty: "No messages were found.",
} as const;

export function ParseReportView({ report }: Props) {
  const { locale } = useI18n();
  const tr = locale === "tr";
  const { messagesByKind: k, systemEventsByType: s, format } = report;
  return (
    <div className="report">
      <p><strong>{tr ? ({ complete: "Her satır okundu.", partial: "Bazı satırlar kullanılamadı; ayrıntılar aşağıda.", empty: "Mesaj bulunamadı." } as const)[report.completeness] : COMPLETENESS[report.completeness]}</strong></p>
      <dl>
        <dt>{tr ? "Mesajlar" : "Messages"}</dt>
        <dd>
          {formatCount(report.messages, locale)} ({formatCount(k.text, locale)} {tr ? "metin" : "text"}, {formatCount(k.media, locale)} {tr ? "medya" : "media"},{" "}
          {formatCount(k.deleted, locale)} {tr ? "silinen" : "deleted"}, {formatCount(k.unavailable, locale)} {tr ? "ulaşmayan" : "unavailable"}
          {report.editedMessages ? `, ${formatCount(report.editedMessages, locale)} ${tr ? "düzenlenen" : "edited"}` : ""})
        </dd>
        <dt>{tr ? "Sistem satırları" : "System lines"}</dt>
        <dd>
          {formatCount(report.systemEvents, locale)} ({s.group} {tr ? "grup" : "group"}, {s.call} {tr ? "arama" : "call"}, {s.encryption} {tr ? "bildirim" : "notice"},{" "}
          {s.security} {tr ? "güvenlik" : "security"}, {s.disappearing} {tr ? "süreli" : "disappearing"}, {s.unknown} {tr ? "tanınmayan" : "unrecognised"})
        </dd>
        <dt>{tr ? "Atlanan" : "Skipped"}</dt><dd>{formatCount(report.skippedRecords, locale)}</dd>
        <dt>{tr ? "Satırlar" : "Lines"}</dt>
        <dd>
          {formatCount(report.totalLines, locale)} ({formatCount(report.continuationLines, locale)} {tr ? "devam" : "continuation"},{" "}
          {formatCount(report.blankLines, locale)} {tr ? "boş" : "blank"})
        </dd>
        <dt>{tr ? "Biçim" : "Format"}</dt>
        <dd>
          {format.platform}, {format.dateOrder.toUpperCase()} ({format.dateOrderCertainty}), {format.clock}
        </dd>
      </dl>
      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((w) => (
            <li key={w.code}>
              {describeWarning(w.code, w.count, locale)}
              {w.sampleLines.length > 0 && <span className="muted"> ({tr ? "satır" : "line"} {w.sampleLines.join(", ")})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
