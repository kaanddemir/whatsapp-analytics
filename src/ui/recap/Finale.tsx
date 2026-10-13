/* The finale: the poster preview beside its controls. The preview is the very
   image Save writes, redrawn when the language or the hide-names choice
   changes; object URLs are revoked as soon as they are replaced or the scene
   unmounts. Without a 2D canvas the composition falls back to HTML. */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/context";
import type { FinaleScene } from "./story";
import { downloadBlob, posterBlob } from "./poster";
import { delay } from "./figures";

export function Finale({ scene, onReplay }: { scene: FinaleScene; onReplay: () => void }) {
  const { t } = useI18n();
  const { poster } = scene;
  const [hideNames, setHideNames] = useState(false);
  // null while drawing; "failed" when this browser cannot draw the poster.
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | "failed" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    void posterBlob(poster, hideNames).then((blob) => {
      if (!live) return;
      if (!blob) return setPreview("failed");
      url = URL.createObjectURL(blob);
      setPreview({ blob, url });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [poster, hideNames]);

  const save = async () => {
    setSaving(true);
    const blob = preview && preview !== "failed" ? preview.blob : await posterBlob(poster, hideNames);
    setSaving(false);
    setStatus(blob && downloadBlob(blob) ? t("rcSaved") : t("rcSaveFailed"));
  };

  return (
    <div className="rc-scene rc-family-finale" data-kind="finale" data-layout="finale">
      <div className="rc-figure">
        {preview === null ? (
          <div className="rc-poster rc-poster-pending" aria-hidden="true" />
        ) : preview !== "failed" ? (
          <img className="rc-poster rc-a-pop" style={delay(100)} src={preview.url} width={1080} height={1920} alt={t("rcPosterAlt", { summary: scene.summary })} />
        ) : (
          <div className="rc-poster rc-poster-html" role="img" aria-label={t("rcPosterAlt", { summary: scene.summary })}>
            <p className="rc-kicker">{poster.kicker}</p>
            <p className="rc-display rc-poster-title"><bdi>{hideNames ? poster.titleHidden : poster.title}</bdi></p>
            <p className="rc-display rc-poster-total">{poster.total}</p>
            <p className="rc-line">{poster.totalUnit} · {poster.detail}</p>
          </div>
        )}
      </div>
      <div className="rc-copy">
        <p className="rc-kicker rc-a-rise">{scene.kicker}</p>
        <h2 className="rc-display rc-headline rc-a-rise" style={delay(150)}><bdi>{hideNames ? poster.titleHidden : poster.title}</bdi></h2>
        <p className="rc-line rc-muted rc-a-rise" style={delay(250)}>{poster.span}</p>
        <div className="rc-actions rc-a-rise" style={delay(400)}>
          <button type="button" className="rc-button primary" onClick={() => void save()} disabled={saving}>{saving ? t("rcSaving") : t("rcSave")}</button>
          <button type="button" className="rc-button" onClick={onReplay}>{t("rcReplay")}</button>
          <button type="button" className="rc-button" aria-pressed={hideNames} onClick={() => { setHideNames((h) => !h); setStatus(null); }}>{t("rcHideNames")}</button>
        </div>
        <p className="rc-status" role="status">{status}</p>
      </div>
    </div>
  );
}
