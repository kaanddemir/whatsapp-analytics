# WhatsApp Analytics

<div align="center">
  <img src="app/static/img/favicon.svg" alt="WhatsApp Analytics Logo" width="120" />
</div>

<div align="center">

**An analytics dashboard for WhatsApp chat exports.**

</div>

---

## Overview

WhatsApp Analytics parses an uploaded WhatsApp `.txt` export message by message and returns a single stats payload: KPIs, activity series, timing distributions, content rankings, per-participant metrics, and insight cards. Everything runs on your machine — there is no database, and the export lives in process memory only. An optional AI assistant answers questions about the result, and it sees bounded aggregate statistics rather than raw message text.

Built with Flask, a pure-Python statistics engine, vanilla browser UI assets, Chart.js, and either the Groq API (Cloud) or a loopback LM Studio / Ollama model (Local).

## Core Features

- **Browser Upload Flow**: Drop in a WhatsApp `.txt` export and get the whole dashboard back in one request.
- **KPI Row**: Total messages, active days, messages per active day, and peak hour, each with a monthly trend sparkline.
- **Activity Timeline**: Message volume over time at daily, weekly, or monthly grain, plus date-range and per-participant filters that re-analyze the stored export exactly.
- **Robust Export Parsing**: iOS and Android formats, 12- and 24-hour clocks, English and Turkish exports; D/M/Y vs M/D/Y is decided once per file from unambiguous dates, not per line.
- **Timing Metrics**: Weekday averages, hour-of-day distribution, and a 7x24 weekday/hour heatmap.
- **Content Metrics**: Top-10 full-sequence emoji counts, top-10 Turkish-aware keyword ranking, and a media placeholder breakdown.
- **Participant Metrics**: Message balance with exact-to-100% shares and median reply speed per person.
- **Insight Cards**: Most active 4-hour window, busiest weekday, longest daily streak, conversation starter, and night owl.
- **Statistics-Only Assistant**: The model works from bounded aggregates and declines unsupported claims about exact messages, moments, or topics. Local mode can see a bounded excerpt, but only after you enable it.
- **Bring Your Own Key**: The Groq key is entered in the UI, held in your session on the server, never written to disk, never returned to the browser. A rolling 60-second burst limit guards against a runaway client.

## Current Limitations

- **Single-Process Store**: Stats and the entered key live in process memory, so a restart clears every session, and an abandoned one keeps its memory until `POST /api/reset`.
- **Export-Only Input**: Only WhatsApp `.txt` exports, up to 25 MB; media files are counted as placeholders, not read.
- **Two-Language Stopwords**: Keyword filtering is tuned for English and Turkish exports.
- **No Automatic Fallback**: Cloud and Local are chosen explicitly; neither silently takes over when the other fails. With no key at all the dashboard is fully usable and only Cloud mode is unavailable.
- **Single-User, Loopback Only**: The server binds `127.0.0.1` and runs the single-threaded Werkzeug development server. Do not expose it on a network.

## Tech Stack

