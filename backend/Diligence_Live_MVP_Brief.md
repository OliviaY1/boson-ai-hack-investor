# Build Diligence Live: Final Autonomous Build Prompt

**Task:** Implement the complete application described below in the supplied repository. This file is the self-contained build instruction. Begin with repository inspection, then implement, run, verify, and fix the application until the completion gates are satisfied.

**Build model:** Claude Opus 5.5. This identifies the coding agent, not the application's runtime reasoning provider or credentials.

**Release scope:** Persistent full-stack browser MVP with adaptive expert interviews, a private consultant copilot, and evidence-backed findings. One active expert interview at a time.

## 0. Execution contract

You are the senior full-stack engineer responsible for delivering a working product. Use repository tools and the terminal to make the changes. Continue through implementation and verification; a plan, scaffold, static mockup, or collection of disconnected screens is not the deliverable.

- Inspect repository instructions, source, package manifests, scripts, and Git status before editing. Reuse sound existing architecture and dependencies. Preserve unrelated user changes.
- Make routine engineering decisions independently using this brief and the existing repository. Record material assumptions in the README.
- Keep a short implementation checklist in `BUILD_STATUS.md`. Mark each item implemented, verified, or blocked with a specific reason. Preserve enough context there to continue after a context reset.
- Work iteratively within this single initiated task: implement a vertical slice, run relevant checks, fix failures, and continue to the next slice. Progress updates do not replace taking the next available action.
- Missing provider credentials do not block the remaining work. Implement real adapters, deterministic provider substitutes, and protocol tests. Clearly identify which live checks could not be run.
- Use available parallel workers for independent work only when supported by the coding environment; keep shared domain contracts and final integration under one owner.
- Respect the environment's access controls. Ask for input only when a genuine unresolved dependency prevents further useful work, not for routine implementation choices.
- If a Git repository is available, use an appropriate feature branch and commit only this task's changes after verification when local Git permissions and identity permit. Report the branch and commit. Publishing, merging, and contacting real people are outside this task.
- Finish with evidence of the completed workflow, exact run commands, checks executed, and remaining credential-dependent verification. Do not label a live integration verified merely because it compiles.

Here, one-shot means one complete instruction launches the build-and-verification process. It does not require the implementation to fit in one text response or one model invocation.

## 1. Product objective

Build a supervised investment diligence workspace that turns an investment thesis into testable claims, selects appropriate experts, conducts adaptive interviews, and produces findings that can be traced to source evidence.

The consultant can also talk privately with a Higgs assistant to set up a project, receive updates, inspect evidence, change research priorities, and review proposed next steps. The application remembers project state, evidence, and consultant decisions across sessions.

The product supports VC, PE, and consulting workflows. The Northstar Dental Group scenario is fictional demonstration data, not a restriction to one investment sector.

The objective of an interview is to obtain useful, attributable evidence, including information that challenges the thesis. Interview testimony is not automatically independently verified truth.

## 2. Fixed scope and implementation defaults

### Required in this build

- Project creation, pasted thesis text, DOCX ingestion, and source-linked claims.
- Manual expert contact management and CSV import.
- Grounded expert ranking, editable questions, priorities, plan approval, and DOCX question-plan export.
- One active browser expert interview across the deployment, with multiple candidates and historical interviews.
- A session-scoped participant join screen/URL separate from the consultant workspace.
- The real Higgs browser voice adapter and controller-gated expert interview loop.
- Private consultant voice and text interaction, scoped tools, project briefings, follow-up injection, and durable memory.
- Live transcript, question queue, evidence updates, findings review, and a printable report.
- Backend persistence, migrations, deterministic demo adapters, fixtures, focused tests, and setup documentation.

### Deferred from this build

Twilio telephone calling, video rooms/avatars, actual CRM connectors, actual expert-network integrations, parallel expert interviews, automated outreach campaigns, billing, enterprise SSO, and complex infrastructure.

Do not present deferred integrations as functioning features. Preserve clean boundaries for adding them later; no placeholder buttons or speculative integration framework is required.

