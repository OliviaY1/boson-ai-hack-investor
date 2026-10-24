// HTTP API, SSE event stream, participant routes, and WebSocket upgrades.
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { ClaimEditInput, CreateProjectInput, ExpertInput, INTERVIEW_MODES, NewQuestionInput, QuestionEditInput } from "../../../shared/contracts";
import { DomainError, eventsAfter } from "../domain/events";
import { reviewEvidence, reviewFinding } from "../domain/evidence";
import {
  correctTurn,
  createInterview,
  getInterview,
  reissueJoinToken,
  resolveJoinToken,
  resumeInterrupted,
  startInterview,
} from "../domain/interviews";
import { addDirective, editMemory, markReviewed, rememberInstruction, retireMemory, saveHandoff } from "../domain/memory";
import { addQuestion, approvePlan, editClaim, editQuestion, planHasUnapprovedChanges, runPlanner, setRankingSelected } from "../domain/planning";
import { addExpert, addThesisDocument, createProject, importExperts, removeExpert, requireProject, updateExpert, updateProject } from "../domain/projects";
import { buildSnapshot, loadProject } from "../domain/records";
import { buildPlanDocx } from "../export/planDocx";
import { renderReport } from "../export/report";
import { parseExpertCsv } from "../ingest/csv";
import { extractDocxText } from "../ingest/docx";
import { INTRO_TEXT } from "../providers/prompts";
import type { Services } from "../services";
import { REPO_ROOT } from "../services";
import { CopilotVoiceSession } from "../voice/copilotVoice";
import { InterviewVoiceSession, type ParticipantChannel } from "../voice/interviewVoice";

const ACCESS_COOKIE = "dl_access";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function isConsultantAuthorized(svc: Services, req: IncomingMessage): boolean {
  const token = svc.config.accessToken;
  if (!token) return true;
  const presented = (req.headers["x-access-token"] as string | undefined) ?? readCookie(req, ACCESS_COOKIE);
  return !!presented && safeEqual(presented, token);
}

const p = (req: Request, k: string) => String(req.params[k]);

