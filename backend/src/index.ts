import { createServer } from "node:http";
import { loadConfig } from "./config";
import { attachWebSockets, createApp } from "./http/app";
import { Services } from "./services";

export function startServer(overrides = {}) {
  const config = loadConfig(overrides);
  const svc = new Services(config);
  const interrupted = svc.recover();
  const app = createApp(svc);
  const server = createServer(app);
  attachWebSockets(svc, server);
  return new Promise<{ svc: Services; server: typeof server; port: number }>((resolve) => {
    server.listen(config.port, config.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : config.port;
      const caps = svc.capabilities();
      console.log(`Diligence Live backend on http://${config.host}:${port}`);
      console.log(`  data dir: ${config.dataDir}`);
      console.log(`  reasoning: ${caps.reasoningProvider}${caps.reasoningModel ? ` (${caps.reasoningModel})` : " (deterministic mock)"}; Higgs voice: ${caps.bosonConfigured ? "configured" : "not configured"}`);
      if (interrupted.length) console.log(`  marked ${interrupted.length} interview(s) interrupted after restart (resumable)`);
      console.log(`  test call: open /call in the UI (npm start: http://${config.host}:${port}/call, npm run dev: http://localhost:5173/call)`);
      if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.accessToken) {
        console.warn("  WARNING: bound beyond loopback without ACCESS_TOKEN; consultant APIs are unprotected.");
      }
      resolve({ svc, server, port });
    });
  });
}

const isMain = process.argv[1] && /backend[\\/](src[\\/]index\.ts|dist[\\/]server\.js)$|dist[\\/]server\.js$/.test(process.argv[1]);
if (isMain) {
  const { server, svc } = await startServer();
  const shutdown = () => {
    server.close();
    svc.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