### Stack

Reuse the repository's established stack where suitable. If the repository is empty, use:

- React, TypeScript, Vite, and Tailwind for the frontend, with clear client-side routing.
- A long-running Node/TypeScript backend, using a small established HTTP framework.
- WebSockets for audio and SSE or an existing WebSocket channel for committed UI updates.
- SQLite with migrations in a configurable persistent data directory.
- Uploaded source files in that data directory, referenced by database records.
- A shared validation library such as Zod for request and model-output schemas.

Use the existing package manager; default to npm for an empty repository. Keep one application backend and one database. Do not add a message broker, Kubernetes, microservices, or a generic agent framework.

Data must survive browser refresh and backend restart. Normal startup must not reset or reseed existing projects. Supply an explicit demo seed/reset command.

### Runtime providers

Reuse an existing configured reasoning provider. If none exists, implement one Anthropic reasoning adapter and one deterministic mock adapter. Use separate prompts and schemas for planning, the interview controller, and consultant text assistance.

Read the real runtime model identifier from `REASONING_MODEL`. Keep `ANTHROPIC_API_KEY` or the existing provider's equivalent, and `BOSON_API_KEY`, on the backend. The coding agent's subscription/model selection does not supply runtime API credentials.

Use the provider's current documented structured-output mechanism where available and validate all outputs server-side. Do not assume forced tool selection works on every model. Verify the selected SDK/model contract rather than copying obsolete API parameters.

Higgs is the runtime voice model. The private Higgs copilot uses scoped application tools directly; it does not require the expert interview controller for every conversational response.

### Demo contract

Demo and live modes use the same backend, persistence, validation, state-application functions, and UI contracts. Mock adapters replace external providers only. Do not build a separate frontend-only demo engine.

Browser storage may hold UI preferences and recovery cursors. It must not be the authoritative store for research records. Never silently substitute synthetic output after a live provider fails.

## 3. Responsibilities and authority

### Planner

Run when the thesis, expert pool, or approved research scope changes.

- Extract independently assessable claims and link each to a source passage.
- Identify missing definitions, relevant populations, dates, units, and measures.
- Describe evidence that would support or challenge each claim.
- Rank expert relevance using their documented experience, not invented qualifications.
- Generate neutral questions with claim associations, purpose, and priority.
- Identify coverage gaps that the available experts cannot credibly address.
- Preserve human edits and approvals through versioned plans.

### Interview controller

Own the research strategy for the active expert interview.

- Consume finalized expert utterances, current question coverage, relevant evidence, expert background, and the approved plan.
- Recognize answers to questions that have not yet been asked.
- Distinguish lack of knowledge from contradictory evidence.
- Propose evidence extraction, coverage updates, follow-ups, and changed priorities.
- Select at most one next action: ask, wait, or end.
- Explain its decision briefly for inspection.
- Run after each finalized meaningful expert turn, subject to a serialized execution queue and version checks.

Short answers can be meaningful. “No,” “twelve percent,” and “I don't know” must not be discarded merely because they are short.

### Higgs interview voice

Deliver the controller-authorized question conversationally and handle the selected audio-control strategy. It does not independently approve findings or choose a different substantive research direction.

Store both the intended question revision and the actual assistant transcript. Natural phrasing is allowed, but changed meaning must be detectable in review. Prompt instructions do not establish a verbatim speech guarantee.

### Consultant copilot

Handle the consultant's private questions and instructions through scoped backend tools.

Examples:

- “What changed since I last reviewed this project?”
- “Which assumptions still lack evidence?”
- “Show me the source for the retention concern.”
- “Ask the operator whether cancellations were concentrated in particular locations.”
- “Remember that this project excludes clinics acquired after 2024.”

The copilot can retrieve current state, navigate to evidence, and propose or perform authorized edits. Research-plan approval and starting an external interview remain explicit consultant actions.

Consultant conversation is not independent expert testimony. Private consultant audio must never be forwarded into the expert interview channel.

### Backend

The backend owns authorization, canonical data, schema validation, state transitions, scheduling, idempotency, response authorization, and persisted events.

