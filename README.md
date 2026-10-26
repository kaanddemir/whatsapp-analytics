# WhatsApp Analytics

<div align="center">
  <img src="public/favicon.svg" alt="WhatsApp Analytics Logo" width="120" />

**A analytics dashboard for WhatsApp chat exports, running entirely in your browser.**
</div>

## What Is WhatsApp Analytics?

WhatsApp Analytics reads a chat exported from WhatsApp and shows who wrote, when and how much, with charts. The file is processed on your device; there is no server and the chat is never uploaded.

## What Can It Do?

- Reads iPhone and Android exports as `.txt` or `.zip` (device-dependent memory limits apply; media files inside a zip are ignored).
- Recognises English and Turkish export formats, 12 h and 24 h clocks, and UTF-8 and UTF-16 encodings.
- Shows message counts, a timeline, a weekly heatmap, hourly and weekday activity, media types, emojis, keywords, message balance and response times.
- The Ask engine answers natural Turkish and English questions about trends in activity, reply times, message shares and conversation starters when enough data is available; there is no separate dashboard card.
- **Ask**, beside Overview, is a conversation with the deterministic engine: counts, comparisons drawn to scale, changes over time, dates and the cited messages, each openable in context. It shares Overview's participant and date filters, says how each answer was obtained (counted, word match, phrase rules or related by meaning) and offers optional e5-small search by meaning. It calculates and retrieves; it does not generate answers.
- Can show the timeline, hourly and weekday charts as data tables.
- Filters by participant and date range.
- Turns the whole chat into an animated **Recap** story with four chapters and a finale.
- A **demo** opens a synthetic chat of three friends, generated in the interface language, so Overview, Ask and Recap can be tried without a real export. It goes through the same import and engine, is labelled as a demo and is never saved.
- Ends the Recap with a 1080 × 1920 PNG poster, with an option to hide names.
- Offers an English and Turkish interface with Auto, Light and Dark appearance.

## How Does It Work?

1. You drop an exported chat file onto the page.
2. The file is decoded and parsed into messages inside a Web Worker.
3. The analytics engine calculates statistics for the selected filters.
4. The interface shows the results in Overview and the Recap.
5. The chat stays in memory unless you choose to keep it on this device. Saved chats can be reopened or deleted from browser-local storage.

The production build ships a Content Security Policy with `connect-src 'self'`. The app has no analytics, tracking, external fonts or third-party scripts. Language and appearance preferences are stored in the browser. Keeping chats is opt-in; optional semantic search also caches verified model files and can retain indexes for saved chats. Model files come from the same site; chat content stays on your device.

## Technologies

- **Interface:** React 18, TypeScript, Vite 6
- **Charts:** Chart.js 4 and SVG
- **Processing:** Web Workers, the browser's `DecompressionStream` API and opt-in Origin Private File System storage
- **Semantic retrieval:** multilingual-e5-small with Transformers.js and ONNX Runtime Web
- **Tests:** Vitest, Testing Library, jsdom
- **Deployment:** GitHub Actions and GitHub Pages

## Setup

Requirements:

- Node.js 22

Install dependencies and start the development server:

```bash
npm ci --ignore-scripts
npm run dev
```

The app opens at `http://localhost:5173/whatsapp-analytics/`.

Basic checks:

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run preview
```

Dependency install scripts are disabled; the browser build uses the runtime artifacts included in the locked packages. Tests use synthetic chat samples only. Semantic retrieval requires the pinned model files in `SEMANTIC_MODELS_DIR` (default `~/.cache/wa-phase2/models`). Without them, local builds support keyword search; deployment requires the model. See [architecture and validation notes](docs/ARCHITECTURE.md) for model preparation, opt-in checks and limitations. The build uses the `/whatsapp-analytics/` base path for GitHub Pages; set `BASE_PATH=/` for a root domain.

Deployment is manual only: Actions → **Deploy to GitHub Pages** → **Run workflow**. Before the first run, set Settings → Pages → Source to **GitHub Actions**.

## Project Structure

```text
WhatsApp Analytics/
├── src/
│   ├── io/              # file reading, decoding and zip extraction
│   ├── parser/          # WhatsApp text to messages
│   ├── analytics/       # statistics, trend analysis and date presets
│   ├── conversation/    # chat session, lazy caches and evidence contracts
│   ├── ask/             # unified question routing and deterministic answers
│   ├── search/          # keyword retrieval
│   ├── semantic/        # e5-small embedding, vectors and ranking
│   ├── behaviour/       # validated wording rules and counts
│   ├── events/          # date mentions and plan-message grouping
│   ├── store/           # opt-in browser-local chat persistence
│   ├── i18n/            # shared localization and formatting
│   ├── text/            # shared Turkish/English text processing
│   ├── worker/          # analysis worker transport and orchestration
│   ├── model/           # shared types
│   └── ui/              # Overview, Ask, Recap, charts and translations
├── tests/               # regressions, synthetic samples and parity records
├── scripts/             # checks, model preparation and guarded benchmarks
├── docs/                # concise architecture and validation reference
├── public/              # icon and theme bootstrap
└── .github/workflows/   # manually triggered GitHub Pages deployment
```

## Data Sources

The app reads only the export file you choose. WhatsApp does not document this format, and it varies by platform, language and version, so results can be incomplete or inaccurate. Lines that could not be read, or where an assumption was made, are listed in the Chat info dialog. Semantic results can be unrelated; wording counts and recent changes do not establish intent or explain why something happened.

## License

The project is available under the [MIT License](LICENSE). For the WhatsApp trademark and data accuracy, see the [disclaimer](DISCLAIMER.md). Semantic retrieval uses [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), whose base model declares the MIT license; the ONNX export is pinned by revision and checksum in source. The Recap typeface, Bricolage Grotesque, is licensed under the [SIL Open Font License](src/ui/recap/fonts/OFL.txt).

<div align="center">
  <p>Developed by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
