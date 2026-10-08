#!/usr/bin/env node
// Make Oracle's ChatGPT composer clear wait for persisted-draft hydration.
//
// ChatGPT can restore ProseMirror text after the immediate clear check passes.
// Without a settled verification, Oracle appends the next prompt to the stale
// draft and the Send click may never commit. Clear, wait, verify, and retry up
// to three times before typing anything new.
//
// Usage: node ~/.oracle/patch-composer-clear.mjs [--check] [--revert]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "// --- oracle settled composer clear patch ---"
const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--check")
    ? "check"
    : "apply"

const globalRoot = path.join(import.meta.dirname, "node_modules")
const target = path.join(globalRoot, "@steipete/oracle/dist/src/browser/actions/promptComposer.js")
const backup = `${target}.orig-settled-clear`

if (!existsSync(target)) {
  console.error(`patch-composer-clear: not found: ${target}`)
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
    console.error(`patch-composer-clear: no backup at ${backup}`)
    process.exit(1)
  }
  copyFileSync(backup, target)
  console.log(`reverted ${target}`)
  process.exit(0)
}

if (patched) {
  console.log(`patch-composer-clear: already applied to ${target}`)
  process.exit(0)
}

const startAnchor = `export async function clearPromptComposer(Runtime, logger) {
    const primarySelectorLiteral = JSON.stringify(PROMPT_PRIMARY_SELECTOR);
    const fallbackSelectorLiteral = JSON.stringify(PROMPT_FALLBACK_SELECTOR);
    const inputSelectorsLiteral = JSON.stringify(INPUT_SELECTORS);
    const result = await Runtime.evaluate({
        expression: \`(() => {`

const startBlock = `${MARKER}
export async function clearPromptComposer(Runtime, logger) {
    const primarySelectorLiteral = JSON.stringify(PROMPT_PRIMARY_SELECTOR);
    const fallbackSelectorLiteral = JSON.stringify(PROMPT_FALLBACK_SELECTOR);
    const inputSelectorsLiteral = JSON.stringify(INPUT_SELECTORS);
    const clearExpression = \`(() => {`

const endAnchor = `    })()\`,
        returnByValue: true,
    });
    const value = result.result?.value;
    if (!value?.cleared || (value.remaining?.length ?? 0) > 0) {
        await logDomFailure(Runtime, logger, "clear-composer");
        throw new Error("Failed to clear prompt composer");
    }
    await delay(250);
}
async function waitForDomReady`

const endBlock = `    })()\`;
    const readExpression = \`(() => {
      const SELECTORS = \${inputSelectorsLiteral};
      const fallback = document.querySelector(\${fallbackSelectorLiteral});
      const editor = document.querySelector(\${primarySelectorLiteral});
      const readValue = (node) => {
        if (!node) return '';
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value ?? '';
        return node.innerText ?? node.textContent ?? '';
      };
      const nodes = SELECTORS
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      const remaining = Array.from(new Set([fallback, editor, ...nodes]))
        .filter(Boolean)
        .map((node) => readValue(node).trim())
        .filter(Boolean);
      return { remaining };
    })()\`;
    let lastRemaining = [];
    // ChatGPT can restore its persisted ProseMirror draft after the first clear
    // event. Verify after the React hydration window and clear once more when
    // that happens. Never type the new prompt onto a draft that returned late.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await Runtime.evaluate({
            expression: clearExpression,
            returnByValue: true,
        });
        const value = result.result?.value;
        if (!value?.cleared || (value.remaining?.length ?? 0) > 0) {
            await logDomFailure(Runtime, logger, "clear-composer");
            throw new Error("Failed to clear prompt composer");
        }
        await delay(350);
        const settled = await Runtime.evaluate({
            expression: readExpression,
            returnByValue: true,
        });
        lastRemaining = settled.result?.value?.remaining ?? [];
        if (lastRemaining.length === 0) {
            return;
        }
        logger?.(\`[browser] Persisted composer draft returned after clear; retrying cleanup (\${attempt + 1}/3).\`);
    }
    await logDomFailure(Runtime, logger, "clear-composer-restored");
    throw new Error(\`Failed to clear restored prompt composer draft (\${lastRemaining.length} value(s) remain)\`);
}
async function waitForDomReady`

for (const [name, anchor] of [["start", startAnchor], ["end", endAnchor]]) {
  const hits = source.split(anchor).length - 1
  if (hits !== 1) {
    console.error(`patch-composer-clear: ${name} anchor matched ${hits} times, expected 1. Oracle's dist changed; review before patching.`)
    process.exit(1)
  }
}

if (!existsSync(backup)) copyFileSync(target, backup)
const next = source.replace(startAnchor, startBlock).replace(endAnchor, endBlock)
writeFileSync(target, next, "utf8")
console.log(`patched ${target}\nbackup  ${backup}`)