A model proposes changes. The backend validates and commits them.

## 4. Product journey and screens

Use a restrained enterprise interface: readable typography, light neutral surfaces, charcoal text, one accent color, useful tables, and minimal animation. Provide a Projects dashboard and project navigation for Overview, Expert Sources, Research Plan, Live Research, and Findings. Keep the consultant copilot accessible throughout the project workspace. Every visible primary action must work or clearly explain why the capability is unavailable.

### Projects and overview

- Create a project with company, research objective, and thesis.
- Accept pasted text and a DOCX document.
- Display the original extracted text and claim-linked passages.
- Show operational status, research coverage, outstanding decisions, and last update.
- Let the consultant edit the thesis without silently rewriting completed research.
- Provide an explicit Enable voice / Start briefing action. After activation, offer a short project briefing without requiring a fresh project setup.

Keep operational progress separate from evidence strength. “Three interviews completed” does not mean “the thesis is 75% validated.”

### Expert sources

- Add, edit, and remove contacts with name, phone if needed, background, and source.
- Import CSV with validation and clear error feedback.
- Show grounded selection rationales and relevant claim IDs.
- Preserve source system IDs and retrieval timestamps for CRM imports.
- Clearly distinguish fictional demo contacts from real contacts.

### Research plan

- Show testable claims, required evidence, recommended experts, and open gaps.
- Allow question and objective editing, priority changes, and expert selection.
- Preserve original versus newly added questions.
- Record the approved plan version.
- Export the plan as DOCX from the same canonical data shown in the UI.

### Live research

For one active interview, prioritize three coordinated panels:

1. Transcript and current interaction.
2. Question coverage, delivery status, and upcoming queue.
3. Emerging evidence and claim assessments.

Show expert identity, actual transport/mode, call state, and duration. Provide explicit end controls, priority changes, and follow-up injection.

A pause control must have defined transport behavior. In a real interview, it can pause new substantive questions while keeping the connection open; it cannot pretend to freeze the respondent. Stopping an interview must cancel pending speech and controller work.

### Participant experience

Provide a minimal participant route with an opaque, expiring interview-scoped join token. It may expose the interview introduction, consent, microphone controls, connection status, and end control. It must not expose the consultant workspace, internal thesis, other interviews, or private notes.

A local browser test lets the consultant act as the respondent using the same participant path. Keep that role explicit. Joining a participant route does not grant project administration access.

### Findings

- Executive synthesis with limits and unresolved questions.
- Claim-by-claim evidence assessment.
- Supporting and conflicting observations.
- Clickable source references that open the correct transcript turn and highlight the cited span.
- Consultant review actions: accept extraction, flag interpretation, and add notes.
- Printable report and question-plan export based on canonical records.

Accepting a finding records an analyst's judgment. It does not turn a respondent's estimate into a verified fact.

## 5. Data and evidence model

Use explicit typed records and migrations. Keep the schema understandable; an append-only audit table does not require a full event-sourced architecture.

| Record | Minimum purpose |
| --- | --- |
| Project | Research objective, owner/scope, state revision, thesis version, current plan, unresolved claims. |
| Source document and passage | Original file, extracted text version, stable passage IDs and text offsets. |
| Claim | Assertion, source passages, priority, scope/metric definitions, evidence requirements. |
| Expert | Provided background, contact details, source IDs, selection rationale. |
| Research plan | Version, included experts/questions, approval status and reviewer. |
| Interview session | Expert, mode, transport, lifecycle, consent state, active lock, termination reason. |
| Question | Versioned wording, claim links, purpose, priority, origin; coverage scoped to an interview. |
| Delivery attempt | Question revision, response ID, playback state, timestamps, interruption details. |
| Transcript turn | Stable ID, source event/item ID, speaker, channel, timestamps, text version, finality. |
| Evidence observation | Attributed statement, source span/version, basis, related claims, scope, supersession. |
| Controller decision | Input revisions, proposed changes, applied/rejected result, rationale, latency. |
| Review/decision | Human action, target record, actor, timestamp, rationale, prior version. |
| State event | Unique ID, monotonic sequence, committed state revision, event type. |
| Session handoff | Derived summary, source versions, unresolved questions, proposed next steps. |

