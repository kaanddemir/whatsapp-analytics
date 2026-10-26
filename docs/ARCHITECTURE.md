# Architecture

The application processes WhatsApp exports locally in a static React application. Overview, Ask and Recap form the visible application. Ask presents the deterministic Ask pipeline as a conversation and shares Overview's statistics and filters. e5-small supplies optional related-message retrieval; the application does not generate prose with a language model.

## Responsibilities

| Directory | Responsibility |
| --- | --- |
| `src/io/`, `src/parser/` | Validate, decode and parse TXT/ZIP exports with progress and resource limits |
| `src/model/` | Shared message, filter, parse and statistics contracts |
| `src/analytics/` | Statistics, historical date presets and recent-change calculations |
| `src/conversation/` | Reusable `ChatSession`, lazy derived caches, evidence and result contracts |
| `src/ask/` | One typed question router and deterministic answer executor |
| `src/i18n/` | Shared localization and value formatting for worker answers and React presentation |
| `src/search/`, `src/text/` | Keyword index and shared Turkish/English text processing |
| `src/behaviour/`, `src/events/` | Validated wording rules, explicit date mentions and plan-message grouping |
| `src/semantic/` | Pinned e5 embedding worker, verified model files, vectors, indexing and hybrid ranking |
| `src/store/` | Opt-in browser-local source-text persistence |
| `src/worker/` | Analysis worker transport, request handling, cancellation and resource ownership |
| `src/ui/` | Overview, Ask, Recap, shared components, charts, themes and localization |
| `scripts/` | Model preparation, static checks, behavior evaluation and guarded manual benchmarks |
| `tests/` | Unit/integration regressions, synthetic fixtures and frozen calculation parity records |

`main.tsx` starts the UI. `AnalysisClient` creates the analysis worker using a module-relative URL. The handler owns the parsed chat and a `ChatSession`; indexes are built only when requested. The embedding worker has a separate lifetime, so inference does not block analysis requests. Clear/cancel paths release workers and indexing resources. The UI receives summaries and bounded evidence pages, rather than the entire parsed chat. Runtime request validation rejects malformed messages; requests execute in order so asynchronous imports cannot resurrect a cleared chat. The UI client terminates the old worker on replacement/close so a stalled query cannot block closing. Closing aborts model initialization and inference before waiting for completion.

Message IDs index the stably time-sorted parse result. They are stable for identical source text, parser version and date-order choice; changed exports or parsers must not assume the same IDs.

## Processing and storage boundaries

- Production CSP permits connections only to the same origin. Chat content is not uploaded, and there is no content telemetry, cloud inference or external font loading.
- Unsaved chats remain in memory. Saving is opt-in: OPFS stores gzip-compressed source text at `chats/<id>/chat.txt.gz` and writes `manifest.json` last as the commit point. Reopening parses source text again. Interrupted saves are hidden and cleaned up. Origin-private storage is not an encryption or secure physical-erasure guarantee. Saved manifests and decompression lengths are checked against the device budget; stored indexes must pass the vector budget before restoration. Re-parsing controls are withheld after deleting the only saved source copy; the open parsed chat remains usable. Deletion detaches persistence and waits for an in-flight commit before removing data; non-missing-file deletion errors are reported without marking the chat as deleted, and forgetting removes model files even when no index exists.
- A saved chat can retain resumable semantic vectors. Model/text preparation keys invalidate incompatible indexes. Forgetting semantic search removes stored vectors and model files; deleting a saved chat removes its stored index.
- Import estimates are `150 MB + 20 × text bytes`, limited by 40% of reported device memory and 75% of Chromium's reported heap limit. Unknown memory uses conservative fallbacks. Hard ceilings are 512 MiB of text and ZIP size below 4 GiB; ZIP64 is unsupported. ZIP media is ignored. Admission is an estimate, not a guarantee that every accepted export fits every browser. ZIP directories have a separate 16 MiB metadata ceiling; record bounds, methods, extracted size and CRC-32 are checked before accepting text. Stored-entry metadata cannot bypass the text budget. Nested ZIPs are not recursively expanded.
- Model files are pinned by revision and SHA-256, fetched from the app's own origin and streamed to OPFS with pinned byte limits and redirects disabled. Cached bytes are rehashed before use; a checksum sidecar alone is not trusted. WASM runtime assets are bundled. The production embedding path uses one WASM thread; a normal Pages deployment is not cross-origin isolated. Transformers.js remains a shared dependency for feature extraction; its vendor bundle includes upstream model registries, but the application has no generation worker, loader, flags or generation calls.

