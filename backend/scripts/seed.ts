// Adds a fresh synthetic Northstar demonstration project (never modifies existing projects).
import { loadConfig } from "../src/config";
import { Services } from "../src/services";

const svc = new Services(loadConfig(), { real: null });
const id = await svc.seedNorthstar();
svc.close();
console.log(`Created synthetic Northstar demo project ${id}.`);
