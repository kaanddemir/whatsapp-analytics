# WhatsApp Analytics

<div align="center">
  <img src="app/static/img/favicon.svg" alt="WhatsApp Analytics Logo" width="120" />
</div>

<div align="center">

**An analytics dashboard for WhatsApp chat exports.**

</div>

---

## Overview

WhatsApp Analytics is a chat-export analysis tool built with Flask, vanilla browser UI assets, Chart.js, and a small pure-Python statistics engine.

The app parses an uploaded WhatsApp `.txt` export message by message and returns a single stats payload with KPIs, activity series, timing distributions, content rankings, per-participant metrics, and insight cards. An optional AI assistant answers questions about the result through the Groq API.

## Core Features

### Chat Dashboard

- **Browser Upload Flow**: Upload a WhatsApp `.txt` export from the browser UI.
- **KPI Row**: Total messages, active days, messages per active day, and peak hour, each with a monthly trend sparkline.
- **Activity Timeline**: Review message volume over time at daily, weekly, or monthly grain.
- **Range and Participant Filters**: Re-analyze any date window or narrow the volume stats to one person.

### Analysis Engine

- **Export Parsing**: Handles iOS and Android formats, 12- and 24-hour clocks, and English and Turkish exports.
- **Date Order Detection**: Decides D/M/Y vs M/D/Y once per file from unambiguous dates instead of per line.
- **Timing Metrics**: Weekday averages, hour-of-day distribution, and a 7x24 weekday/hour heatmap.
- **Content Metrics**: Top-10 full-sequence emoji counts, top-10 Turkish-aware keyword ranking, and a media placeholder breakdown.
- **Participant Metrics**: Message balance with exact-to-100% shares and median reply speed per person.
- **Insight Cards**: Most active 4-hour window, busiest weekday, longest daily streak, conversation starter, and night owl.

### Runtime Model

- **On-Device Parsing**: Chat parsing and all statistics run on the user's machine.
- **No Backend Database**: Uploads live in process memory only and are never written to disk.
- **Bring Your Own Key**: Cloud mode uses a Groq key you enter yourself, held in your session on the server and never written to disk. A rolling 60-second burst limit guards against a runaway client.
- **Statistics-Only Assistant**: The assistant works from bounded aggregate statistics, not raw message text; it clearly declines unsupported claims about exact messages, moments, or topics.
- **Optional AI**: With no key at all, the dashboard works fully and only Cloud mode is unavailable. Local mode needs no key and no internet connection.

## Current Limitations

- **Single-Process Store**: Stats live in process memory, so a restart clears every session.
- **Export-Only Input**: The analyzer supports WhatsApp `.txt` exports; media files are counted as placeholders, not read.
- **Two-Language Stopwords**: Keyword filtering is tuned for English and Turkish exports.
- **Upload Size Cap**: Uploads are limited to 25 MB.
- **Session-Scoped API Key**: The Groq key entered in Settings lives in server memory, so restarting the app requires entering it again.
- **No Automatic Fallback**: Cloud and Local are chosen explicitly; neither silently takes over when the other fails.
- **No Session Eviction**: An abandoned session keeps its memory until `POST /api/reset` or a restart.
- **Single-User, Loopback Only**: The server binds `127.0.0.1` and runs the single-threaded Werkzeug development server. Do not expose it on a network.

## Tech Stack

