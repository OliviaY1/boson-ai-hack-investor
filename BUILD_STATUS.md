# Build status

Spec: `backend/Diligence_Live_MVP_Brief.md`. Current branch: `claude/relaxed-darwin-45son1` (continues the build merged from `claude/project-thread-si1yt1`).
Legend: **verified** (exercised by a passing check named here), **implemented** (code complete, not exercised end to end), **blocked** (reason given).

## Checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Repo inspection, npm scripts (`dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `demo:seed`, `demo:reset`) | verified | All run in session 2: `dev` (Vite proxies `/api` and `/ws` to the API), `db:migrate`, `demo:seed` (adds a project only when run), `demo:reset` (refuses without `--yes`) |
| SQLite migrations, persistent data dir, no reseed on startup | verified | `tests/journey.test.ts` (two processes, same data dir); manual gate 1 restart kept both projects at the same revisions |
| Committed state events, snapshot + ordered SSE, gap refetch | verified | `state.test.ts` "restores state from a snapshot plus ordered events"; `http.test.ts` SSE cursor |
| Projects, pasted thesis, DOCX ingestion with size/decompression limits | verified | `http.test.ts` planning gate and malformed uploads; `state.test.ts` zip bomb |
| Expert contacts: manual CRUD and CSV import with row errors | verified | `http.test.ts`, `state.test.ts` |
| Planner: source-linked claims, grounded rankings, question revisions, approval, DOCX export | verified | `state.test.ts` planning; `http.test.ts` planning gate; manual gate 1 |
| Re-planning keeps claims with evidence and never reuses or duplicates a claim code | verified | `state.test.ts` "re-planning keeps claims with evidence under their codes" (fixed in session 2: codes used to restart from the active-claim count) |
| Interview controller: validation, atomic apply, stale rejection, one retry on invalid output | verified | `state.test.ts` (invalid model data, human edit during reasoning) |
| Coverage per interview, indirect answers, unknown answers, follow-ups without duplicates | verified | `state.test.ts` adaptive demo, reused plan, unknown answer |
| Evidence comparability, mixed evidence, supersede/invalidate, ASR correction re-extraction | verified | `state.test.ts`, including "does not call a scope mismatch a contradiction" (session 2: the demo's regional vacancy count no longer marks the network staffing claim C5 as contradicted) |
| Findings with review (accept / flag / note + next evidence) and printable HTML report | verified | `state.test.ts`, `http.test.ts`, browser journey, manual gate 1 |
| Consent gate, opt-out, end, late transcripts after end | verified | `state.test.ts`, `voice.protocol.test.ts` |
| Single active interview (transactional guard) | verified | `state.test.ts`, `http.test.ts` racing starts (200 + 409) |
| Access token for consultant APIs and copilot socket; scoped expiring participant links; WS origin check | verified | `http.test.ts` |
| Restart: live interviews marked interrupted, explicit resume, no replay; interruption reason shown in the Live view | verified | `journey.test.ts` (SIGKILL then restart); reason labels added in session 2 (`frontend/src/lib/format.ts`) |
| Memory: instructions, corrections (retire + replace, empty or retired rejected), derived handoffs, "Where were we?" with citations | verified | `state.test.ts` fresh process; `http.test.ts` memory correction; `journey.test.ts`; browser journey |
| Higgs interview session: application-controlled turns, gated speech, stale audio drop, barge-in cancel/flush/truncate, missing transcription | verified against protocol fixtures | `voice.protocol.test.ts` (fake Higgs server) |
| Higgs interview session: response correlation and lifecycle (session 2) | verified against protocol fixtures | `voice.protocol.test.ts`: a question withdrawn before `response.created` is cancelled and its late response is cancelled, never given to the next delivery; provider-initiated responses are cancelled and never forwarded; no `response.create` or commit while a generation is active; a provider that never starts a response leaves the interview interrupted and resumable; a rejoin supersedes the old participant session without interrupting the interview |
| Higgs copilot session (server VAD, one briefing, deduped tool loop, barge-in, isolation from the interview) | verified against protocol fixtures | `voice.protocol.test.ts` |
| Anthropic reasoning adapter (structured outputs, tool loop, fallbacks) | implemented | Request shape re-checked in session 2 against current API guidance (`output_config.effort` + `format`, `fallbacks: "default"` with `server-side-fallback-2026-07-01` for `claude-opus-5-5`, `tool_choice: auto`, top-level `strict` tools, full `content` appended each turn). No `ANTHROPIC_API_KEY`, so no live call |
| Workspace UI: overview, experts, plan, live research, findings, copilot, participant join page | verified | `npm run test:browser` (Chromium, 10 checks, no console errors) |
| Browser audio: AudioWorklet capture, energy VAD, PCM playback with drained reports, barge-in flush, closing line | verified with a fake microphone against a simulated provider | `npm run test:browser-voice` (Chromium fake capture device fed a synthetic voice-like WAV; `tests/e2e/simHiggs.ts`). Not a real microphone, speakers, echo, or the real provider |
| Exclusive microphone ownership between a local participant test and consultant private voice on one device | verified with a fake microphone against a simulated provider | `npm run test:browser-voice` (session 2): claiming private voice stops the respondent tab's capture and pauses the interview; the simulated provider receives no interview audio and no expert turn is created while the consultant holds the mic; stopping voice resumes the interview and the respondent reclaims the mic explicitly |
| Northstar deterministic demo (fixtures, six experts, three recommendations, all 10 steps) | verified | `state.test.ts` adaptive demo; browser journey; manual gate 1 through the API |
| Live Higgs probe script | verified against a simulated endpoint | `npm run probe:live` against `tests/e2e/simHiggs.ts` (session 2): 14 pass, 1 skipped (no Anthropic key) |
| GitHub Actions: credential-free job + live job using the `BOSON_API_KEY` secret | implemented | `.github/workflows/ci.yml` |
| README, `.env.example` | done | |

## Credential-free acceptance (session 2, all passing)

- `npm run typecheck`: clean.
- `npm test`: 4 files, 44 tests (three consecutive runs).
- `npm run build`: UI bundle and server bundle.
- `npm run test:browser`: 10 checks; `npm run test:browser-voice`: 11 checks (two repeat runs each). In this container Playwright's pinned browser build is not installed, so both ran with `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Gate 1 by hand against `npm start` on an empty data directory: created a project, uploaded the sample DOCX and CSV, generated the plan (5 claims, all source-linked; 6 rankings quoting stored backgrounds; 3 recommended), edited a question (revision 2 in the approved snapshot and in the DOCX), approved, exported `plan.docx`; seeded Northstar and ran the operator interview through the API with a private copilot directive (it became a neutral follow-up); both findings cite the operator and the customer; flagged the causal finding with next evidence; exported `report.html` (marked synthetic); restarted the backend; both projects were restored at the same state revisions; the copilot answered "Where were we?" with the flag, next steps, and turn-level citations.

## Live verification

| Check | Status |
| --- | --- |
| Higgs live: session ack, speech output, final transcription, controller after final transcript, barge-in, copilot VAD + tool loop | **blocked**: no `BOSON_API_KEY` in this environment. In session 2 `api.boson.ai` became reachable (HTTP 401 without a key), so `BOSON_API_KEY=... npm run probe:live -- --require-key` can now run from here once a key is provided. In CI the "Live Higgs checks" job needs an Actions repository secret named `BOSON_API_KEY`. |
| Current Boson documentation re-check | **blocked**: `docs.boson.ai` is refused by this environment's proxy and did not resolve from the web-fetch path, so the protocol could not be re-read against the official pages. Third-party integration notes found by search (pipecat-boson, LiveKit plugin) say turn detection is fixed by the first `session.update` (this build sends exactly one) and that the client-driven commit path is less exercised; the session-2 response-lifecycle guards and the probe's "no provider-initiated responses" check cover that risk. |
| Live expert turn through real Anthropic reasoning | **blocked**: no `ANTHROPIC_API_KEY`. Set it and run `npm run probe:live` (adds a real planner call), then run a *Live voice* interview. |
| Real microphone and speaker in a browser | **blocked**: needs a human-operated browser with a microphone. Steps: set both keys, `npm run dev`, start a *Live voice* interview, open the participant link in Chrome, accept the mic prompt, answer a question, talk over the next question (playback must stop at once), and open the copilot voice in the same browser to confirm the interview pauses and the mic switches owner. |

## Notes for a continuing session

- To run the live checks: export `BOSON_API_KEY` (and optionally `ANTHROPIC_API_KEY`), run `npm run probe:live -- --require-key`, and record the JSON summary from `artifacts/live-probe/live-probe.json` here. Watch `interview_no_provider_initiated_responses`: a failure means Boson generates responses even with `turn_detection: null`; the session cancels them, but questions will be delayed.
- To dry-run the probe without a key: start `tests/e2e/simHiggs.ts` (see `startSimHiggs`) and run the probe with `BOSON_API_KEY=sim-key-not-real BOSON_REALTIME_URL=<sim url>`.
- Tests create temporary data directories and never touch `./data`.
- The live probe never logs the key; it scrubs the key from any recorded error text.
