# WhatsApp Analytics

<div align="center">
  <img src="public/favicon.svg" alt="WhatsApp Analytics Logo" width="120" />

**A privacy-first analytics dashboard for WhatsApp chat exports, running entirely in your browser.**
</div>

## What Is WhatsApp Analytics?

WhatsApp Analytics reads a chat exported from WhatsApp and shows who wrote, when and how much, with charts. The file is processed on your device; there is no server and the chat is never uploaded.

The project has not been publicly released yet. It is prepared for a manually triggered deployment to GitHub Pages.

## What Can It Do?

- Reads iPhone and Android exports as `.txt` or `.zip` (up to 25 MB of chat text or a 200 MB zip; media files inside a zip are ignored).
- Recognises English and Turkish export formats, 12 h and 24 h clocks, and UTF-8 and UTF-16 encodings.
- Shows message counts, a timeline, a weekly heatmap, hourly and weekday activity, media types, emojis, keywords, message balance and response times.
- Can show the timeline, hourly and weekday charts as data tables.
- Filters by participant and date range.
- Turns the whole chat into an animated **Recap** story with four chapters and a finale.
- Ends the Recap with a 1080 × 1920 PNG poster, with an option to hide names.
- Offers an English and Turkish interface with Auto, Light and Dark appearance.

## How Does It Work?

1. You drop an exported chat file onto the page.
2. The file is decoded and parsed into messages inside a Web Worker.
3. The analytics engine calculates statistics for the selected filters.
4. The interface shows the results in the dashboard and the Recap.
5. The chat is kept in memory only and is discarded when you close the chat or the tab.

The production build ships a Content Security Policy with `connect-src 'self'`. The app has no analytics, tracking, external fonts or third-party scripts. Only the language and appearance preferences are stored in the browser.

## Technologies

- **Interface:** React 18, TypeScript, Vite 5
- **Charts:** Chart.js 4 and SVG
- **Processing:** Web Worker, the browser's `DecompressionStream` API
- **Tests:** Vitest, Testing Library, jsdom
- **Deployment:** GitHub Actions and GitHub Pages

## Setup

Requirements:

- Node.js 22

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

The app opens at `http://localhost:5173/whatsapp-analytics/`.

Basic checks:

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

Tests use synthetic chat samples only. The build uses the `/whatsapp-analytics/` base path for GitHub Pages; set `BASE_PATH=/` for a root domain.

Deployment is manual only: Actions → **Deploy to GitHub Pages** → **Run workflow**. Before the first run, set Settings → Pages → Source to **GitHub Actions**.

## Project Structure

```text
WhatsApp Analytics/
├── src/
│   ├── io/              # file reading, decoding and zip extraction
│   ├── parser/          # WhatsApp text to messages
│   ├── analytics/       # statistics
│   ├── worker/          # Web Worker and its protocol
│   ├── model/           # shared types
│   └── ui/              # dashboard, Recap, charts and translations
├── tests/               # tests, synthetic samples and parity records
├── public/              # icon and theme bootstrap
└── .github/workflows/   # manually triggered GitHub Pages deployment
```

## Data Sources

The app reads only the export file you choose. WhatsApp does not document this format, and it varies by platform, language and version, so results can be incomplete or inaccurate. Lines that could not be read, or where an assumption was made, are listed in the Chat info dialog.

## License

The project is available under the [MIT License](LICENSE). For the WhatsApp trademark and data accuracy, see the [disclaimer](DISCLAIMER.md). The Recap typeface, Bricolage Grotesque, is licensed under the [SIL Open Font License](src/ui/recap/fonts/OFL.txt).

<div align="center">
  <p>Developed by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
