# Diligence Live

A supervised investment diligence workspace. It turns an investment thesis into source-linked claims, recommends experts with traceable reasoning, runs adaptive expert interviews over Higgs realtime voice, and produces findings that link back to exact transcript spans. A private consultant copilot (text and Higgs voice) can brief, inspect evidence, steer the interview with private directives, and answer "Where were we?" from saved state.

The product spec is [`backend/Diligence_Live_MVP_Brief.md`](backend/Diligence_Live_MVP_Brief.md). Build progress and unresolved items are in [`BUILD_STATUS.md`](BUILD_STATUS.md).

## Quick start (no credentials needed)

Requires Node 20+ (CI uses 22).

```bash
npm install
npm run db:migrate      # creates ./data/diligence.sqlite (also runs automatically at startup)
npm run demo:seed       # adds the fictional Northstar Dental Group project (never runs on normal startup)
npm run dev             # backend on http://127.0.0.1:8787, UI on http://localhost:5173
```

Open http://localhost:5173. Use **Create Northstar demo** (or the seeded project), then **Live Research → Start interview** with the fully synthetic mode and press **Advance scripted respondent** to step through the operator interview. Everything in the demo is labelled *Synthetic*.

Production-style run (one process serves the API, WebSockets and the built UI):

```bash
npm run build           # typecheck + vite build (dist/web) + bundled server (backend/dist/server.js)
npm start               # http://127.0.0.1:8787
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Strict TypeScript for backend, shared code, tests, and frontend |
| `npm test` | Vitest: state transitions, voice protocol fixtures, HTTP/WebSocket boundaries, two-process restart journey |
| `npm run test:browser` | Headless Chromium journey through the built UI (run `npm run build` first; `npx playwright install chromium` once, or set `CHROMIUM_PATH`) |
| `npm run probe:live` | Live Higgs checks against the real endpoint (needs `BOSON_API_KEY`; see below) |
| `npm run demo:reset -- --yes` | Deletes the data directory's database and uploads, then re-seeds the demo |
| `npm run build:fixtures` | Regenerates `fixtures/northstar/northstar_thesis.docx` and `contacts.csv` |

## Modes and credentials

All provider credentials stay on the backend (`.env`, see [`.env.example`](.env.example)); the browser never receives a key or an ephemeral provider credential. The UI shows which modes are available and why.

| Interview mode | Needs | Reasoning | Voice |
| --- | --- | --- | --- |
| Fully synthetic demo | nothing | deterministic mock | none (typed / scripted respondent) |
| Live voice | `BOSON_API_KEY` + `ANTHROPIC_API_KEY` | Anthropic (`REASONING_MODEL`, default `claude-opus-5-5`) | Higgs realtime |
| Live voice + mock reasoning | `BOSON_API_KEY` + `ALLOW_LIVE_VOICE_MOCK_REASONING=true` | deterministic mock (labelled) | Higgs realtime |

The planner and the text copilot use Anthropic when `ANTHROPIC_API_KEY` is set and the deterministic mock otherwise. The voice copilot needs `BOSON_API_KEY`; text chat always works.

## Architecture and data flow

One Node backend (Express 5 + `ws`) and one SQLite database (`better-sqlite3`) in `DATA_DIR`; React 19 + Vite + Tailwind frontend.

```
browser workspace ──HTTP──▶ backend API ──commit()──▶ SQLite (records + state_events)
        ▲                                   │
        └──────────── SSE (ordered state events, revision cursor) ◀──┘

participant page ──WS /ws/participant──▶ InterviewVoiceSession ──WS──▶ Higgs (turn_detection: null)
                                               │ committed turn + final transcript
                                               ▼
                                  InterviewEngine (per-interview queue)
                                  └▶ reasoning provider (Anthropic or mock)
                                     └▶ validate (Zod + semantic checks) ─▶ apply in one transaction
                                        └▶ authorized delivery ─▶ response.create with the question

