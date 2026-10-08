#!/usr/bin/env node
// Teach Oracle to accept a remote Chrome DevTools WebSocket URL from the
// environment, so it can drive a Browser Use cloud browser.
//
// Oracle already implements the WSS transport end to end:
//   browser/config.js:51                remoteChromeBrowserWSEndpoint field
//   browser/index.js:2249,2280          passes it to connectToRemoteChrome()
//   browser/chromeLifecycle.js:130,237  CDP({ target: wssUrl, local: true })
// Only the entry point is missing: the CLI's --remote-chrome parser accepts
// host:port and nothing else. This patch adds ORACLE_REMOTE_CHROME_WS.
//
// The patch lives in the globally installed dist/, so `npm i -g
// @steipete/oracle` wipes it. Re-run this script after every Oracle upgrade.
//
// Usage:  node ~/.oracle/patch-browseruse.mjs [--check] [--revert]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MARKER = "// --- oracle browser-use patch ---";

const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply";

const globalRoot = path.join(import.meta.dirname, "node_modules");
const target = path.join(globalRoot, "@steipete/oracle/dist/src/browser/config.js");
const backup = `${target}.orig-browseruse`;

if (!existsSync(target)) {
  console.error(`patch-browseruse: not found: ${target}`);
  process.exit(1);
}

const source = readFileSync(target, "utf8");
const patched = source.includes(MARKER);

if (mode === "check") {
  console.log(patched ? `patched: ${target}` : `NOT patched: ${target}`);
  process.exit(patched ? 0 : 1);
}

if (mode === "revert") {
  if (!existsSync(backup)) {
    console.error(`patch-browseruse: no backup at ${backup}`);
    process.exit(1);
  }
  copyFileSync(backup, target);
  console.log(`reverted ${target}`);
  process.exit(0);
}

if (patched) {
  console.log(`patch-browseruse: already applied to ${target}`);
  process.exit(0);
}

// resolveBrowserConfig() is the single funnel every entry path goes through
// (tui/index.js, projectSourcesRunner.js, recoverConversation.js, reattach.js)
// and it already reads ORACLE_BROWSER_* env vars, so this is the idiomatic seam.
const ANCHOR_RETURN = `    return {
        ...DEFAULT_BROWSER_CONFIG,
        ...config,`;

const ENV_BLOCK = `    ${MARKER}
    // Point Oracle at a remote CDP WebSocket (e.g. a Browser Use cloud browser).
    // remoteChrome must also be set: index.js:665 gates the whole remote path on it.
    const envRemoteChromeWsRaw = (process.env.ORACLE_REMOTE_CHROME_WS ?? "").trim();
    let envRemoteChrome = null;
    let envRemoteChromeWs = null;
    if (envRemoteChromeWsRaw) {
        let parsedRemoteChromeWs;
        try {
            parsedRemoteChromeWs = new URL(envRemoteChromeWsRaw);
        }
        catch {
            throw new Error("ORACLE_REMOTE_CHROME_WS is not a valid URL.");
        }
        if (parsedRemoteChromeWs.protocol !== "wss:" && parsedRemoteChromeWs.protocol !== "ws:") {
            throw new Error("ORACLE_REMOTE_CHROME_WS must be a ws:// or wss:// URL.");
        }
        envRemoteChrome = {
            host: parsedRemoteChromeWs.hostname,
            port: parsedRemoteChromeWs.port
                ? Number(parsedRemoteChromeWs.port)
                : parsedRemoteChromeWs.protocol === "wss:" ? 443 : 80,
        };
        envRemoteChromeWs = envRemoteChromeWsRaw;
    }
${ANCHOR_RETURN}`;

const ANCHOR_FIELD =
  "        remoteChromeBrowserWSEndpoint: config?.remoteChromeBrowserWSEndpoint ?? DEFAULT_BROWSER_CONFIG.remoteChromeBrowserWSEndpoint,";

const FIELD_BLOCK = `        remoteChrome: envRemoteChrome ?? config?.remoteChrome ?? DEFAULT_BROWSER_CONFIG.remoteChrome,
        remoteChromeBrowserWSEndpoint: envRemoteChromeWs ?? config?.remoteChromeBrowserWSEndpoint ?? DEFAULT_BROWSER_CONFIG.remoteChromeBrowserWSEndpoint,`;

for (const [name, anchor] of [["return", ANCHOR_RETURN], ["field", ANCHOR_FIELD]]) {
  const hits = source.split(anchor).length - 1;
  if (hits !== 1) {
    console.error(`patch-browseruse: ${name} anchor matched ${hits} times, expected 1. Oracle's dist changed; update this patch.`);
    process.exit(1);
  }
}

const next = source.replace(ANCHOR_RETURN, ENV_BLOCK).replace(ANCHOR_FIELD, FIELD_BLOCK);

if (!existsSync(backup)) copyFileSync(target, backup);
writeFileSync(target, next, "utf8");
console.log(`patched ${target}\nbackup  ${backup}`);
