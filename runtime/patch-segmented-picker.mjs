#!/usr/bin/env node
// Teach Oracle ChatGPT's 2026-09-25 composer, which dropped the data-testid
// attributes Oracle keys on. Upstream PR #516 (bundled in our 0.21.3+pr516
// build) restores the pill, slider, turn, and send selectors; this patch covers
// the two gaps it leaves on this account:
//
// 1. Model selection. The pill `button[aria-label="Select ChatGPT model"]`
//    opens a `[data-model-picker-view="simple"|"advanced"]` menu. The simple
//    view holds the effort slider and a `[data-model-picker-view-toggle]` item;
//    the advanced view holds the model radios (Latest, GPT-5.6 Sol, ...) as
//    `[role="menuitemradio"][aria-checked]`. Oracle's legacy flow looks for an
//    Advanced -> Model submenu by test id and never finds the radios. This adds
//    a direct path: open, switch to advanced, click the exact radio, verify
//    aria-checked. Menus without `[data-model-picker-view]` fall through to the
//    upstream flow unchanged.
//
// 2. Login fallback. When /api/auth/session is slow through the Browser Use
//    proxy, Oracle falls back to DOM proof of login, which looked for the
//    removed `accounts-profile-button` / `history-item-*` test ids. Accept the
//    `Open profile menu` button as the same proof.
//
// 3. Login timing. The remote path probes login right after navigation. When
//    both auth fetches time out and the app has not rendered yet, the result
//    is inconclusive, yet Oracle reported "not signed in". Re-probe for up to
//    30s while there is no definitive signed-out signal (login button, auth
//    page, or 401/403). oracle-bu's preflight has already proven the login.
//
// 4. Completion proof. The assistant action row (Copy, Rate response,
//    Regenerate response) now renders beside the assistant unit inside the
//    exchange container `[data-turn-key]`, not inside the unit, so Oracle never
//    saw the turn finish and waited out its timeout. Also look in the exchange
//    when it holds exactly one assistant unit. The Copy button used for
//    markdown capture moved the same way; without it Oracle falls back to page
//    text ("ChatGPT said:" header, no markdown). Code blocks inside the answer
//    carry their own `aria-label="Copy"` buttons, so prefer the exchange's
//    action-row Copy outside the unit and never one inside the message body;
//    otherwise Oracle copies a single code block as the whole answer.
//
// 5. Snapshot text. The assistant unit starts with a screen-reader heading
//    ("ChatGPT said:") before the message body. The snapshot read the whole
//    unit, so its text was longer than the copied markdown and Oracle's final
//    sanity check replaced the markdown with it. Read the single
//    `[data-chatgpt-selection-message-id]` body when there is exactly one,
//    ahead of Oracle's `[class*="markdown"]` fallback, which now matches an
//    inline-code `span.inline-markdown` and truncates the snapshot to a word.
//
// 6. Stuck page load. About 1 in 6 cloud-browser loads leave the profile
//    button on "Loading profile" and never mount the model pill (captured
//    2026-09-25: visible, focused, 1512x770, no pill after 25s). Oracle's three
//    picker attempts all poll that same dead page and fail with "Unable to
//    locate the ChatGPT model selector button". Reload once and wait 20s more
//    before failing. The segmented path also reopens the menu instead of
//    reading a null root if ChatGPT closes it mid-hydration.
//
// Usage: node ~/.oracle/patch-segmented-picker.mjs [--check] [--revert]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "// --- oracle segmented picker patch ---"
const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply"

const globalRoot = path.join(import.meta.dirname, "node_modules")
const browserDir = path.join(globalRoot, "@steipete/oracle/dist/src/browser")

