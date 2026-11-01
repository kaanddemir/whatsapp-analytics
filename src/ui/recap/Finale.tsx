/* The finale: the poster preview beside its controls. The preview is the very
   image Save writes, redrawn when the language or the hide-names choice
   changes. A drawing belongs to the choice it was made for, so Save can only
   ever write the image the current choice asks for: until the redraw lands it
   draws its own. Object URLs are revoked once replaced or the scene unmounts.
   Without a 2D canvas the composition falls back to HTML. */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/ui/i18n";
import type { FinaleScene } from "./story";
import { downloadBlob, posterBlob } from "./poster";
import { delay } from "./figures";
import { longName, nameFit } from "./scenes";

interface Preview {
  readonly blob: Blob;
  readonly url: string;
  readonly hideNames: boolean;
}

interface Props {
  scene: FinaleScene;
  hideNames: boolean;
  onHideNames: (hide: boolean) => void;
  onReplay: () => void;
}

export function Finale({ scene, hideNames, onHideNames, onReplay }: Props) {
  const { t } = useI18n();
  const { poster } = scene;
  // null while drawing; "failed" when this browser cannot draw the poster.
  const [preview, setPreview] = useState<Preview | "failed" | null>(null);
  const [status, setStatus] = useState<"rcSaved" | "rcSaveFailed" | null>(null);
  const [saving, setSaving] = useState(false);
  const wanted = useRef(hideNames);
  wanted.current = hideNames;
  const latest = useRef(preview);
  latest.current = preview;

  useEffect(() => {
    let live = true;
    void posterBlob(poster, hideNames).then((blob) => {
      if (!live) return;
      setPreview(blob ? { blob, url: URL.createObjectURL(blob), hideNames } : "failed");
    });
    return () => {
      live = false;
    };
  }, [poster, hideNames]);

  // Revoked only when its replacement is on screen, so the image never goes blank.
  const url = preview && preview !== "failed" ? preview.url : null;
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    let blob: Blob | null;
    let choice: boolean;
    // Repeats if the choice changes mid-draw: what is written always matches what is pressed.
    do {
      choice = wanted.current;
      const ready = latest.current;
      blob = ready && ready !== "failed" && ready.hideNames === choice ? ready.blob : await posterBlob(poster, choice);
    } while (choice !== wanted.current);
    setSaving(false);
    setStatus(blob && downloadBlob(blob) ? "rcSaved" : "rcSaveFailed");
  };

  const title = hideNames ? poster.titleHidden : poster.title;
  const alt = t("rcPosterAlt", { summary: hideNames ? scene.summaryHidden : scene.summary });
  return (
    <div className="rc-scene" data-kind="finale" data-layout="finale">
      <div className="rc-figure">
        {preview === null ? (
          <div className="rc-poster rc-poster-pending" aria-hidden="true" />
        ) : preview !== "failed" ? (
          <img className="rc-poster rc-a-pop" style={delay(100)} src={preview.url} width={1080} height={1920} alt={alt} aria-busy={preview.hideNames !== hideNames} />
        ) : (
          <div className="rc-poster rc-poster-html" role="img" aria-label={alt}>
            <p className="rc-kicker">{poster.kicker}</p>
            <p className="rc-display rc-poster-title"><bdi>{title}</bdi></p>
            <p className="rc-display rc-poster-total">{poster.total}</p>
            <p className="rc-line">{poster.totalUnit} · {poster.detail}</p>
          </div>
        )}
      </div>
      <div className="rc-copy">
        <p className="rc-kicker rc-a-rise">{scene.kicker}</p>
        <h2 className="rc-display rc-headline rc-a-rise" style={{ ...delay(150), ...nameFit(title) }}><bdi className={longName(title) ? "rc-name" : undefined} title={longName(title) ? title : undefined}>{title}</bdi></h2>
        <p className="rc-line rc-muted rc-a-rise" style={delay(250)}>{poster.span}</p>
        <div className="rc-actions rc-a-rise" style={delay(400)}>
          <button type="button" className="rc-button primary" onClick={() => void save()} aria-disabled={saving}>{saving ? t("rcSaving") : t("rcSave")}</button>
          <button type="button" className="rc-button" onClick={onReplay}>{t("rcReplay")}</button>
          <button type="button" className="rc-button" aria-pressed={hideNames} onClick={() => { onHideNames(!hideNames); setStatus(null); }}>{hideNames && <Check size={15} />}{t("rcHideNames")}</button>
        </div>
        <p className="rc-status" role="status">{status ? t(status) : ""}</p>
      </div>
    </div>
  );
}
