# Build status

Spec: `backend/Diligence_Live_MVP_Brief.md`. Branch: `claude/project-thread-si1yt1`.
Legend: **verified** (exercised by a passing check named here), **implemented** (code complete, not exercised end to end), **blocked** (reason given).

## Checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Repo inspection, npm scripts (`dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `demo:seed`, `demo:reset`) | verified | `npm run build`, `npm test`; scripts run locally |
| SQLite migrations, persistent data dir, no reseed on startup | verified | `tests/journey.test.ts` (two processes, same data dir) |
| Committed state events, snapshot + ordered SSE, gap refetch | verified | `state.test.ts` "restores state from a snapshot plus ordered events"; `http.test.ts` SSE cursor |
| Projects, pasted thesis, DOCX ingestion with size/decompression limits | verified | `http.test.ts` planning gate and malformed uploads; `state.test.ts` zip bomb |
| Expert contacts: manual CRUD and CSV import with row errors | verified | `http.test.ts`, `state.test.ts` |
| Planner: source-linked claims, grounded rankings, question revisions, approval, DOCX export | verified | `state.test.ts` planning; `http.test.ts` planning gate |
| Interview controller: validation, atomic apply, stale rejection, one retry on invalid output | verified | `state.test.ts` (invalid model data, human edit during reasoning) |
| Coverage per interview, indirect answers, unknown answers, follow-ups without duplicates | verified | `state.test.ts` adaptive demo, reused plan, unknown answer |
| Evidence comparability, mixed evidence, supersede/invalidate, ASR correction re-extraction | verified | `state.test.ts` |
| Findings with review (accept / flag / note + next evidence) and printable HTML report | verified | `state.test.ts`, `http.test.ts`, browser journey |
| Consent gate, opt-out, end, late transcripts after end | verified | `state.test.ts`, `voice.protocol.test.ts` |
| Single active interview (transactional guard) | verified | `state.test.ts`, `http.test.ts` racing starts (200 + 409) |
| Access token for consultant APIs and copilot socket; scoped expiring participant links; WS origin check | verified | `http.test.ts` |
| Restart: live interviews marked interrupted, explicit resume, no replay | verified | `journey.test.ts` (SIGKILL then restart) |
| Memory: instructions, derived handoffs, "Where were we?" with citations | verified | `state.test.ts` fresh process; `journey.test.ts`; browser journey |
| Higgs interview session (application-controlled turns, gated speech, stale audio drop, barge-in cancel/flush/truncate, missing transcription) | verified against protocol fixtures | `voice.protocol.test.ts` (fake Higgs server) |
| Higgs copilot session (server VAD, one briefing, deduped tool loop, barge-in, isolation from the interview) | verified against protocol fixtures | `voice.protocol.test.ts` |
| Anthropic reasoning adapter (structured outputs, tool loop, fallbacks) | implemented | no `ANTHROPIC_API_KEY` available; the live probe checks one planner call when the key is set |
| Workspace UI: overview, experts, plan, live research, findings, copilot, participant join page | verified | `npm run test:browser` (Chromium, 10 checks, no console errors) |
| Browser audio: AudioWorklet capture, energy VAD, PCM playback with drained reports, barge-in flush, closing line | verified with a fake microphone against a simulated provider | `npm run test:browser-voice` (Chromium fake capture device fed a synthetic voice-like WAV; `tests/e2e/simHiggs.ts`). Not a real microphone, speakers, echo, or the real provider |
| Exclusive microphone ownership between participant test and consultant voice on one device | implemented | BroadcastChannel ownership in `frontend/src/audio/micOwnership.ts`; not exercised in a browser |
| Northstar deterministic demo (fixtures, six experts, three recommendations, all 10 steps) | verified | `state.test.ts` adaptive demo; browser journey |
| Live Higgs probe script | verified against a simulated endpoint | `npm run probe:live` dry run: 14 pass, 1 skipped (no Anthropic key) |
| GitHub Actions: credential-free job + live job using the `BOSON_API_KEY` secret | implemented | `.github/workflows/ci.yml`; first run happens on the pull request |
| README, `.env.example` | done | |

## Live verification

| Check | Status |
| --- | --- |
| Higgs live: session ack, speech output, final transcription, controller after final transcript, barge-in, copilot VAD + tool loop | **blocked**: `api.boson.ai` is unreachable from the build environment (proxy 403), so the probe runs in the GitHub Actions "Live Higgs checks" job. On CI runs 1 (two attempts) and 2 of PR #1 the job received an empty `BOSON_API_KEY`, so no live call was made. It needs an Actions *repository* secret named `BOSON_API_KEY` (or the job pointed at the environment that holds it). |
| Live expert turn through real Anthropic reasoning | **blocked**: no `ANTHROPIC_API_KEY` provided. Set it as a repository secret and add it to the live job's `env`, or run `npm run probe:live` locally with both keys. |
| Real microphone and speaker in a browser | **blocked**: needs a human-operated browser with a microphone. Steps: set both keys, `npm run dev`, start a *Live voice* interview, open the participant link in Chrome, accept the mic prompt, answer a question, talk over the next question (playback must stop at once), and open the copilot voice in the same browser to confirm the interview pauses and the mic switches owner. |

## Notes for a continuing session

- To continue the live verification from a session that can reach `api.boson.ai`: export `BOSON_API_KEY`, run `npm run probe:live -- --require-key`, and record the JSON summary here.
- Tests create temporary data directories and never touch `./data`.
- The live probe never logs the key; it scrubs the key from any recorded error text.
