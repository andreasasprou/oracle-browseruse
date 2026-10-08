#!/usr/bin/env node
// ChatGPT renamed the model picker's "Latest" radio to "GPT-6" (seen 2026-10-07:
// "Available: GPT-6, GPT-5.6 Sol, GPT-5.5"). Oracle maps gpt-6-astra to the
// "Latest" target and accepts only an exact allow-list of labels for it, in three
// places in modelSelection.js:
//   1. isLatestModelLabel (finding and clicking the radio);
//   2. assertResolvedModelSelection (verifying what was selected);
//   3. isNewerModelLabel (treating Latest as newest).
// Add the exact label "GPT-6" to each. It stays exact: "GPT-5.6 Sol" or a
// "GPT-6 Pro"-style row can never satisfy a Latest request. Upstream 0.21.4
// still maps to "Latest", so this is local until upstream follows.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "/* oracle gpt-6 label patch */"
const EDITS = [
  {
    before: "return label === 'Latest' || label === '最新' || label === '최신';",
    after: `return label === 'Latest' || label === 'GPT-6' ${MARKER} || label === '最新' || label === '최신';`,
  },
  {
    before: 'if (resolvedLabel.normalize("NFC").trim() === "Latest" ||',
    after: `if (resolvedLabel.normalize("NFC").trim() === "Latest" || resolvedLabel.normalize("NFC").trim() === "GPT-6" ${MARKER} ||`,
  },
  {
    before: "const latest = /^(?:Latest|最新|최신)$/i;",
    after: `const latest = /^(?:Latest|GPT-6|最新|최신)$/i; ${MARKER}`,
  },
]

const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply"

const globalRoot = path.join(import.meta.dirname, "node_modules")
const target = path.join(globalRoot, "@steipete/oracle/dist/src/browser/actions/modelSelection.js")
const backup = `${target}.orig-gpt6-label`

if (!existsSync(target)) {
  console.error(`patch-gpt6-label: not found: ${target}`)
  process.exit(1)
}

const source = readFileSync(target, "utf8")
const appliedCount = source.split(MARKER).length - 1
const applied = appliedCount === EDITS.length

if (mode === "check") process.exit(applied ? 0 : 1)

if (mode === "revert") {
  if (appliedCount === 0) process.exit(0)
  let reverted = source
  for (const edit of EDITS) reverted = reverted.replace(edit.after, edit.before)
  writeFileSync(target, reverted)
  console.error("patch-gpt6-label: reverted")
  process.exit(0)
}

if (applied) process.exit(0)
if (appliedCount !== 0) {
  console.error(`patch-gpt6-label: partially applied (${appliedCount}/${EDITS.length}); run --revert, then apply`)
  process.exit(1)
}
let patched = source
for (const edit of EDITS) {
  const occurrences = patched.split(edit.before).length - 1
  if (occurrences !== 1) {
    console.error(`patch-gpt6-label: expected exactly 1 match for: ${edit.before} (found ${occurrences}); review before patching`)
    process.exit(1)
  }
  patched = patched.replace(edit.before, edit.after)
}
copyFileSync(target, backup)
writeFileSync(target, patched)
console.error("patch-gpt6-label: applied")