const MODEL_ANCHOR = "    return new Promise((resolve) => {\n      const start = performance.now();"
const MODEL_REPLACEMENT = `    ${MARKER} model
    const selectInSegmentedPicker = async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (probe, timeoutMs) => {
        const deadline = performance.now() + timeoutMs;
        for (;;) {
          const value = probe();
          if (value || performance.now() > deadline) return value;
          await sleep(100);
        }
      };
      const findRoot = () => document.querySelector('[role="menu"] [data-model-picker-view]');
      // closeMenu() toggles the pill, so only call it while the picker is open.
      const closeIfOpen = () => {
        if (document.querySelector('[role="menu"]')) closeMenu();
      };
      const radioName = (radio) =>
        (radio.querySelector('span')?.textContent ?? radio.textContent ?? '').trim();
      const radios = () => Array.from(findRoot()?.querySelectorAll('[role="menuitemradio"]') ?? []);
      const checkedName = () => {
        const checked = radios().find((radio) => radio.getAttribute('aria-checked') === 'true');
        return checked ? radioName(checked) : null;
      };
      const isTarget = (name) =>
        targetIsLatest ? isLatestModelLabel(name) : normalizedTokens.includes(normalizeText(name));
      const openPicker = async () => {
        if (findRoot()) return findRoot();
        const button = findModelButton();
        if (!button) return null;
        dispatchClickSequence(button);
        return waitFor(findRoot, 3000);
      };

      if (!findModelButton() || !(await openPicker())) {
        closeIfOpen();
        return null;
      }
      const current = checkedName();
      if (MODEL_STRATEGY === 'current' || (current && isTarget(current))) {
        closeIfOpen();
        return { status: 'already-selected', label: current };
      }
      const available = radios().map(radioName);
      const target = radios().find((radio) => isTarget(radioName(radio)));
      if (!target) {
        closeIfOpen();
        return { status: 'option-not-found', hint: { temporaryChat: false, availableOptions: available } };
      }
      // A just-hydrated page can close the menu between reads; reopen, never deref null.
      const root = findRoot() ?? (await openPicker());
      if (root && root.getAttribute('data-model-picker-view') !== 'advanced') {
        const toggle = root.querySelector('[data-model-picker-view-toggle="true"]');
        if (toggle) dispatchClickSequence(toggle);
        await waitFor(() => findRoot()?.getAttribute('data-model-picker-view') === 'advanced', 3000);
      }
      const targetName = radioName(target);
      const liveTarget = radios().find((radio) => radioName(radio) === targetName) ?? target;
      dispatchClickSequence(liveTarget);
      // Radix may close the menu on select; the inert advanced view still carries
      // aria-checked, so reopen and read the radio rather than trusting the click.
      await sleep(600);
      await openPicker();
      const verified = await waitFor(() => {
        const name = checkedName();
        return name && isTarget(name) ? name : null;
      }, 5000);
      const observed = verified ?? checkedName();
      closeIfOpen();
      if (!verified) {
        return { status: 'option-not-found', hint: { temporaryChat: false, availableOptions: available } };
      }
      return { status: 'switched', label: observed };
    };

    return new Promise(async (resolve) => {
      const segmented = await selectInSegmentedPicker();
      if (segmented) {
        resolve(segmented);
        return;
      }
      const start = performance.now();`

const AUTH_ANCHOR =
  "      const profileButton = document.querySelector('[data-testid=\"accounts-profile-button\"]');"
const AUTH_REPLACEMENT = `      ${MARKER} auth-signal
      const profileButton = document.querySelector('[data-testid="accounts-profile-button"], button[aria-label="Open profile menu"]');`

const PROBE_ANCHOR = `    const outcome = await Runtime.evaluate({
        expression: buildLoginProbeExpression(LOGIN_CHECK_TIMEOUT_MS),
        awaitPromise: true,
        returnByValue: true,
    });
    const probe = normalizeLoginProbe(outcome.result?.value);
    if (probe.ok) {`
const PROBE_REPLACEMENT = `    ${MARKER} probe-retry
    const runLoginProbe = async () => normalizeLoginProbe((await Runtime.evaluate({
        expression: buildLoginProbeExpression(LOGIN_CHECK_TIMEOUT_MS),
        awaitPromise: true,
        returnByValue: true,
    })).result?.value);
    const isInconclusive = (p) => !p.ok && !p.domLoginCta && !p.onAuthPage && p.status !== 401 && p.status !== 403;
    let probe = await runLoginProbe();
    const inconclusiveDeadline = Date.now() + 30_000;
    while (isInconclusive(probe) && Date.now() < inconclusiveDeadline) {
        logger(\`Login probe inconclusive (sessionStatus=\${probe.status}, backendStatus=\${probe.backendStatus ?? "n/a"}); re-probing\`);
        await delay(2000);
        probe = await runLoginProbe();
    }
    if (probe.ok) {`

// Both anchors sit inside template literals in the dist; keep the \${...}
// interpolation text verbatim.
const GATE_ANCHOR = "    if (lastAssistantTurn.querySelector('${FINISHED_ACTIONS_SELECTOR}')) return true;"
const GATE_REPLACEMENT = [
  `    ${MARKER} completion-gate`,
  GATE_ANCHOR,
  "    const exchange = lastAssistantTurn.closest('[data-turn-key]');",
  "    if (exchange && exchange.querySelectorAll('[data-chatgpt-search-unit-key$=\":assistant\"]').length === 1 &&",
  "      exchange.querySelector('${FINISHED_ACTIONS_SELECTOR}')) return true;",
].join("\n")
const OBSERVER_ANCHOR = "      if (lastAssistantTurn.querySelector(FINISHED_SELECTOR)) return true;"
const OBSERVER_REPLACEMENT = [
  `      ${MARKER} completion-observer`,
  OBSERVER_ANCHOR,
  "      const exchange = lastAssistantTurn.closest('[data-turn-key]');",
  "      if (exchange && exchange.querySelectorAll('[data-chatgpt-search-unit-key$=\":assistant\"]').length === 1 &&",
  "        exchange.querySelector(FINISHED_SELECTOR)) return true;",
].join("\n")
const COPY_ANCHOR = "        const button = turn.querySelector(BUTTON_SELECTOR);"
const COPY_REPLACEMENT = [
  `        ${MARKER} copy-button`,
  "        const exchange = turn.closest('[data-turn-key]');",
  "        const actionRow = exchange && exchange.querySelectorAll('[data-chatgpt-search-unit-key$=\":assistant\"]').length === 1",
  "          ? Array.from(exchange.querySelectorAll(BUTTON_SELECTOR)).filter((b) => !turn.contains(b))",
  "          : [];",
  "        const button = actionRow.at(-1) ??",
  "          Array.from(turn.querySelectorAll(BUTTON_SELECTOR)).find((b) => !b.closest('[data-chatgpt-selection-message-id]')) ??",
  "          null;",
].join("\n")
const CONTENT_ANCHOR = "      const contentRoot = preferred ?? messageRoot;"
const CONTENT_REPLACEMENT = [
  `      ${MARKER} content-root`,
  "      const selectionBodies = messageRoot.querySelectorAll('[data-chatgpt-selection-message-id]');",
  "      const usablePreferred = preferred && !preferred.classList?.contains('inline-markdown') ? preferred : null;",
  "      const contentRoot = selectionBodies.length === 1 ? selectionBodies[0] : (usablePreferred ?? messageRoot);",
].join("\n")

