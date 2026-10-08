#!/usr/bin/env node
// Add one bounded ChatGPT submit retry to Oracle.
//
// Browser Use profiles can retain a new-chat composer that accepts text and
// exposes an enabled Send button but does not commit the first click. Oracle's
// normal 60-second commit probe already distinguishes that exact no-send state
// from ambiguous outcomes. This patch reloads and retries once only when all
// no-send signals agree. It never retries a started/ambiguous conversation.
//
// Usage: node ~/.oracle/patch-submit-recovery.mjs [--check] [--revert]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "// --- oracle proven-uncommitted submit retry patch ---"
const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply"

const globalRoot = path.join(import.meta.dirname, "node_modules")
const target = path.join(globalRoot, "@steipete/oracle/dist/src/browser/index.js")
const backup = `${target}.orig-submit-recovery`

if (!existsSync(target)) {
  console.error(`patch-submit-recovery: not found: ${target}`)
  process.exit(1)
}

const source = readFileSync(target, "utf8")
const patched = source.includes(MARKER)

if (mode === "check") {
  console.log(patched ? `patched: ${target}` : `NOT patched: ${target}`)
  process.exit(patched ? 0 : 1)
}

if (mode === "revert") {
  if (!existsSync(backup)) {
    console.error(`patch-submit-recovery: no backup at ${backup}`)
    process.exit(1)
  }
  copyFileSync(backup, target)
  console.log(`reverted ${target}`)
  process.exit(0)
}

if (patched) {
  console.log(`patch-submit-recovery: already applied to ${target}`)
  process.exit(0)
}

const helperAnchor = `function hasBrowserErrorCode(error, code) {
    return (error instanceof BrowserAutomationError &&
        error.details?.code === code);
}`

const helperBlock = `${helperAnchor}
${MARKER}
// A prompt-commit timeout is normally ambiguous and must not be retried: ChatGPT
// may have accepted the request while the browser missed the UI update. Retry
// only when every observed signal says the prompt never left the new-chat
// composer. This exact state is produced by a stale Browser Use profile draft:
// the text remains, the URL never becomes /c/*, and no turn or assistant state
// appears. One reload clears that dead composer without risking a duplicate
// request in an already-started conversation.
function isProvenUncommittedPromptTimeout(error) {
    if (!hasBrowserErrorCode(error, "prompt-commit-timeout"))
        return false;
    const probe = error.details?.commitProbe;
    if (!probe || typeof probe !== "object")
        return false;
    const baseline = probe.baseline;
    const turnsCount = probe.turnsCount;
    return (typeof baseline === "number" &&
        Number.isFinite(baseline) &&
        baseline >= 0 &&
        typeof turnsCount === "number" &&
        Number.isFinite(turnsCount) &&
        turnsCount === baseline &&
        probe.userMatched === false &&
        probe.prefixMatched === false &&
        probe.lastMatched === false &&
        probe.hasNewTurn === false &&
        probe.stopVisible === false &&
        probe.assistantVisible === false &&
        probe.composerCleared === false &&
        probe.inConversation === false);
}`

const stateAnchor = `    let retriedDeadComposer = false;
    let usedFallbackSubmission = false;`
const stateBlock = `    let retriedDeadComposer = false;
    let retriedProvenUncommittedPrompt = false;
    let usedFallbackSubmission = false;`

const catchAnchor = `        catch (error) {
            const isDeadComposer = hasBrowserErrorCode(error, "dead-composer");`
const catchBlock = `        catch (error) {
            if (isProvenUncommittedPromptTimeout(error) && !retriedProvenUncommittedPrompt) {
                retriedProvenUncommittedPrompt = true;
                logger("[browser] Prompt remained uncommitted in the new-chat composer; reloading and retrying once.");
                await reloadPromptComposer();
                continue;
            }
            const isDeadComposer = hasBrowserErrorCode(error, "dead-composer");`

for (const [name, anchor] of [
  ["helper", helperAnchor],
  ["state", stateAnchor],
  ["catch", catchAnchor],
]) {
  const hits = source.split(anchor).length - 1
  if (hits !== 1) {
    console.error(`patch-submit-recovery: ${name} anchor matched ${hits} times, expected 1. Oracle's dist changed; review before patching.`)
    process.exit(1)
  }
}

if (!existsSync(backup)) copyFileSync(target, backup)
const next = source
  .replace(helperAnchor, helperBlock)
  .replace(stateAnchor, stateBlock)
  .replace(catchAnchor, catchBlock)
writeFileSync(target, next, "utf8")
console.log(`patched ${target}\nbackup  ${backup}`)