DOCX page numbers can change with rendering. Prefer paragraph/passage IDs and exact text spans unless page references have actually been established.

### Separate three different states

**Question coverage**

- pending
- partially_answered
- answered
- unable_to_answer
- skipped

**Delivery attempt**

- queued
- speaking
- completed
- interrupted
- cancelled
- failed
- unknown, when delivery cannot be established after a disconnect

“Asked” is a UI interpretation of delivery history, not a substitute for coverage. A question may be answered indirectly without any delivery attempt.

Question wording may be shared through a research plan, but coverage, answer-span references, and skip/unavailability reasons are scoped to `(interview_id, question_id)`. They do not automatically carry between experts. Project-level research coverage is assessed separately from accumulated evidence.

**Claim assessment**

- unassessed
- supported_by_interview
- contradicted_by_interview
- mixed_evidence
- inconclusive

The UI should use qualified labels such as “Supported by interview evidence.” Keep assessment separate from a future explicit independent corroboration process.

An expert's inability to answer closes that expert's attempt, not the project's research gap.

### Evidence rules

For every observation retain:

- Who said it and in which interview.
- Exact source turn, version, and span.
- Whether it is a direct observation, estimate, opinion, or report about another source.
- The relevant period, population, metric, unit, and calculation basis when known.
- Which claims it supports, challenges, or leaves unresolved.
- Whether it has been retracted, corrected, or superseded.

Never overwrite supporting evidence when contrary evidence appears. Preserve both.

A participant changing an answer creates a new utterance that retracts or supersedes earlier evidence; it does not rewrite the historical transcript. A transcription correction creates a new text version and invalidates dependent extractions until recomputed.

### Correct treatment of the churn example

If a thesis says churn is below 5% and an expert estimates 12%:

1. Record 12% as that expert's estimate.
2. Mark the numerical question answered or partially answered, depending on its purpose.
3. Capture the expert's stated explanation separately.
4. Check period, cohort, customer versus revenue churn, and measurement basis.
5. Ask a targeted follow-up if comparability or evidence quality is unclear.
6. Mark the claim inconclusive or potentially conflicting until the figures are comparable.
7. Use “contradicted by interview evidence” only when the scoped comparison supports that interpretation.

Do not treat agreement between two interviews as statistical validation, or a plausible relationship as established causation.

## 6. Controller contract and consistency

Each controller request uses an envelope created by the backend:

- request ID
- interview ID
- expected state revision
- approved plan/guide version
- transcript cursor and referenced text versions
- current cancellation/response generation
- scoped input context

The model returns a schema-validated proposal containing:

- Evidence observations with source-span references.
- Question coverage updates.
- Proposed new questions.
- Priority changes.
- A brief decision rationale.
- Exactly one next action: ask, wait, or end.

For an ask action, select a question reference and revision. Resolve the actual wording from the persisted question; do not trust independently generated ID/text pairs that might disagree. New questions may use temporary references within the proposal; the backend assigns permanent IDs.

Validation must include more than JSON shape:

- Referenced records belong to the authorized project/interview.
- Source spans exist in the referenced transcript version.
- Referenced claim and question IDs exist.
- Proposed transitions are allowed.
- No question is spoken after pause or termination.
- The proposal is current relative to human edits and new expert input.
- Evidence is extracted from an eligible expert utterance, not the consultant channel.
- Limits prevent unbounded follow-up generation.

Apply accepted changes and their domain events in one transaction. Publish UI events after commit.

Use a single controller queue per interview plus optimistic revision checks. If a human edits a question while a controller request is in progress, reject the stale decision and recompute. Serializing model calls alone does not solve this race.

Deduplicate provider events and tool calls by stable IDs. An utterance may address zero, one, or multiple questions. Retain the active delivery at speech time as context; do not attach delayed transcripts to whichever question is current at event-arrival time.

