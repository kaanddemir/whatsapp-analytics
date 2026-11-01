/* Mounts the Search settings dialog in one chosen state, in the real page's
   styles, so a browser test can measure states a model would be needed to reach. */
import { createRoot, type Root } from "react-dom/client";
import type { Locale } from "@/i18n/types";
import type { SemanticState } from "@/semantic/indexer";
import { SearchSettings } from "@/ui/components/SearchSettings";
import { I18nProvider } from "@/ui/i18n";

let root: Root | null = null;

export function mount(state: SemanticState, locale: Locale, saved: boolean) {
  root?.unmount();
  let host = document.getElementById("search-states");
  if (!host) {
    host = document.createElement("div");
    host.id = "search-states";
    document.body.append(host);
  }
  root = createRoot(host);
  root.render(
    <I18nProvider initialLocale={locale}>
      <SearchSettings state={state} saved={saved} failed={false} onAction={() => {}} onClose={() => {}} />
    </I18nProvider>,
  );
}
