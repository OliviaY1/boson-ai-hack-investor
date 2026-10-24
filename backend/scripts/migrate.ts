// Applies pending append-only migrations to DATA_DIR/diligence.sqlite.
import { loadConfig } from "../src/config";
import { migrate, openDb } from "../src/db/db";

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const applied = migrate(db);
db.close();
console.log(`Database at ${cfg.dataDir}: ${applied.length ? `applied migration(s) ${applied.join(", ")}` : "already up to date"}.`);