Late final transcripts may complete the record after termination. They must never restart speech or an ended interview.

Treat an unclear external playback outcome as unknown. Do not blindly retry speech after reconnecting and call it exactly-once delivery.

## 7. Higgs voice-control contract

Implement two explicit session types. Keep their behavior separate.

### Expert interview: application-controlled turns

Current Boson documentation states that VAD automatically generates responses and that the accepted `create_response` and `interrupt_response` fields have no effect. Do not rely on `create_response: false` to let an external controller run first. [1]

Use this sequence:

1. Configure `audio.input.turn_detection: null`.
2. Stream participant audio to the input buffer.
3. Detect turn completion in the application.
4. Commit the completed audio and correlate the final transcription to its input item.
5. Run the controller, validate its proposal, and commit the accepted decision.
6. If the next action is ask, authorize the selected question revision.
7. Call `response.create`, putting the question and turn-specific directive in `response.instructions`.
8. Forward audio only from an authorized, still-current response.

Manual commit does not generate a response. Commit/response requests while manual-mode generation is active can be rejected, so handle cancellation and the response lifecycle before continuing. [2]

Implement browser-side application VAD for automatic turn boundaries and barge-in. Also provide working End turn and Interrupt controls as diagnostic and accessibility fallbacks. Do not label automatic voice behavior verified unless it has actually been exercised.

Do not insert the intended assistant question into history as a fabricated user message. Save both the authorized wording and the actual assistant transcript. Prompt instructions do not guarantee verbatim speech.

The native-VAD-plus-external-controller alternative is outside this build. Implement the explicit sequence above and measure its latency.

### Consultant copilot: native conversational turns

Use a separate Higgs session with native `server_vad`, conversational instructions, and scoped backend function tools. Do not send an additional `response.create` after every VAD-completed consultant turn, because automatic generation already occurs. [1]

Implement tools for current project status, evidence retrieval, question/priority changes, source navigation, and explicit project-memory updates. Validate arguments and authorization on the backend.

Follow the current documented function-call continuation flow; deduplicate call IDs and continue once after the required client-side tool results are returned. Tool-result continuation is different from duplicating an automatic response to ordinary speech. [3]

After the user enables voice and session configuration is acknowledged, an explicit initial response can provide the project briefing. Queue/coalesce background update notifications. Do not start a new spoken response for every UI event or interrupt the consultant's answer with routine status updates.

The copilot must also have a working text interface through the configured reasoning/mock adapter, so the workflow remains usable without microphone access or a Boson key.

### Microphone ownership

A local browser microphone has one active owner: the expert test session or the private consultant session. Stop/disconnect the previous capture path before switching. Separate WebSockets alone are not audio isolation.

For a one-device demonstration, pause local expert capture and new interview questions while the consultant uses private voice. With a separate remote participant, the expert uses their own session/device and the consultant uses their private capture path. Never forward private consultant audio into the interview.

Request microphone permission when needed and handle denial, missing devices, and browser audio activation. Text controls must remain usable.

### Transcription, interruption, and lifecycle

Use the supported transcription model, currently `higgs-stt-3.1`. Current Boson documentation provides final user transcription completion events, not the partial/failed/diarization event families exposed by some other providers. Do not invent missing events or confidence values. [1]

On interruption:

- Stop forwarding the interrupted generation's audio and clear browser playback.
- Cancel Higgs generation when applicable.
- Record the delivery attempt as interrupted.
- Reconcile Higgs context with `conversation.item.truncate` at the confirmed or conservatively estimated playback position, and update the application's delivery record.
- Invalidate pending actions made obsolete by new input.

Generation completion and playback completion are separate. A reconnect with uncertain playback must not blindly replay the question.

Configure and acknowledge sessions before use. Keep provider event IDs, input item IDs, output response IDs, and application interview/turn IDs explicitly correlated. Time out missing transcriptions and provider operations with recoverable states instead of waiting forever.

Measure turn-end detection, final transcription, controller duration, validation/commit, response start, and first audio forwarded. Record those measurements without logging sensitive content or secrets unnecessarily.

