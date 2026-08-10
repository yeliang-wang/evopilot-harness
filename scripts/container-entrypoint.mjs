import path from "node:path";
import { defaultHarnessHome } from "../src/v3/constants.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { serveHubV3 } from "../src/v3/hub.mjs";

const home = defaultHarnessHome();
initializeWorkspace(home);
serveHubV3(home, {
  host: process.env.EVOPILOT_HARNESS_HUB_HOST || "0.0.0.0",
  port: Number(process.env.EVOPILOT_HARNESS_HUB_PORT || 4176)
});
