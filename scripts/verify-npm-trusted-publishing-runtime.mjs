#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export function verifyTrustedPublishingEnvironment(environment = process.env) {
  if (typeof environment.NODE_AUTH_TOKEN === "string" && environment.NODE_AUTH_TOKEN.length > 0) {
    const error = new Error("Trusted Publishing must not use NODE_AUTH_TOKEN");
    error.code = "NODE_AUTH_TOKEN_FORBIDDEN";
    throw error;
  }
  return {
    schema: "evopilot-harness-npm-trusted-publishing-runtime/v1",
    status: "READY",
    authentication: "OIDC_TRUSTED_PUBLISHING",
    tokenFallback: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(verifyTrustedPublishingEnvironment(), null, 2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