Implement protocol fixtures when keys are absent, then continue building the application. Recheck the official API during implementation and record any material differences.

## 8. Memory and context

Persist application state independently of Higgs sessions.

### Durable memory

Store source documents, claim definitions, expert records, exact finalized transcripts, evidence, approved decisions, plan revisions, review notes, and interview outcomes.

### Derived memory

Store compact session handoffs and summaries with their source versions and evidence references. Rebuild or invalidate summaries when their dependencies change. Repeating a summary is not new corroboration.

### Session context

On a new consultant or interview session, assemble a compact role-specific packet:

- Role and permitted actions.
- Relevant project identity and current state version.
- Approved research objective and scope.
- Current expert background, where applicable.
- Relevant claims and evidence gaps.
- Current question queue and recent relevant turns.
- A short handoff summary and references that tools can retrieve.

Retrieve additional evidence when needed. Do not dump the entire CRM or all prior interviews into each prompt.

The consultant can inspect what the system remembers and correct explicit project instructions. Opening a new voice connection must not reset research state. Implement persisted project instructions and a saved handoff so that a new session can answer “Where were we?” with current state and evidence references.

Persist meaningful updates incrementally. A final summary should not be the only copy of an interview. Track what the consultant has reviewed separately from what a model generated as an update.

Backend authorization determines project and tenant scope. Model-supplied IDs do not confer access. Expert sessions receive only the background needed for that interview, not confidential internal discussions or other experts' attributable statements.

## 9. Live UI and shared contracts

Use one set of typed data contracts for live and simulated operation.

- Load a consistent project snapshot and event cursor.
- Apply committed server events in order.
- Reconnect from the cursor; refetch a snapshot if necessary.
- Do not infer canonical question or claim states by parsing displayed chat.
- Keep transient audio/connection indicators separate from persisted research state.
- Use WebSockets for audio; SSE or an existing WebSocket channel can deliver UI updates.

A simple event table and normal transactions are sufficient for the MVP. Introduce a broker only if a measured deployment need later justifies one.

Mode labels should distinguish:

- Fully synthetic demo.
- Live browser voice with real reasoning.
- Live browser voice with mock reasoning, if deliberately enabled.
- Voice unavailable, with the specific configuration or permission requirement shown.

Never silently switch a failed live provider to mock data. Explain degraded capability and preserve the existing record. Clearly label live voice with mock reasoning as such. Synthetic mode must not request a microphone unnecessarily, play fabricated provider audio, or contact anyone.

## 10. Access, consent, and boundaries

Bind local development to loopback by default. Protect consultant APIs and WebSocket upgrades with a basic backend-validated access mechanism when exposed beyond local development. Document that public/team deployment requires an appropriate authentication and operational configuration; enterprise identity is not part of this build.

Participant join tokens must be opaque, scoped to one interview, expiring, and unable to access consultant APIs. Avoid logging them. Keep all provider secrets backend-side. Send documents, transcripts, and contact data only to authorized UI views and providers required for the selected live mode.

Start an expert interview with AI identification and a participation request. Store the consent outcome and gate substantive questioning on acceptance. Keep participation consent and transcript-retention disclosure explicit.

Audio recording is not included in this build and must remain disabled. An opt-out stops substantive questioning immediately, cancels pending model/audio work, and ends the participant session. Use configured boundaries that avoid requesting confidential information.

Plan approval and starting the selected interview are separate consultant actions. Starting an interview must acquire the single-active-interview guard transactionally.

Handle project/participant socket disconnects and backend restart deliberately. Persist completed work, mark interrupted sessions accurately, and offer an explicit resume path instead of pretending that a broken connection is still live.

## 11. Deterministic Northstar demonstration

Use fictional Northstar Dental Group, six expert profiles, and three recommendations with traceable reasoning. All demonstration records and exports are marked synthetic.

Run the same controller/state application path through deterministic mock adapters. The mock can return known decisions; it must not bypass validation and mutate UI state directly.

Required deterministic demonstration:

