#!/usr/bin/env node

import { executeOperationJob, inspectOperationJob } from "./store.mjs";

const [home, jobId] = process.argv.slice(2);
if (!home || !jobId) process.exit(2);

try {
  const deadline = Date.now() + 2000;
  let bound = false;
  while (Date.now() < deadline) {
    const job = inspectOperationJob({ home, jobId });
    if (job.workerPid === process.pid) { bound = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!bound) process.exit(3);
  await executeOperationJob(home, jobId);
  process.exit(0);
} catch {
  process.exit(1);
}