export function createApp(svc: Services) {
  const app = express();
  const ctx = svc.ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: svc.config.maxUploadBytes, files: 1 } });
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // --- unauthenticated: config, login, participant routes -------------------------------------
  app.get("/api/config", (_req, res) => res.json(svc.capabilities()));
  app.post("/api/login", (req, res) => {
    const token = String(req.body?.token ?? "");
    if (!svc.config.accessToken) return res.json({ ok: true });
    if (!safeEqual(token, svc.config.accessToken)) return res.status(401).json({ error: "Invalid access token." });
    res.setHeader("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ ok: true });
  });

  // Participant API: authorized only by an opaque, expiring, interview-scoped token.
  const participant = express.Router();
  participant.use("/:token", (req, res, next) => {
    const iv = resolveJoinToken(ctx, p(req, "token"));
    if (!iv) return res.status(404).json({ error: "This interview link is invalid or has expired." });
    (req as any).interview = iv;
    next();
  });
  participant.get("/:token", (req, res) => {
    const iv = getInterview(ctx, (req as any).interview.id);
    const expert = ctx.db.prepare("SELECT name FROM experts WHERE id = ?").get(iv.expert_id) as any;
    const assistantLines = (ctx.db
      .prepare("SELECT t.seq, t.speaker, v.text FROM transcript_turns t JOIN transcript_versions v ON v.turn_id = t.id AND v.version = t.current_version WHERE t.interview_id = ? ORDER BY t.seq")
      .all(iv.id) as any[]).map((t) => ({ seq: t.seq, speaker: t.speaker, text: t.text }));
    // Only what the participant needs: no thesis, plan, other interviews, or private notes.
    res.json({
      interviewId: iv.id,
      participantName: expert?.name ?? "",
      mode: iv.mode,
      transport: iv.transport,
      lifecycle: iv.lifecycle,
      consent: iv.consent,
      intro: INTRO_TEXT,
      localTest: !!iv.local_test,
      voiceAvailable: iv.transport === "browser_ws" && !!svc.voiceSettings(),
      transcript: assistantLines,
      audioRecording: false,
    });
  });
  participant.post("/:token/consent", (req, res) => {
    const iv = (req as any).interview;
    svc.engine.consent(iv.id, req.body?.accepted === true);
    res.json({ ok: true });
  });
  participant.post("/:token/answer", (req, res) => {
    const iv = (req as any).interview;
    if (iv.transport !== "simulated") throw new DomainError(409, "Typed answers are only accepted in the synthetic demo interview.", "not_synthetic");
    const turnId = svc.engine.submitTypedTurn(iv.id, String(req.body?.text ?? ""));
    res.json({ turnId });
  });
  participant.post("/:token/end", (req, res) => {
    svc.engine.stop((req as any).interview.id, "participant_ended");
    res.json({ ok: true });
  });
  app.use("/api/participant", participant);

  // --- consultant API ---------------------------------------------------------------------------
  app.use("/api", (req, res, next) => {
    if (!isConsultantAuthorized(svc, req)) return res.status(401).json({ error: "Access token required.", code: "unauthorized" });
    next();
  });

  app.get("/api/projects", (_req, res) => {
    const rows = ctx.db.prepare("SELECT id FROM projects ORDER BY updated_at DESC").all() as any[];
    const active = ctx.db.prepare("SELECT id, project_id, lifecycle FROM interviews WHERE active_slot IS NOT NULL").get() as any;
    res.json({
      projects: rows.map((r) => {
        const proj = loadProject(ctx.db, r.id)!;
        const counts = ctx.db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM claims WHERE project_id = ? AND status = 'active') AS claims,
                    (SELECT COUNT(*) FROM interviews WHERE project_id = ? AND lifecycle = 'ended') AS interviews,
                    (SELECT COUNT(*) FROM evidence WHERE project_id = ? AND status = 'active') AS evidence`,
          )
          .get(r.id, r.id, r.id) as any;
        return { ...proj, ...counts };
      }),
      activeInterview: active ?? null,
    });
  });
  app.post("/api/projects", (req, res) => {
    const input = CreateProjectInput.parse(req.body);
    const id = createProject(ctx, input);
    if (input.thesisText?.trim()) addThesisDocument(ctx, svc.config.dataDir, id, { kind: "pasted", text: input.thesisText });
    res.status(201).json({ id });
  });
  app.post("/api/demo/northstar", async (_req, res) => {
    const id = await svc.seedNorthstar();
    res.status(201).json({ id });
  });
  app.get("/api/projects/:id/snapshot", (req, res) => {
    const s = buildSnapshot(ctx.db, p(req, "id"));
    if (!s) throw new DomainError(404, "Project not found.", "not_found");
    res.json({ snapshot: s, planHasUnapprovedChanges: planHasUnapprovedChanges(ctx, p(req, "id")) });
  });
  app.get("/api/projects/:id/events", (req, res) => {
    const projectId = p(req, "id");
    requireProject(ctx, projectId);
    const after = Number(req.query.after ?? req.headers["last-event-id"] ?? 0) || 0;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`: connected at revision ${after}\n\n`);
    let last = after;
    const send = (e: { revision: number }) => {
      if (e.revision <= last) return;
      last = e.revision;
      res.write(`id: ${e.revision}\nevent: state\ndata: ${JSON.stringify(e)}\n\n`);
    };
    // Replay committed events after the cursor, then stream live ones in order.
    for (const e of eventsAfter(ctx.db, projectId, after, 1000)) send(e);
    const unsub = ctx.hub.subscribe(projectId, send);
    const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
    req.on("close", () => {
      unsub();
      clearInterval(ping);
    });
  });
  app.patch("/api/projects/:id", (req, res) => {
    const b = z.object({ company: z.string().min(1).max(200).optional(), objective: z.string().min(1).max(2000).optional() }).parse(req.body);
    updateProject(ctx, p(req, "id"), b);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/thesis", (req, res) => {
    const b = z.object({ text: z.string().min(1).max(400_000) }).parse(req.body);
    const docId = addThesisDocument(ctx, svc.config.dataDir, p(req, "id"), { kind: "pasted", text: b.text });
    res.status(201).json({ documentId: docId });
  });
  app.post("/api/projects/:id/thesis/docx", upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) throw new DomainError(400, "Attach a .docx file in the 'file' field.", "missing_file");
    if (!/\.docx$/i.test(f.originalname)) throw new DomainError(400, "Only .docx files are accepted.", "invalid_type");
    const text = await extractDocxText(f.buffer, svc.config.maxUploadBytes);
    const docId = addThesisDocument(ctx, svc.config.dataDir, p(req, "id"), { kind: "docx", text, filename: path.basename(f.originalname), raw: f.buffer });
    res.status(201).json({ documentId: docId });
  });
  app.post("/api/projects/:id/experts", (req, res) => {
    const id = addExpert(ctx, p(req, "id"), ExpertInput.parse(req.body));
    res.status(201).json({ id });
  });
  app.patch("/api/projects/:id/experts/:eid", (req, res) => {
    updateExpert(ctx, p(req, "id"), p(req, "eid"), ExpertInput.partial().parse(req.body));
    res.json({ ok: true });
  });
  app.delete("/api/projects/:id/experts/:eid", (req, res) => {
    removeExpert(ctx, p(req, "id"), p(req, "eid"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/experts/import", upload.single("file"), (req, res) => {
    const f = req.file;
    if (!f) throw new DomainError(400, "Attach a .csv file in the 'file' field.", "missing_file");
    if (!/\.csv$/i.test(f.originalname)) throw new DomainError(400, "Only .csv files are accepted.", "invalid_type");
    const result = parseExpertCsv(f.buffer);
    const ids = result.valid.length ? importExperts(ctx, p(req, "id"), result.valid.map((v) => v.expert), "csv") : [];
    res.status(result.valid.length ? 201 : 400).json({ imported: ids.length, errors: result.errors });
  });
  app.post("/api/projects/:id/plan/generate", async (req, res) => {
    const planId = await runPlanner(ctx, svc.reasoning, p(req, "id"));
    res.status(201).json({ planId, provider: svc.reasoning.name });
  });
  app.patch("/api/projects/:id/questions/:qid", (req, res) => {
    editQuestion(ctx, p(req, "id"), p(req, "qid"), QuestionEditInput.parse(req.body), "consultant");
    svc.engine.onResearchChange(p(req, "id"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/questions", (req, res) => {
    const b = NewQuestionInput.parse(req.body);
    const id = addQuestion(ctx, p(req, "id"), b, "consultant");
    svc.engine.onResearchChange(p(req, "id"));
    res.status(201).json({ id });
  });
  app.patch("/api/projects/:id/claims/:cid", (req, res) => {
    editClaim(ctx, p(req, "id"), p(req, "cid"), ClaimEditInput.parse(req.body));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/rankings/:rid", (req, res) => {
    setRankingSelected(ctx, p(req, "id"), p(req, "rid"), z.object({ selected: z.boolean() }).parse(req.body).selected);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/plan/approve", (req, res) => {
    const b = z.object({ reviewer: z.string().min(1).max(100).default("consultant"), rationale: z.string().max(1000).default("") }).parse(req.body ?? {});
    const planId = approvePlan(ctx, p(req, "id"), b.reviewer, b.rationale);
    res.json({ planId });
  });
  app.get("/api/projects/:id/plan.docx", async (req, res) => {
    const s = buildSnapshot(ctx.db, p(req, "id"));
    if (!s) throw new DomainError(404, "Project not found.", "not_found");
    const buf = await buildPlanDocx(s);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="research-plan-${s.project.id}.docx"`);
    res.send(buf);
  });
  app.get("/api/projects/:id/report.html", (req, res) => {
    const s = buildSnapshot(ctx.db, p(req, "id"));
    if (!s) throw new DomainError(404, "Project not found.", "not_found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderReport(s));
  });

  // Interviews
  app.post("/api/projects/:id/interviews", (req, res) => {
    const b = z.object({ expertId: z.string(), mode: z.enum(INTERVIEW_MODES).exclude(["fixture"]), localTest: z.boolean().default(false) }).parse(req.body);
    svc.assertModeAvailable(b.mode);
    const id = createInterview(ctx, p(req, "id"), b.expertId, b.mode, b.localTest);
    res.status(201).json({ id });
  });
  const ivRoute = (suffix: string) => `/api/projects/:id/interviews/:iid/${suffix}`;
  const ownInterview = (req: Request) => {
    const iv = getInterview(ctx, p(req, "iid"));
    if (iv.project_id !== p(req, "id")) throw new DomainError(404, "Interview not found.", "not_found");
    return iv;
  };
  app.post(ivRoute("start"), (req, res) => {
    const iv = ownInterview(req);
    if (iv.mode !== "synthetic") svc.assertModeAvailable(iv.mode);
    const { joinToken } = startInterview(ctx, iv.id, svc.config.joinTokenTtlMinutes);
    svc.engine.onStarted(iv.id);
    res.json({ joinToken, joinPath: joinToken ? `/join/${joinToken}` : null });
  });
  app.post(ivRoute("join-link"), (req, res) => {
    const iv = ownInterview(req);
    const t = reissueJoinToken(ctx, iv.id, svc.config.joinTokenTtlMinutes);
    res.json({ joinToken: t, joinPath: `/join/${t}` });
  });
  app.post(ivRoute("pause"), (req, res) => {
    svc.engine.pause(ownInterview(req).id, String(req.body?.reason ?? "consultant"));
    res.json({ ok: true });
  });
  app.post(ivRoute("resume"), (req, res) => {
    svc.engine.resume(ownInterview(req).id);
    res.json({ ok: true });
  });
  app.post(ivRoute("stop"), (req, res) => {
    svc.engine.stop(ownInterview(req).id, String(req.body?.reason ?? "consultant_ended"));
    res.json({ ok: true });
  });
  app.post(ivRoute("resume-interrupted"), (req, res) => {
    const iv = ownInterview(req);
    const { joinToken } = resumeInterrupted(ctx, iv.id, svc.config.joinTokenTtlMinutes);
    if (iv.transport === "simulated") void svc.engine.enqueue(iv.id, "resume_after_interruption");
    res.json({ joinToken, joinPath: joinToken ? `/join/${joinToken}` : null });
  });
  app.post(ivRoute("respond"), (req, res) => {
    res.json(svc.engine.respondScripted(ownInterview(req).id));
  });
  app.get(ivRoute("idle"), async (req, res) => {
    await svc.engine.whenIdle(ownInterview(req).id);
    res.json({ ok: true });
  });

  // Transcript correction, reviews, directives, copilot, memory
  app.patch("/api/projects/:id/turns/:tid", async (req, res) => {
    const b = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const { interviewId } = correctTurn(ctx, p(req, "id"), p(req, "tid"), b.text, "consultant");
    await svc.engine.reextract(interviewId, p(req, "tid"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/evidence/:eid/review", (req, res) => {
    const b = z.object({ action: z.enum(["accept", "flag", "note"]), note: z.string().max(2000).default(""), claimId: z.string().optional() }).parse(req.body);
    reviewEvidence(ctx, p(req, "id"), p(req, "eid"), b.action, b.note, b.claimId);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/findings/:fid/review", (req, res) => {
    const b = z.object({ action: z.enum(["accept", "flag", "note"]), note: z.string().max(2000).default(""), nextEvidence: z.string().max(1000).nullable().default(null) }).parse(req.body);
    reviewFinding(ctx, p(req, "id"), p(req, "fid"), b.action, b.note, b.nextEvidence);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/directives", (req, res) => {
    const b = z.object({ instruction: z.string().min(3).max(1000), claimIds: z.array(z.string()).max(10).default([]) }).parse(req.body);
    const r = addDirective(ctx, p(req, "id"), b.instruction, b.claimIds, "consultant");
    svc.engine.onResearchChange(p(req, "id"));
    res.status(201).json(r);
  });
  app.post("/api/projects/:id/copilot", async (req, res) => {
    requireProject(ctx, p(req, "id"));
    const out = await svc.copilotText(p(req, "id"), String(req.body?.message ?? ""));
    res.json({ reply: out.reply, navigation: out.navigation, tools: out.toolCalls.map((c) => c.name), provider: svc.reasoning.name });
  });
  app.post("/api/projects/:id/memory", (req, res) => {
    res.status(201).json({ id: rememberInstruction(ctx, p(req, "id"), String(req.body?.text ?? ""), "consultant") });
  });
  app.patch("/api/projects/:id/memory/:mid", (req, res) => {
    editMemory(ctx, p(req, "id"), p(req, "mid"), String(req.body?.text ?? ""));
    res.json({ ok: true });
  });
  app.delete("/api/projects/:id/memory/:mid", (req, res) => {
    retireMemory(ctx, p(req, "id"), p(req, "mid"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/reviewed", (req, res) => {
    markReviewed(ctx, p(req, "id"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/handoff", (req, res) => {
    res.status(201).json({ id: saveHandoff(ctx, p(req, "id")) });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  // Static frontend (production build).
  const webDir = path.join(REPO_ROOT, "dist/web");
  if (svc.config.serveStatic && existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid request.", code: "invalid_request", issues: err.issues.slice(0, 5) });
    if ((err as any)?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `The file exceeds the ${Math.round(svc.config.maxUploadBytes / 1024 / 1024)} MB upload limit.`, code: "upload_too_large" });
    if ((err as any)?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large.", code: "body_too_large" });
    console.error("[http] unhandled", err);
    res.status(500).json({ error: "Internal error.", code: "internal" });
  });
  return app;
}

function wsChannel(ws: WebSocket): ParticipantChannel {
  return {
    sendJson: (m) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    },
    close: (code, reason) => {
      try {
        ws.close(code ?? 1000, reason);
      } catch {
        /* ignore */
      }
    },
  };
}

function originAllowed(svc: Services, req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  const host = req.headers.host;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
  return svc.config.allowedOrigins.includes(origin);
}

export function attachWebSockets(svc: Services, server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reject = (code: number, msg: string) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!originAllowed(svc, req)) return reject(403, "Forbidden");
    if (url.pathname === "/ws/participant") {
      const iv = resolveJoinToken(svc.ctx, url.searchParams.get("token") ?? "");
      if (!iv) return reject(404, "Not Found");
      if (iv.transport !== "browser_ws") return reject(409, "Conflict");
      const settings = svc.voiceSettings();
      if (!settings) return reject(503, "Service Unavailable");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = new InterviewVoiceSession(svc.ctx, svc.engine, iv.id, wsChannel(ws), settings);
        ws.on("message", (data, isBinary) => {
          if (isBinary) session.onAudio(data as Buffer);
          else {
            try {
              void session.onMessage(JSON.parse(data.toString()));
            } catch {
              /* ignore malformed */
            }
          }
        });
        ws.on("close", () => session.onParticipantClosed());
        void session.start();
      });
      return;
    }
    if (url.pathname === "/ws/copilot") {
      if (!isConsultantAuthorized(svc, req)) return reject(401, "Unauthorized");
      const projectId = url.searchParams.get("project") ?? "";
      if (!svc.ctx.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) return reject(404, "Not Found");
      const settings = svc.voiceSettings();
      if (!settings) return reject(503, "Service Unavailable");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = new CopilotVoiceSession(svc.ctx, svc.engine, projectId, wsChannel(ws), settings);
        ws.on("message", (data, isBinary) => {
          if (isBinary) session.onAudio(data as Buffer);
          else {
            try {
              session.onMessage(JSON.parse(data.toString()));
            } catch {
              /* ignore */
            }
          }
        });
        ws.on("close", () => session.close());
        void session.start(url.searchParams.get("localTest") === "1");
      });
      return;
    }
    reject(404, "Not Found");
  });
  return wss;
}
