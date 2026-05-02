import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const inventoryPath = path.join(root, "artifacts/api-server/src/lib/inventoryCache.ts");
const invariantsPath = path.join(root, "artifacts/api-server/src/lib/codeRepair/invariants.ts");

const inventorySource = fs.readFileSync(inventoryPath, "utf8");
const invariantSource = fs.readFileSync(invariantsPath, "utf8");

const inventoryMatch = inventorySource.match(/export interface InventoryItem \{([\s\S]*?)\n\}/);
if (!inventoryMatch) {
  console.error("Could not parse InventoryItem interface");
  process.exit(1);
}

const fieldPattern = /^\s*([a-zA-Z_]\w*)\??:/gm;
const inventoryFields = new Set<string>();
let fieldMatch: RegExpExecArray | null;
while ((fieldMatch = fieldPattern.exec(inventoryMatch[1])) !== null) {
  inventoryFields.add(fieldMatch[1]);
}

const invariantPattern = /^\s*([a-zA-Z_]\w*):\s*\{/gm;
const invariantFields = new Set<string>();
let invariantMatch: RegExpExecArray | null;
while ((invariantMatch = invariantPattern.exec(invariantSource)) !== null) {
  invariantFields.add(invariantMatch[1]);
}

const missing = [...inventoryFields].filter((field) => !invariantFields.has(field));
if (missing.length > 0) {
  console.error("Missing invariants for InventoryItem fields:");
  for (const field of missing) {
    console.error(` - ${field}`);
  }
  process.exit(1);
}

console.log(`✓ check-invariants: ${inventoryFields.size} InventoryItem fields covered`);