## Correctness and interpretation limits

Ask statistics use `ChatSession.stats`, backed by the same analytics as Overview. Explicit search remains literal; relative periods, participant filters and evidence paging remain scoped. The existing router accepts named months in either year/month order, bounded Turkish name/month suffixes and messages counted on an explicit calendar day with a stated year. Ambiguous numeric date order is not used for a definite count. Recall framing takes precedence over an incidental exact topic match, including English “where did we talk” requests. Unsupported measurements and questions about feelings or relationships receive a stated limitation. Reasons, decisions and summaries can retrieve related messages, but cannot establish the requested interpretation.

Semantic similarity is evidence retrieval, not proof of relevance or absence. e5-small can rank unrelated questions as highly as answerable ones. The similarity floor removes clear noise and cannot justify “never discussed.” Meaning-only results state this uncertainty; partially indexed chats state their coverage. Turkish-to-English recall is imperfect. Synthetic evaluation does not establish real-chat accuracy.

Behavior results state units, scope, evidence and rates per 100 messages. Turkish proposals and Turkish acceptance can support comparisons of wording-match rates under the catalog's eligibility rules; their wording and notes explicitly limit claims to rule matches tested on synthetic examples. English proposals and acceptance, apologies and cancellations remain wording counts; postponement is unsupported. Rules exclude negation, quotation, meta-discussion and third-person mentions, but do not detect sarcasm. Generic suggestions require a social activity cue; hedged acceptance and tentative cancellation wording are excluded. Acceptance uses the immediately preceding text message from another sender within the existing reply window; it no longer skips an intervening text from the accepting sender to find an older proposal. This favours precision and can miss replies across intervening chatter. Additional categories require private real-chat review, even if synthetic tests pass.

Plan-message timelines join exchanges separated by at most three hours. Tags describe messages, not confirmed/cancelled/final plan states. Missing years, ambiguous numeric dates, ambiguous AM/PM and relative date expressions are not guessed.

Trend analysis is available through natural Turkish and English questions in the unified Ask engine, with no separate Overview card. The shared calculations compare the last 90 days against the previous 90 for periods of at least 180 days, or 30 against 30 for periods of 60–179 days; shorter chats have no comparison. Windows end at the selected period's last day, not today. Activity counts include zero days and all message kinds. A participant filter narrows activity and silence, while interpersonal measures compare people over the selected dates.