1. Load a completed customer interview fixture reporting appointment cancellations and the customer's decision to change providers.
2. Start one operator interview.
3. The operator describes staffing gaps and limited appointment capacity.
4. The UI highlights an evidence gap about the relationship between staffing and appointment disruption.
5. The consultant privately asks the copilot to investigate.
6. The controller adds a neutral follow-up about affected locations, time periods, and the evidence connecting staffing with cancellations.
7. A follow-up distinguishes cancellations, rescheduling, reduced capacity, and actual patient attrition.
8. Findings show a possible operational constraint and a possible retention consequence, with both source references.
9. The consultant flags any overstated causal interpretation and records the next evidence needed.
10. Reopen the project and ask for an update; the copilot retrieves the saved state and citations.

Supply a sample thesis DOCX, contact CSV, and reproducible interview fixtures. Demo adapters must still generate valid source references and pass the same validators as live results. For user-entered content outside the fixture, label deterministic behavior honestly and do not invent source passages.

The demo must prove adaptive research, human intervention, evidence attribution, and memory. Additional simultaneous animated interview tiles are outside this build.

## 12. Verification and acceptance

Use focused state-transition tests and one integration-style controller-loop test. Add transport tests where audio behavior is the remaining risk.

| Scenario | Required result |
| --- | --- |
| Planning | Source-linked claims, grounded expert rankings, editable questions, export. |
| Indirect answer | One utterance can resolve several questions without repeating them. |
| Unknown answer | This expert's attempt closes while the project gap remains open. |
| Reused question plan | A subsequent expert receives interview-specific coverage state; earlier evidence remains available without silently marking the new expert's questions answered. |
| Metric mismatch | An incomparable 12% estimate is not automatically a contradiction. |
| Conflicting sources | Both observations remain visible and aggregate assessment can become mixed. |
| Participant correction | New testimony supersedes earlier evidence without rewriting history. |
| ASR correction | Dependent quotes/extractions are invalidated or recomputed against the new version. |
| Invalid model data | Schema/semantic validation rejects it without partial persistent changes. |
| Duplicate/late events | No duplicate evidence, follow-ups, or speech attempts; original attribution remains. |
| Human edit during reasoning | Stale output cannot restore or speak the old question. |
| Interruption | Playback clears; interrupted question is not marked fully delivered. |
| Missing transcription | The system waits, clarifies, or ends safely; it does not invent an answer. |
| Opt-out/end | Pending work is cancelled; later transcripts cannot restart the interview. |
| Consultant isolation | Private consultant comments do not become expert evidence or expert audio. |
| Reconnection | Snapshot and events restore state without replaying completed questions. |
| Citation navigation | Each quote opens the correct speaker, turn version, and span. |
| Persistence | A fresh session can answer “Where were we?” from saved state. |
| Missing credentials | Demo remains available; live modes explain missing capability. |
| Malformed input | Invalid DOCX/CSV, empty expert pools, and excessive uploads are handled clearly. |
| One-interview limit | Concurrent start requests cannot create two active expert interviews. |

Validate document types and size/decompression limits. Treat uploaded text and expert utterances as untrusted content, not privileged instructions to call tools or disclose project information.

Test the actual voice-control strategy early. Passing a text-only mock test does not verify interruption handling or natural audio behavior.

### Required verification gates

1. **Credential-free product:** Start the app; create a project; ingest the sample DOCX/CSV; generate, edit, approve, and export the plan; run the adaptive demo through the backend; inject a consultant follow-up; inspect source-linked findings; export the report; restart the backend and restore the project.
2. **Voice protocol fixtures:** Prove that expert speech generation cannot start before a committed controller decision, stale audio is dropped, interruption clears playback, private consultant events stay isolated, and a consultant VAD turn does not trigger duplicate response generation.
3. **Live provider checks:** If credentials are available, exercise an actual finalized expert turn through the configured reasoning adapter and Higgs speech output, plus a consultant tool exchange. Record the exact configuration and result. A live Higgs test with mocked reasoning is a separate, clearly labeled result.
4. **Browser audio:** When browser/audio tools are available, exercise permissions, capture, playback, interruption, and exclusive local microphone ownership. A WebSocket probe or fake microphone fixture alone does not establish real microphone/audio verification.

