import "dotenv/config";
import path from "node:path";
import { readFileSync } from "node:fs";

function readKey(inlineVar: string, fileVar: string): string | undefined {
  const inline = process.env[inlineVar]?.trim();
  if (inline) return inline;
  const file = process.env[fileVar]?.trim();
  if (file) {
    try {
      const v = readFileSync(file, "utf8").trim();
      if (v) return v;
    } catch {
      console.warn(`[config] could not read ${fileVar}`);
    }
  }
  return undefined;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  allowedOrigins: string[];
  accessToken: string | undefined;
  anthropicApiKey: string | undefined;
  reasoningModel: string;
  reasoningFallbacks: boolean;
  bosonApiKey: string | undefined;
  bosonRealtimeUrl: string;
  bosonModel: string;
  bosonVoice: string;
  transcriptionModel: string;
  allowLiveVoiceMockReasoning: boolean;
  joinTokenTtlMinutes: number;
  maxUploadBytes: number;
  transcriptionTimeoutMs: number;
  providerTimeoutMs: number;
  serveStatic: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const cfg: AppConfig = {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    accessToken: env.ACCESS_TOKEN?.trim() || undefined,
    anthropicApiKey: readKey("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_FILE"),
    reasoningModel: env.REASONING_MODEL?.trim() || "claude-opus-5-5",
    reasoningFallbacks: (env.REASONING_FALLBACKS ?? "default") === "default",
    bosonApiKey: readKey("BOSON_API_KEY", "BOSON_API_KEY_FILE"),
    bosonRealtimeUrl: env.BOSON_REALTIME_URL ?? "wss://api.boson.ai/v1/realtime?model=higgs-realtime",
    bosonModel: env.BOSON_MODEL ?? "higgs-realtime",
    bosonVoice: env.BOSON_VOICE ?? "default",
    transcriptionModel: env.BOSON_TRANSCRIPTION_MODEL ?? "higgs-stt-3.1",
    allowLiveVoiceMockReasoning: env.ALLOW_LIVE_VOICE_MOCK_REASONING === "true",
    joinTokenTtlMinutes: Number(env.JOIN_TOKEN_TTL_MINUTES ?? 120),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
    transcriptionTimeoutMs: Number(env.TRANSCRIPTION_TIMEOUT_MS ?? 20000),
    providerTimeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? 45000),
    serveStatic: env.SERVE_STATIC !== "false",
    ...overrides,
  };
  return cfg;
}
