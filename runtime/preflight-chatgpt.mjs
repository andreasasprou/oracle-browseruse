#!/usr/bin/env node
// preflight-chatgpt — prove a Browser Use cloud browser can actually talk to
// ChatGPT's backend before Oracle spends a prompt on it.
//
// Why this exists (2026-08-22): a cloud browser occasionally comes up with a
// broken path to ChatGPT (residential proxy hiccup). The cached app shell still
// renders a composer, a profile button, and history, so Oracle's login probe
// classifies the page as authenticated:
//
//   navigation.js:classifyAuth
//     session.status = 0        (/api/auth/session fetch threw)
//     backend.status = 0        (/backend-api/me fetch threw)
//     appSignal      = true     (cached shell)
//     => authenticated = true
//
// Oracle then types the whole prompt, clicks send, and the POST never reaches
// the backend. The prompt sits in the editor for 60s and the run dies with
//   {stage: submit-prompt, code: prompt-commit-timeout, turnsCount: 0,
//    composerCleared: false, inConversation: false}
// having produced nothing. This script turns that silent 60s loss into a fast,
// retryable verdict before any prompt is typed.
//
// Usage:  node preflight-chatgpt.mjs <browser-ws-url>
// Prints one JSON line. Exit 0 = usable. Exit 3 = transient, create a new
// browser and retry. Exit 4 = a human must sign in. Exit 2 = usage or probe error.

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(import.meta.dirname, "node_modules/@steipete/oracle/package.json"));
const CDP = require("chrome-remote-interface");

const WS = process.argv[2];
const DEADLINE_MS = Number(process.env.ORACLE_PREFLIGHT_TIMEOUT_MS ?? 45_000);

if (!WS) {
  console.log(JSON.stringify({ ok: false, reason: "usage", detail: "missing <browser-ws-url>" }));
  process.exit(2);
}

const EXIT = { ok: 0, error: 2, transient: 3, human: 4 };
const verdict = (code, body) => {
  console.log(JSON.stringify(body));
  process.exit(code);
};

const PROBE = `(async () => {
  // Parse inside the page: /api/auth/session puts WARNING_BANNER before user,
  // so any truncation of the raw body destroys the auth signal.
  const readSession = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'include', signal: controller.signal });
      const status = response.status || 0;
      if (status !== 200) return { status, authenticated: false, email: null, expires: null, error: null };
      try {
        const body = await response.json();
        const user = body && typeof body === 'object' ? body.user : null;
        return {
          status,
          authenticated: Boolean(user),
          email: user && user.email ? String(user.email) : null,
          expires: body && body.expires ? String(body.expires) : null,
          error: null,
        };
      } catch (err) {
        return { status, authenticated: false, email: null, expires: null, error: 'unparseable-session-body' };
      }
    } catch (err) {
      return { status: 0, authenticated: false, email: null, expires: null, error: err ? String(err).slice(0, 160) : 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  };
  const session = await readSession();
  const title = String(document.title || '');
  const bodyText = String(document.body && document.body.innerText || '').slice(0, 300);
  const cloudflare = /just a moment|attention required|verify you are human|cf-browser-verification/i.test(title + ' ' + bodyText);
  return {
    href: location.href,
    sessionStatus: session.status,
    sessionError: session.error,
    authenticated: session.authenticated,
    accountEmail: session.email,
    sessionExpires: session.expires,
    cloudflare,
    title,
  };
})()`;

let browser;
let client;
let targetId;

const cleanup = async () => {
  try { if (client) await client.close(); } catch {}
  try { if (browser && targetId) await browser.Target.closeTarget({ targetId }); } catch {}
  try { if (browser) await browser.close(); } catch {}
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  browser = await CDP({ target: WS, local: true });
  ({ targetId } = await browser.Target.createTarget({ url: "about:blank" }));
  const pageWs = `${WS.replace(/\/devtools\/browser\/.*/, "")}/devtools/page/${targetId}`;
  client = await CDP({ target: pageWs, local: true });

  const { Page, Runtime } = client;
  await Page.enable();
  await Runtime.enable();
  await Page.navigate({ url: "https://chatgpt.com/" });

  const deadline = Date.now() + DEADLINE_MS;
  let last = null;
  while (Date.now() < deadline) {
    await delay(2000);
    const { result } = await Runtime.evaluate({ expression: PROBE, awaitPromise: true, returnByValue: true });
    last = result?.value ?? last;
    if (last && last.sessionStatus === 200 && last.authenticated) {
      await cleanup();
      verdict(EXIT.ok, { ok: true, reason: "authenticated", account: last.accountEmail, href: last.href });
    }
    // 401/403 with a resolved response is a real signed-out profile, not a network fault.
    if (last && (last.sessionStatus === 401 || last.sessionStatus === 403) && !last.cloudflare) {
      await cleanup();
      verdict(EXIT.human, { ok: false, reason: "signed-out", sessionStatus: last.sessionStatus, href: last.href });
    }
  }

  await cleanup();
  if (last?.cloudflare) {
    verdict(EXIT.transient, { ok: false, reason: "cloudflare", title: last.title, href: last.href });
  }
  if (last && last.sessionStatus === 200 && !last.authenticated) {
    verdict(EXIT.human, { ok: false, reason: "no-user-in-session", href: last.href });
  }
  verdict(EXIT.transient, {
    ok: false,
    reason: "backend-unreachable",
    sessionStatus: last?.sessionStatus ?? null,
    sessionError: last?.sessionError ?? null,
    href: last?.href ?? null,
  });
} catch (err) {
  await cleanup();
  const key = process.env.BROWSER_USE_API_KEY;
  const detail = String(err).replaceAll(WS, "<redacted-browser-endpoint>");
  verdict(EXIT.error, { ok: false, reason: "probe-error", detail: key ? detail.replaceAll(key, "<redacted-key>") : detail });
}