- Activity: at least 60 messages across both windows, Mann–Whitney z ≥ 2.58 and totals differing by at least 25% of the larger.
- Reply time: the existing response-gap definition (another participant's message to the next reply, less than 48 hours), at least 20 gaps per window, z ≥ 2.58, median difference ≥ 25% of the larger and ≥ one minute.
- Share: at least 100 human messages per window, two-proportion z ≥ 3.29 and ≥ five percentage points.
- Starters: silence over six hours, at least 20 conversations per window, z ≥ 2.58 and ≥ 15 percentage points. The preceding silence must actually occur before a window's first message, including a message hidden just before the date-filter boundary. Percentage-point gates use unrounded counts; rounding is only for display.
- Silence: at least seven calendar days strictly between active days.

Too little data is “insufficient,” not “steady.” Bursty messages violate independence assumptions; strict thresholds compensate only partly. Overnight replies, minute-resolution timestamps and seasonal effects can influence changes. A change supplies no causal explanation. Topics, rhythm-distribution changes and inferred plan states are unsupported.

## Development and validation

Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run check` and `npm run build`. No separate lint configuration exists: strict TypeScript checks and the project checker cover unused declarations, imports, declared dependencies, runtime cycles, worker/assets and local Markdown links. Synthetic fixtures use `.chat`; personal TXT/ZIP exports are ignored. Frozen Python-engine parity records and documented differences protect existing calculation definitions. Regression tests also cover dashboard filtering, storage lifecycle and behavior evaluation that fails the formal/informal gap gate even when overall precision and recall pass. The held-out behavior fixture's comment was updated and its source checksum renewed; its case body is byte-identical to the pre-cleanup fixture.

The build accepts `BASE_PATH`, `SEMANTIC_MODELS_DIR` and `SEMANTIC_MODELS_REQUIRED=1`. The last setting makes missing model files fail deployment. `scripts/fetch-model.ts` prepares verified model artifacts for CI; do not run it when downloads are prohibited. Local builds without model files retain keyword search. `npm run dev` serves the same model files and ONNX Runtime assets as the build; the ONNX Runtime files are excluded from Vite's dependency optimizer and Transformers.js is optimized at startup (`vite.config.ts`, `tests/infrastructure/devServer.test.ts`). The default model directory remains `~/.cache/wa-phase2/models` for compatibility with already cached files; it contains no project data and is not modified by cleanup.

`scripts/language/evaluate.ts dev|final output.json --model` evaluates separate manually labelled synthetic language fixtures through the same router, detector, session, evidence and answer code. Run model evaluations through the resource guard; only verified local e5-small files are used. The final fixture SHA-256 is frozen in `tests/fixtures/language/integrity.json`; the final command requires its canonical absent output file and is excluded from routine unit tests. JSON results retain the unchanged development baseline, final development results and one held-out run. Small, deliberately difficult corpora diagnose failures; their category/style cells and cross-language samples are too small to establish real-world accuracy or promote behaviour eligibility. Existing precision ≥ 0.90, recall ≥ 0.80 and formal/informal gaps ≤ 0.10 gates remain unchanged. The new exclusions reduce English proposal and acceptance recall on the older blind fixture; English acceptance is restricted to wording counts because its recall no longer passes. No category is promoted on synthetic results alone.

`npm run evaluate:behaviour -- blind` reports current rule accuracy without loading a model. `tests/retrieval/semanticModel.test.ts` is opt-in with `SEMANTIC_MODEL_TEST=1`, uses existing verified local files and never downloads them.

Manual import and e5 benchmarks live in `scripts/benchmarks/`. The conversational retrieval evaluation retains bilingual family splits, difficult held-out cases, ranking metrics, full Ask results and unrelated-query diagnostics. Rejected model configurations and historical ranking variants have been removed. `BENCH_CACHE_ONLY=1` refuses uncached embeddings. Cache keys include model revision and preparation, so incompatible vectors are not reused.

Large evaluations require explicit authorization. Run one workload at a time through `scripts/benchmarks/guard.ts`:

```bash
node_modules/.bin/vite-node scripts/benchmarks/guard.ts -- /tmp/wa-bench.jsonl evaluate --estimate 1400 scripts/benchmarks/semantic/run.ts dev 8000
```

The guard checks pressure, swap growth, available memory, RSS and timeout, kills the process group on breach, and refuses identical retries without a meaningful change. `measure` requires normal pressure; `evaluate` allows warning but stops at critical. Both reserve 512 MB and stop on swap growth over 256 MB. Historical entry aliases, lock name and `PHASE2_ENV_KEY`/`PHASE2_BUDGET_MB` remain compatibility contracts so renaming cannot bypass prior refusal or mutual exclusion. `BENCH_STAGES=1` adds search/behavior/timeline/Ask stages to the import benchmark. Process-killing guard integration tests are opt-in with `BENCH_GUARD_TEST=1`; policy tests run normally.

Security validation uses malicious-input regressions, a clean lockfile install, dependency auditing and a production-build smoke test in an isolated Chrome profile. The development toolchain is pinned to Vite 6.4.5, Vitest 4.1.12 and vite-node 3.2.4 to resolve advisories without changing the React/Vite build stack. Development/preview binds to loopback with cross-origin access disabled, sensitive development paths denied, and the Vitest API/UI disabled. CI disables dependency install scripts, pins Actions to immutable commits, restricts deployment permissions to the deployment job and runs checks before building. The production CSP remains in force; there is no application telemetry, remote chat processing or service worker.

Dashboard integration tests cover direct entry into Overview, shared participant/date filters, Recap and saved-chat lifecycle. Ask routing, localized answers, statistics, retrieval, evidence and worker APIs are tested independently of the interface. The Ask view (`src/ui/ask/`) renders each `Answer` without computing figures: bars come from `AnswerRow.magnitude`, messages are the evidence the engine cited, and paging and context use the existing worker requests. Its tests cover each answer type, scope changes against Overview, stopping (which drops the reply, since cancelling would terminate the worker and its chat), failures, keyboard use, StrictMode and both languages.

Remaining limits: heuristic behavior and change detection have synthetic validation, not private real-chat validation; unrelated semantic results remain possible. Export timestamps are wall-clock values represented in UTC for stable calendar arithmetic; they contain no timezone/DST-offset evidence and cannot establish exact elapsed time across timezone changes. Large-scale benchmarks, the optional Node real-model suite, exhaustive assistive-technology/cross-browser review, actual GitHub Actions execution and Pages hosting remain unverified. The repository is not deployed as part of validation.