// Some page loads never fetch account data ("Loading profile" forever), so the
// model pill never mounts and Oracle fails all three attempts on one dead page.
const RETRY_ANCHOR = `        result = outcome.result?.value;
        if (result?.status !== "button-missing" || Date.now() >= deadline) {`
const RETRY_REPLACEMENT = `        ${MARKER} model-retry
        result = outcome.result?.value;
        if (result?.status === "button-missing" && Date.now() >= deadline && !options.reloadedForPicker) {
            options = { ...options, reloadedForPicker: true };
            logger("Model picker never mounted (account data stuck loading); reloading ChatGPT once");
            await Runtime.evaluate({ expression: "location.reload()" }).catch(() => undefined);
            await delay(3000);
            deadline = Date.now() + 20000;
            continue;
        }
        // Mid-reload the expression returns nothing; keep waiting instead of failing.
        const reloading = options.reloadedForPicker && !result?.status;
        if ((result?.status !== "button-missing" && !reloading) || Date.now() >= deadline) {`

const edits = [
  { name: "model", file: "actions/modelSelection.js", anchor: MODEL_ANCHOR, replacement: MODEL_REPLACEMENT },
  { name: "model-retry", file: "actions/modelSelection.js", anchor: RETRY_ANCHOR, replacement: RETRY_REPLACEMENT },
  { name: "auth-signal", file: "actions/navigation.js", anchor: AUTH_ANCHOR, replacement: AUTH_REPLACEMENT },
  { name: "probe-retry", file: "actions/navigation.js", anchor: PROBE_ANCHOR, replacement: PROBE_REPLACEMENT },
  { name: "completion-gate", file: "actions/assistantResponse.js", anchor: GATE_ANCHOR, replacement: GATE_REPLACEMENT },
  { name: "completion-observer", file: "actions/assistantResponse.js", anchor: OBSERVER_ANCHOR, replacement: OBSERVER_REPLACEMENT },
  { name: "copy-button", file: "actions/assistantResponse.js", anchor: COPY_ANCHOR, replacement: COPY_REPLACEMENT },
  { name: "content-root", file: "actions/assistantResponse.js", anchor: CONTENT_ANCHOR, replacement: CONTENT_REPLACEMENT },
].map((edit) => ({ ...edit, target: path.join(browserDir, edit.file) }))
const targets = [...new Set(edits.map((edit) => edit.target))]

for (const target of targets) {
  if (!existsSync(target)) {
    console.error(`patch-segmented-picker: not found: ${target}`)
    process.exit(1)
  }
}

const isPatched = ({ target, name }) => readFileSync(target, "utf8").includes(`${MARKER} ${name}`)

if (mode === "check") {
  const missing = edits.filter((edit) => !isPatched(edit))
  for (const edit of edits) {
    console.log(`${missing.includes(edit) ? "NOT patched" : "patched"}: ${edit.name} in ${edit.target}`)
  }
  process.exit(missing.length === 0 ? 0 : 1)
}

if (mode === "revert") {
  for (const target of targets) {
    const backup = `${target}.orig-segmented-picker`
    if (!existsSync(backup)) {
      console.error(`patch-segmented-picker: no backup at ${backup}`)
      process.exit(1)
    }
    copyFileSync(backup, target)
    console.log(`reverted ${target}`)
  }
  process.exit(0)
}

// Validate every anchor before writing any file so a partial apply cannot happen.
for (const edit of edits) {
  if (isPatched(edit)) continue
  const hits = readFileSync(edit.target, "utf8").split(edit.anchor).length - 1
  if (hits !== 1) {
    console.error(
      `patch-segmented-picker: anchor in ${edit.file} matched ${hits} times, expected 1. Oracle's dist changed; update this patch.`,
    )
    process.exit(1)
  }
}

for (const edit of edits) {
  if (isPatched(edit)) continue
  const backup = `${edit.target}.orig-segmented-picker`
  const source = readFileSync(edit.target, "utf8")
  if (!existsSync(backup)) copyFileSync(edit.target, backup)
  writeFileSync(edit.target, source.replace(edit.anchor, edit.replacement), "utf8")
  console.log(`patched ${edit.name}: ${edit.target}\nbackup  ${backup}`)
}
