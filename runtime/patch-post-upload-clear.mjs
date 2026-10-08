#!/usr/bin/env node
// Re-clear the ChatGPT prompt text after Oracle uploads attachments.
// Attachment upload can outlast initial page hydration, allowing ChatGPT to
// restore a stale persisted draft after Oracle's first clear. Attachments use
// separate state, so clearing text again immediately before submit is safe.
//
// Usage: node ~/.oracle/patch-post-upload-clear.mjs [--check] [--revert]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "// --- oracle post-upload composer clear patch ---"
const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply"

const globalRoot = path.join(import.meta.dirname, "node_modules")
const target = path.join(globalRoot, "@steipete/oracle/dist/src/browser/index.js")
const backup = `${target}.orig-post-upload-clear`

if (!existsSync(target)) {
  console.error(`patch-post-upload-clear: not found: ${target}`)
  process.exit(1)
}

const source = readFileSync(target, "utf8")
const markerCount = source.split(MARKER).length - 1

if (mode === "check") {
  console.log(markerCount === 2 ? `patched: ${target}` : `NOT patched: ${target}`)
  process.exit(markerCount === 2 ? 0 : 1)
}

if (mode === "revert") {
  if (!existsSync(backup)) {
    console.error(`patch-post-upload-clear: no backup at ${backup}`)
    process.exit(1)
  }
  copyFileSync(backup, target)
  console.log(`reverted ${target}`)
  process.exit(0)
}

if (markerCount === 2) {
  console.log(`patch-post-upload-clear: already applied to ${target}`)
  process.exit(0)
}
if (markerCount !== 0) {
  console.error(`patch-post-upload-clear: found ${markerCount} partial markers; review before patching.`)
  process.exit(1)
}

const anchor = `                await waitForAttachmentCompletion(Runtime, attachmentWaitBudget, attachmentNames, logger);
                logger("All attachments uploaded");`
const hits = source.split(anchor).length - 1
if (hits !== 2) {
  console.error(`patch-post-upload-clear: anchor matched ${hits} times, expected 2. Oracle's dist changed; review before patching.`)
  process.exit(1)
}

const localBlock = `${anchor}
                ${MARKER}
                // Uploading gives ChatGPT enough time to hydrate a persisted
                // draft after the initial clear. Remove and settle that text
                // again immediately before submit; attachments are separate
                // composer state and remain attached.
                await raceWithDisconnect(clearPromptComposer(Runtime, logger));
                await raceWithDisconnect(ensurePromptReady(Runtime, config.inputTimeoutMs, logger));`
const remoteBlock = `${anchor}
                ${MARKER}
                await clearPromptComposer(Runtime, logger);
                await ensurePromptReady(Runtime, config.inputTimeoutMs, logger);`

const first = source.indexOf(anchor)
const afterFirst = source.slice(0, first) + localBlock + source.slice(first + anchor.length)
const second = afterFirst.indexOf(anchor, first + localBlock.length)
if (second < 0) {
  console.error("patch-post-upload-clear: second anchor disappeared during patch assembly")
  process.exit(1)
}
const next = afterFirst.slice(0, second) + remoteBlock + afterFirst.slice(second + anchor.length)

if (!existsSync(backup)) copyFileSync(target, backup)
writeFileSync(target, next, "utf8")
console.log(`patched ${target}\nbackup  ${backup}`)