- **Backend**: [Flask](https://flask.palletsprojects.com/), [python-dotenv](https://github.com/theskumar/python-dotenv), [Requests](https://requests.readthedocs.io/)
- **Frontend**: Vanilla HTML, CSS, and JavaScript modules, [Chart.js](https://www.chartjs.org/) (vendored, so the app works offline)
- **AI**: [Groq API](https://console.groq.com/), or [LM Studio](https://lmstudio.ai) / [Ollama](https://ollama.com) on loopback
- **Testing**: [pytest](https://docs.pytest.org/)

## Getting Started

Requires Python 3.8+. A Groq key (free at [console.groq.com](https://console.groq.com/keys)) is optional and only needed for the Cloud assistant.

**1. Install.**

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional; the app runs with no .env at all
```

**2. Assistant (optional).** Open **Settings -> AI Provider** and paste a Groq key; it is verified with Groq and held in your session. `GROQ_API_KEY` in `.env` works as a fallback, and the UI key wins over it. For Local mode instead, start LM Studio's **Developer -> Local Server** (keep **Serve on Local Network** off) or run `ollama serve`, load a model, and switch the assistant to **Local** — no key, no internet.

**3. Export a chat.** In WhatsApp: **Menu -> More -> Export chat -> Without media**.

### Run

```bash
python run.py
```

It prints where to open the app and how it is configured:

```text
  WhatsApp Analytics
  ────────────────────────────────────────────
  Open      http://localhost:8000
  Assistant Cloud ready, key from .env
  Sessions  new key each start
  Stop      Ctrl+C
```

Ctrl+C stops it, which also forgets the uploaded chat: it only ever lived in that process.

### Configuration

Every setting is an environment variable read once at startup in `app/config.py`, and every one is optional. Notable ones: `PORT` (8000); `APP_ENV` (`production` sets the Secure cookie flag, so it expects HTTPS in front); `FLASK_SECRET` (random per process, so sessions do not survive a restart); `ENABLE_DEBUGGER` (off — the Werkzeug debugger executes code submitted through the browser); `GROQ_MODEL` / `GROQ_MODELS` (a preference and the picker list, with fallback if Groq stops serving a model); `AI_RATE_PER_MIN` (10); and `LOCAL_LLM_PROVIDER` / `LOCAL_LLM_BASE_URL` (`auto` probes :1234 then :11434; non-loopback URLs are rejected at startup).

Token budgets, timeouts, temperatures, and excerpt caps are documented with their defaults in [.env.example](.env.example). Invalid numeric values fail at startup rather than silently applying an unintended limit.

## Project Structure

```text
whatsapp-analytics/
├── app/
│   ├── __init__.py       # Flask app factory, blueprint registration
│   ├── config.py         # Environment-derived settings
│   ├── analyzer/         # parse → volume, timing, content, people → analyze()
│   ├── routes/           # views (dashboard), api (upload/stats/range/recap/reset/key), chat (Cloud + Local)
│   ├── services/         # per-session store, burst quota, groq_client, local_client
│   ├── static/           # css, js modules, vendored chart.umd.min.js, img
│   └── templates/        # index.html (dashboard) + recap.html (Recap story)
├── tests/                # analyzer, api, chat, edge cases, recap layout
├── .env.example          # Every setting with its default, documented
├── run.py                # Entrypoint: python run.py, Ctrl+C stops it
└── DISCLAIMER.md         # WhatsApp trademark and usage notice
```

## Data Storage

There is no database: everything below lives in process memory and is gone when the server stops.

- **Uploaded Chats**: Never written to disk, keyed by a session id in a signed cookie. Clear from Settings -> Data & Privacy, or `POST /api/reset`.
- **Cloud AI Payload**: A bounded statistics summary, the question, and successful Cloud turns. Raw messages are never sent to Groq.
- **Local AI Payload**: Only after explicit consent, a bounded message excerpt goes to the LM Studio or Ollama server on the same computer; turning the toggle off revokes that access and clears the local transcript.
- **Assistant Transcript**: Cloud and Local keep separate, server-owned transcripts. Uploading, filtering, or deleting a chat clears both.

## API

- `GET /` — dashboard UI
- `GET /api/stats` — current stats for this session
- `POST /api/upload` — `multipart/form-data`, field `file`: a `.txt` export up to 25 MB
- `POST /api/range` — `start` / `end` (inclusive `YYYY-MM-DD`, empty means no bound) and `sender` to narrow volume stats to one participant
- `GET /api/recap` — whole-chat stats for the Recap story, ignoring the active filters
- `POST /api/reset` — forget this session's chat (the Groq key is deliberately kept)
- `POST /api/chat` — Cloud assistant, field `message`
- `POST /api/chat/local` — local-only assistant; never reaches Groq
- `POST /api/chat/reset` — clear both transcripts, keeping the chat and the key
- `/api/settings/groq-key` (`GET`, `POST`, `DELETE`) — key status (never the key itself), verify and hold, drop
- `/api/chat/cloud/models`, `/api/chat/local/models` and the matching `.../model` endpoints — what each provider actually serves, and the choice
- `POST /api/chat/local/enable`, `/api/chat/local/disable` — grant or revoke raw-excerpt access

Upload and range answer with the whole payload; the assistant answers with `{ "reply": "…" }`.

```json
{
  "loaded": true,
  "stats": {
    "meta": {}, "kpis": {}, "messages_over_time": {}, "hours": [], "heatmap": [],
    "top_emojis": [], "top_keywords": [], "media": {}, "insights": {}
  }
}
```

Errors return `{"error": "...", "reason": "..."}`, with reasons such as `too_long`, `rate_limit`, `not_configured`, `invalid_key`, and, for Local mode, `local_unavailable`, `local_no_model`, and `local_timeout`. Failed AI calls do not enter the transcript, and a legacy `history` field is ignored, so a client cannot forge assistant context.

## Testing

```bash
pytest                                                        # full suite
pytest tests/test_analyzer.py tests/test_api.py tests/test_chat.py   # analyzer and API contract
```

## Runtime Notes

- Filtered statistics are recomputed from the stored export on every filter change, so filtered views are exact rather than derived from cached aggregates.
- Interaction metrics (reply speed, message balance, conversation starter) stay computed on the whole conversation even under a participant filter.
- The whole-chat analysis behind the Recap story is computed once per upload and reused, so opening the story does not re-parse a large export.
- Statistics, assistant history, and user text are treated as untrusted data in the AI prompt, with an explicit guard against embedded instructions.
- The assistant answers in the language of the latest question, defaulting to Turkish when that is unclear. Dashboard controls and API errors stay English.
- Keywords are frequency signals, not verified topics. The assistant does not infer message content, intent, sentiment, or relationships from aggregate data.
- With no export loaded, `POST /api/chat` answers with an upload instruction rather than calling Groq.

## License

This project is licensed under the MIT License ([LICENSE](LICENSE)). Chart.js is vendored under `app/static/vendor/` and is MIT licensed as well.

WhatsApp is a trademark of Meta Platforms, Inc.; see [DISCLAIMER](DISCLAIMER.md).

## Footer

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