If credentials, device access, or browser tooling are unavailable, finish all other required implementation and checks. Report those specific verification gaps; do not replace the missing live check with an invented pass.

## 13. Implementation order and definition of done

### Execute in this order

1. Inspect the repository; establish `BUILD_STATUS.md`, package scripts, and the smallest suitable architecture.
2. Implement domain types, migrations, persistent records, and validated state application with focused tests.
3. Implement the Higgs expert/consultant session configurations and protocol fixtures. Perform bounded live checks if credentials are present; otherwise continue.
4. Implement thesis ingestion, contact management/import, planning, plan editing/approval, and exports.
5. Connect the participant browser route, audio capture/playback, application VAD, and controller loop.
6. Build the project workspace, live updates, question queue, evidence/citation navigation, and findings review.
7. Implement consultant voice/text tools, private capture ownership, memory updates, and session restoration.
8. Add the complete Northstar demonstration, explicit mode labels, loading/error/empty states, and report printing.
9. Install dependencies, run migrations, type checking, production build, focused tests, and the full deterministic journey. Start the app and inspect the primary workflow with browser tools when available. Fix failures affecting required behavior.
10. Update documentation and status, inspect the final diff for secrets/unrelated changes, and make the scoped commit if supported.

### Required repository deliverables

- Complete frontend and backend with strict TypeScript where applicable.
- Real Higgs and selected reasoning-provider adapters plus deterministic substitutes.
- Shared schemas, separate model prompts, migrations, fixtures, and focused automated tests.
- `.env.example` with backend-only provider credentials, `REASONING_MODEL`, persistent data directory, ports/origins, and the basic access configuration.
- Documented equivalents of `dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, and `demo:seed`.
- A default local demo that can be started without provider credentials using the documented commands.
- README covering setup, actual architecture and data flow, mode selection, API keys, persistence, consent, test commands, and exact remaining live verification steps.
- `BUILD_STATUS.md` reflecting completed work and precise unresolved dependencies.

The required workflows must contain no placeholder handlers, disconnected screens, or unresolved implementation TODOs. Deferred features may be documented but must not be counted as implemented.

### Final report

Finish with:

1. What was implemented and where to open the app.
2. Exact installation, migration, seed, development, build, and test commands.
3. Verification results, separating deterministic tests, simulated provider events, live provider checks, and actual browser audio.
4. Required credentials/configuration and any remaining blocked verification.
5. Material limitations, including speech fidelity and any unverified automatic VAD behavior.
6. Branch/commit details when applicable.

Declare implementation completion only when all required code paths exist and credential-free acceptance passes. Declare live verification only for paths actually exercised. If a genuine environment restriction prevents a required check, state the restriction and the remaining step precisely rather than claiming success.

## 14. Official implementation references

Use current official documentation. The Boson notes in this prompt were reviewed on 24 October 2026 and are implementation guidance, not evidence of a completed live test.

[1] [Boson: migration and protocol differences](https://docs.boson.ai/models/higgs-realtime/migrate-an-existing-integration)

[2] [Boson: client events](https://docs.boson.ai/api-reference/realtime/client-events)

[3] [Boson: tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling)

[4] [Boson: audio formats and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices)

Additional references:

- [Boson tutorial repository](https://github.com/boson-ai/Higgs-Realtime-Tutorial)
- [Boson turn detection and interruptions](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions)
- [Boson server events](https://docs.boson.ai/api-reference/realtime/server-events)
- [Boson sessions and context](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions)
- [Anthropic model and SDK documentation](https://platform.claude.com/docs/en/models/overview)
- [Opus 5.5 coding-model documentation](https://platform.claude.com/docs/en/models/opus-5-5/overview)
- [Opus 5.5 prompting and unattended-task guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)



Begin now: inspect the repository, then implement and verify the complete required application.
