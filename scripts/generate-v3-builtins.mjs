import path from "node:path";
import { discoverAssets } from "../src/v3/catalog.mjs";

// Built-ins contain reviewed, domain-neutral components only. Professional
// migration remains an explicit user Workspace operation, never a build step.
const root = path.resolve(import.meta.dirname, "..");
const assets = discoverAssets([path.join(root, "assets/v3/components")]);
if (!assets.length || assets.some(record => record.asset.kind !== "HarnessComponent")) throw new Error("Built-in supply must contain only generic components.");
process.stdout.write(`${JSON.stringify({ status: "VALIDATED", generated: false, assetCount: assets.length })}\n`);