- **Backend**: [Flask](https://flask.palletsprojects.com/)
- **Configuration**: [python-dotenv](https://github.com/theskumar/python-dotenv)
- **HTTP Client**: [Requests](https://requests.readthedocs.io/)
- **Charts**: [Chart.js](https://www.chartjs.org/)
- **AI**: [Groq API](https://console.groq.com/)
- **Frontend**: Vanilla HTML, CSS, and JavaScript modules
- **Testing**: [pytest](https://docs.pytest.org/)

## Getting Started

### Requirements

- Python 3.8+
- Dependencies from `requirements.txt`
- A `.env` file created from `.env.example` (optional; the app runs without one)
- A Groq API key for the Cloud assistant (optional; free at [console.groq.com](https://console.groq.com/keys)) — added from the UI, not a file
- Optionally [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com) for Local mode

To export a chat from WhatsApp: open the conversation, then **Menu -> More -> Export chat -> Without media**.

### Setup

1. **Create and activate a virtual environment**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Create the environment file**
   ```bash
   cp .env.example .env
   ```

4. **Add a Groq API key (optional)**

   Open **Settings -> AI Provider** and paste your key; it is verified with Groq,
   held in your session, and never written to disk. Setting `GROQ_API_KEY` in
   `.env` works too, and the UI key wins over it. Without any key the dashboard
   is fully usable and only Cloud mode is unavailable.

5. **Use a local model instead (optional)**

   Start LM Studio's local server or run `ollama serve`, load a model, then
   switch the assistant to **Local**. No API key, no internet connection.

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

Ctrl+C stops it, which also forgets the uploaded chat: it only ever lived in
that process.

### Configuration

Settings are environment variables, read once at startup in `app/config.py`.
Every one is optional: the app runs with no `.env` at all.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8000` | Port the server listens on. |
| `APP_ENV` | `development` | `production` sets the Secure cookie flag, so it expects HTTPS in front of the app. |
| `FLASK_SECRET` | random per process | Session signing key. Left unset, a new one is generated at every start, so sessions do not survive a restart. |
| `ENABLE_DEBUGGER` | `0` | Opt-in only. The Werkzeug debugger executes code submitted through the browser. |
| `LOG_LEVEL` | `INFO` | `DEBUG` also turns per-request logging back on. |
| `GROQ_API_KEY` | empty | Optional fallback key. A key entered in Settings takes precedence. |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Preferred model, and only a preference: the assistant falls back if Groq no longer serves it. |
| `GROQ_MODELS` | four curated ids | Which models the picker offers, in listing order. Empty offers every chat model Groq serves. |
| `AI_RATE_PER_MIN` | `10` | AI requests allowed in any rolling 60-second window. |
| `LOCAL_LLM_PROVIDER` | `auto` | `auto`, `lmstudio`, or `ollama`. `auto` probes :1234 then :11434. |
| `LOCAL_LLM_MODEL` | empty | Optional default. Empty means the user picks from the loaded models. |
| `LOCAL_LLM_BASE_URL` | unset | Pins one endpoint. Loopback addresses only; this is enforced at startup. |

Token budgets, timeouts, temperatures, and excerpt caps are documented with their
defaults in [.env.example](.env.example). Invalid numeric values fail at startup
rather than silently applying an unintended limit.

## Project Structure

```text
whatsapp-analytics/
├── app/
│   ├── __init__.py           # Flask app factory, blueprint registration
│   ├── config.py             # Environment-derived settings
│   ├── analyzer/
│   │   ├── __init__.py       # analyze(), the full stats pipeline
│   │   ├── patterns.py       # Export regexes, marker lists, stopwords
│   │   ├── utils.py          # Turkish lowercasing, percentage and duration helpers
│   │   ├── parsing.py        # Export text to sorted message records
│   │   ├── metrics.py        # Volume, timing, and content metrics
│   │   ├── people.py         # Per-participant metrics and insight cards
│   │   └── summary.py        # Compact stats summary for the AI prompt
│   ├── routes/
│   │   ├── __init__.py       # Blueprint exports
│   │   ├── views.py          # Dashboard page
│   │   ├── api.py            # Upload, stats, range, recap, reset, API key
│   │   └── chat.py           # AI assistant endpoints, Cloud and Local
│   ├── services/
│   │   ├── __init__.py
│   │   ├── store.py          # Per-session in-memory chat and stats store
│   │   ├── quota.py          # Burst rate limit
│   │   ├── groq_client.py    # Prompt assembly and the Groq call
│   │   └── local_client.py   # Loopback LM Studio / Ollama model, opt-in raw analysis
│   ├── static/               # Browser UI assets
│   │   ├── css/
│   │   │   ├── styles.css    # Dashboard
│   │   │   └── recap.css     # Recap story
│   │   ├── js/
│   │   │   ├── main.js       # Entry module, wires the dashboard together
│   │   │   ├── state.js      # Shared client state
│   │   │   ├── upload.js     # Upload flow
│   │   │   ├── dashboard.js  # KPI row and card rendering
│   │   │   ├── charts.js     # Chart.js setup
│   │   │   ├── filters.js    # Date range and participant filters
│   │   │   ├── lists.js      # Emoji, keyword and participant lists
│   │   │   ├── chat.js       # Assistant panel
│   │   │   ├── panels.js     # Settings and side panels
│   │   │   ├── popover.js    # Popover primitive
│   │   │   ├── card-info.js  # Per-card explanations
│   │   │   ├── icons.js      # Inline SVG icons
│   │   │   ├── util.js       # Formatting helpers
│   │   │   └── recap.js      # Recap story
│   │   ├── vendor/           # chart.umd.min.js, vendored so the app works offline
│   │   └── img/              # favicon.svg, doodles.svg
│   └── templates/
│       ├── index.html        # The dashboard page
│       └── recap.html        # The Recap story deck, included by index.html
├── tests/
│   ├── test_analyzer.py      # Parsing and stats pipeline
│   ├── test_api.py           # Upload, range, recap, reset, settings endpoints
│   ├── test_chat.py          # Cloud and Local assistant contract
│   ├── test_edge_cases.py    # Malformed and boundary exports
│   └── test_recap_layout.py  # Recap story payload and layout
├── .env.example              # Every setting with its default, documented
├── requirements.txt
├── run.py                    # Entrypoint: python run.py, Ctrl+C stops it
├── LICENSE                   # MIT
├── DISCLAIMER.md             # WhatsApp trademark and usage notice
└── README.md
```

## Data Storage

WhatsApp Analytics is local-first. There is no database: everything below lives
in process memory and is gone when the server stops.

- **Uploaded Chats**: Never written to disk, keyed by a session id in a signed cookie.
- **Clearing Data**: Settings -> Data & Privacy -> delete, or `POST /api/reset`.
- **Cloud AI Payload**: A bounded statistics summary, the question, and successful Cloud turns. Raw messages are never sent to Groq.
- **Local AI Payload**: Only after explicit consent, a bounded message excerpt goes to the LM Studio or Ollama server on the same computer.
- **API Key**: Held for the session that entered it, never written to disk and never returned to the browser.
- **Assistant Transcript**: Cloud and Local keep separate transcripts. Uploading, filtering, or deleting a chat clears both.

## Routes

- `GET /` - dashboard UI
- `GET /api/stats` - current stats for this session
- `POST /api/upload` - chat export upload and analysis
- `POST /api/range` - re-analysis with date and participant filters
- `GET /api/recap` - whole-chat stats for the Recap story, ignoring the active filters
- `POST /api/reset` - forget this session's chat
- `POST /api/chat` - Cloud assistant
- `POST /api/chat/local` - local-only assistant; never reaches Groq
- `POST /api/chat/reset` - clear both transcripts, keeping the chat and the key
- `GET`, `POST`, `DELETE` `/api/settings/groq-key` - key status (never the key itself), verify and hold, drop
- `GET`, `POST` `/api/chat/cloud/models`, `/api/chat/cloud/model` - what Groq serves for this key, and the choice
- `GET`, `POST` `/api/chat/local/models`, `/api/chat/local/model` - what LM Studio or Ollama has loaded, and the choice
- `POST /api/chat/local/enable`, `/api/chat/local/disable` - grant or revoke raw-excerpt access

## Upload API

| Endpoint | Field | Notes |
| --- | --- | --- |
| `POST /api/upload` (`multipart/form-data`) | `file` | Required. WhatsApp `.txt` export, up to 25 MB. |
| `POST /api/range` (JSON) | `start`, `end` | Inclusive ISO dates, `YYYY-MM-DD`. Empty means no bound. |
| | `sender` | Narrows volume stats to one participant present in the chat. |
| `POST /api/chat` (JSON) | `message` | Required. Longer than `AI_MAX_MESSAGE_CHARS` is rejected with `reason: too_long`. |

The transcript is server-owned: a legacy `history` field is ignored, so a client cannot forge assistant context.

### Cloud vs Local message analysis

- **Cloud** is the default. It sends bounded aggregate statistics and the current question to Groq, never raw WhatsApp text.
- **Local** receives the same statistics from a model on this computer. Its **Message analysis** toggle is off by default; only once enabled does a bounded excerpt of the selected messages reach the local server, and turning it off revokes that access and clears the local transcript.
- The two modes keep separate transcripts, and neither model id has to be typed: each provider is asked what it actually serves, with an override under Settings -> Models.

To use Local mode, start **Developer -> Local Server** in LM Studio (keep **Serve on Local Network** off) or run `ollama serve`, then load a model. Non-loopback local-model URLs are rejected at startup.

The assistant answers with `{ "reply": "…" }`. Upload and range answer with the
whole payload:

```json
{
  "loaded": true,
  "stats": {
    "meta": {}, "kpis": {}, "messages_over_time": {}, "hours": [], "heatmap": [],
    "top_emojis": [], "top_keywords": [], "media": {}, "insights": {}
  }
}
```

Errors return `{"error": "...", "reason": "..."}`, with reasons such as `too_long`, `rate_limit`, `not_configured`, `invalid_key`, and, for Local mode, `local_unavailable`, `local_no_model`, and `local_timeout`. Failed AI calls do not enter the transcript, and with no export loaded `POST /api/chat` answers with an upload instruction rather than calling Groq.

## Testing

Run the full test suite:

```bash
pytest
```

Useful focused checks while changing the analyzer or the API contract:

```bash
pytest tests/test_analyzer.py tests/test_api.py tests/test_chat.py
```

## Runtime Notes

- Filtered statistics are recomputed from the stored export on every filter change, so filtered views are exact rather than derived from cached aggregates.
- Interaction metrics (reply speed, message balance, conversation starter) stay computed on the whole conversation even under a participant filter.
- Statistics, assistant history, and user text are treated as untrusted data in the AI prompt, with an explicit guard against embedded instructions.
- The assistant answers in the language of the latest question, defaulting to Turkish when that is unclear. Dashboard controls and API errors stay English.
- Keywords are frequency signals, not verified topics. The assistant does not infer message content, intent, sentiment, or relationships from aggregate data.
- The Groq key is deliberately not cleared by `POST /api/reset`: deleting a chat should not mean entering the key again.
- The whole-chat analysis behind the Recap story is computed once per upload and reused, so opening the story does not re-parse a large export.

## License

This project is licensed under the MIT License ([LICENSE](LICENSE)). Chart.js is vendored under `app/static/vendor/` and is MIT licensed as well.

WhatsApp is a trademark of Meta Platforms, Inc.; see [DISCLAIMER](DISCLAIMER.md).

## Footer

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>

---
