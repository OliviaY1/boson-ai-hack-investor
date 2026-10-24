// Deletes all local data in DATA_DIR (requires --yes), then seeds the Northstar demo.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Services } from "../src/services";

const cfg = loadConfig();
if (!process.argv.includes("--yes")) {
  console.error(`This deletes every project, interview, and upload in ${cfg.dataDir}.\nRe-run with: npm run demo:reset -- --yes`);
  process.exit(1);
}
const resolved = path.resolve(cfg.dataDir);
if (resolved === path.parse(resolved).root || resolved === process.env.HOME) {
  console.error(`Refusing to delete ${resolved}.`);
  process.exit(1);
}
if (existsSync(resolved)) rmSync(resolved, { recursive: true, force: true });
const svc = new Services(cfg, { real: null });
const id = await svc.seedNorthstar();
svc.close();
console.log(`Reset ${resolved} and created synthetic Northstar demo project ${id}.`);
