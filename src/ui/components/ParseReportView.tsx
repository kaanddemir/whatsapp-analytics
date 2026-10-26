// The parse report: what was counted, what was skipped and why. Counts only,
// never message text.
import type { ParseReport } from "@/model";
import { describeWarning, formatCount } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";

interface Props {
  report: ParseReport;
}

export function ParseReportView({ report }: Props) {
  const { locale, t } = useI18n();
  const { messagesByKind: k, systemEventsByType: s, format } = report;
  return (
    <div className="report">
      <p><strong>{t(`report_${report.completeness}`)}</strong></p>
      <dl>
        <dt>{t("messages")}</dt>
        <dd>
          {formatCount(report.messages, locale)} ({formatCount(k.text, locale)} {t("text")}, {formatCount(k.media, locale)} {t("media")},{" "}
          {formatCount(k.deleted, locale)} {t("deleted")}, {formatCount(k.unavailable, locale)} {t("unavailable")}
          {report.editedMessages ? `, ${formatCount(report.editedMessages, locale)} ${t("x_edited")}` : ""})
        </dd>
        <dt>{t("report_system")}</dt>
        <dd>
          {formatCount(report.systemEvents, locale)} ({formatCount(s.group, locale)} {t("report_group")}, {formatCount(s.call, locale)} {t("report_call")}, {formatCount(s.encryption, locale)} {t("report_notice")},{" "}
          {formatCount(s.security, locale)} {t("report_security")}, {formatCount(s.disappearing, locale)} {t("report_disappearing")}, {formatCount(s.unknown, locale)} {t("report_unknown")})
        </dd>
        <dt>{t("report_skipped")}</dt><dd>{formatCount(report.skippedRecords, locale)}</dd>
        <dt>{t("report_lines")}</dt>
        <dd>
          {formatCount(report.totalLines, locale)} ({formatCount(report.continuationLines, locale)} {t("report_continuation")},{" "}
          {formatCount(report.blankLines, locale)} {t("report_blank")})
        </dd>
        <dt>{t("report_format")}</dt>
        <dd>
          {format.platform === "android" ? "Android" : format.platform === "ios" ? "iPhone" : t(format.platform === "mixed" ? "report_mixed" : "report_unknownPlatform")}, {t(format.dateOrder === "dmy" ? "dayFirst" : format.dateOrder === "mdy" ? "monthFirst" : "report_yearFirst")} ({t(`report_${format.dateOrderCertainty}`)}), {t(format.clock === "12h" ? "report_clock12" : format.clock === "24h" ? "report_clock24" : "report_mixed")}
        </dd>
      </dl>
      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((w) => (
            <li key={w.code}>
              {describeWarning(w.code, w.count, locale)}
              {w.sampleLines.length > 0 && <span className="muted"> ({t("report_line")} {w.sampleLines.map((n) => formatCount(n, locale)).join(", ")})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