consultant copilot ──WS /ws/copilot──▶ CopilotVoiceSession ──WS──▶ Higgs (server_vad, scoped tools)
```

- **Records and events.** Every change goes through `commit()` (`backend/src/domain/events.ts`): one SQLite transaction that bumps the project's state revision and writes a `state_events` row carrying the upserted records. The UI loads a snapshot, then applies SSE events strictly in revision order (`shared/applyEvent.ts`), refetching the snapshot if it sees a gap. Restarting the browser or backend restores from the database.
- **Planning** (`domain/planning.ts`): thesis passages from pasted text or DOCX (`ingest/docx.ts`, with size and decompression limits) → planner proposal → validation that every claim cites real passage ids and every ranking quotes the expert's stored background → plan version. Questions are revisioned; approving creates a new approved plan version; `plan.docx` exports it.
- **Interview controller** (`interview/engine.ts`, `domain/controller.ts`): runs after each *final* expert transcript, consultant directive, or research change. The model only proposes; the backend validates quotes as exact spans of the cited turn version, claim links, coverage changes, and the next question, then applies everything atomically or nothing (`rejected_invalid`, one retry). Decisions carry `control_revision`/`generation`; a decision made against stale state (question edited, interview stopped) is rejected as `rejected_stale` and recomputed, so an old question can never be spoken.
- **Evidence** (`domain/evidence.ts`): observations keep basis, period, population, metric and unit; claim assessments only count *comparable* evidence (a single-clinic 12% estimate does not contradict a network churn figure). Corrections supersede or invalidate, never overwrite; ASR corrections create a new turn version and re-extract.
- **Higgs interview voice** (`voice/interviewVoice.ts`): application-controlled turns. Browser VAD (AudioWorklet capture at 24 kHz PCM16, energy VAD with pre-roll and hangover) marks the end of speech → `input_audio_buffer.commit` → wait for `conversation.item.input_audio_transcription.completed` → controller → `response.create` with the authorized question in `response.instructions`. Only audio from the current authorized response is forwarded. Barge-in sends `response.cancel`, flushes browser playback, and truncates the item at the played position; the delivery is recorded as interrupted, never completed. Missing transcriptions lead to a clarification, never an invented answer.
- **Copilot voice** (`voice/copilotVoice.ts`): native server VAD with scoped tools (`domain/copilotTools.ts`). One explicit briefing response; each tool call gets exactly one `function_call_output` and the response gets exactly one continuation. Consultant audio and directives never reach the expert session; directives reach the controller, which rephrases them neutrally. Microphone ownership is exclusive per device (BroadcastChannel), and opening private voice on the same device pauses a local test interview.
- **Memory** (`domain/memory.ts`): durable project instructions, derived session handoffs rebuilt when their dependencies change, and copilot history. "Where were we?" answers from the handoff with citations to transcript turns.

## Persistence, access, and consent

- Data lives in `DATA_DIR` (default `./data`): `diligence.sqlite` plus uploaded files. Normal startup migrates but never resets or reseeds. On restart, interviews that were live are marked *interrupted* and can be resumed explicitly; completed questions are not replayed.
- The backend binds to `127.0.0.1` by default. Set `ACCESS_TOKEN` before exposing it beyond loopback; consultant APIs and the copilot WebSocket then require it. This is a basic shared-token gate, not user accounts or SSO; a public or team deployment also needs TLS and an operational authentication setup.
- Participant links are opaque, expiring, and scoped to one interview. They cannot call consultant APIs and see only their own interview transcript.
- Interviews start with AI identification and a consent request; substantive questions wait for acceptance. Declining or opting out cancels pending model and audio work and ends the session. **Audio is not recorded**; transcripts are retained, and the consent screen says so.
- Only one expert interview can be active across the deployment (enforced by a unique database slot, so concurrent starts get one success and one 409).

## Live verification

`npm run probe:live` runs the real adapters against `BOSON_REALTIME_URL` with `BOSON_API_KEY`, in-process on a temporary data directory: it synthesizes expert and consultant speech with Higgs, plays it into a *live voice + mock reasoning* interview through the participant WebSocket (session ack, intro and question audio, final transcription, controller decision, barge-in cancel/truncate, no provider-initiated responses), then exercises the copilot (server VAD transcription and a tool round trip). Results go to `artifacts/live-probe/live-probe.json`; the key is never printed or written. With `ANTHROPIC_API_KEY` set it also checks one real planner call.

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs the credential-free gates on every push and pull request, and a separate **Live Higgs checks** job that reads the `BOSON_API_KEY` repository secret (pull requests from forks skip it). The job summary shows each check; the JSON is uploaded as an artifact.

Not covered by any automated check: real microphone capture and speaker playback in a human-operated browser, and natural-conversation VAD tuning. See `BUILD_STATUS.md` for the exact remaining steps.

## Material assumptions

- **Higgs protocol.** Event names and session shape follow the Boson realtime docs referenced in the brief (`session.update` with `audio.input.turn_detection: null` for interviews and `server_vad` for the copilot, `higgs-stt-3.1` transcription, 24 kHz PCM16). The session is rejected if the provider acknowledges a non-null `turn_detection` for an interview.
- **Turn ends.** Expert turn ends come from browser VAD, which is the deliberate trade-off for application-controlled questioning; thresholds were tuned on synthetic audio only.
- **Mock reasoning** is scripted for the Northstar fixture (keyed by the fixture turn) and uses a labelled heuristic for other content. It goes through the same validators and transactions as live reasoning and never invents source passages.
- **Anthropic adapter** uses structured JSON outputs (`output_config.format`) for planner and controller and a manual tool loop for the text copilot, with server-side model fallbacks for supported models (`REASONING_FALLBACKS`).
- **Deferred** (not implemented, not shown as features): telephone calling, video, CRM and expert-network connectors, parallel interviews, outreach, billing, SSO.
