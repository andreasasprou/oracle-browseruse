#!/usr/bin/env bash
# Install the verified Oracle + Browser Use client without changing npm globals.
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${1:-$HOME/.local}"
if [[ $# -gt 1 || "$PREFIX" != /* ]]; then
  echo "Usage: bash install.sh [absolute-install-prefix]" >&2
  exit 2
fi
for command in node npm curl jq; do
  command -v "$command" >/dev/null || {
    echo "oracle-browseruse: install $command first" >&2
    exit 2
  }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("oracle-browseruse: Node.js 24+ is required"); process.exit(2); }'

# Verify the distribution before copying it or executing any patch.
node --input-type=module - "$SOURCE_DIR" <<'JS'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = process.argv[2];
const manifest = JSON.parse(readFileSync(path.join(root, 'checksums.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest)) {
  const actual = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`);
}
JS

DEST="$PREFIX/share/oracle-browseruse"
for name in oracle oracle-bu; do
  if [[ -e "$PREFIX/bin/$name" || -L "$PREFIX/bin/$name" ]]; then
    if ! cmp -s "$SOURCE_DIR/bin/$name" "$PREFIX/bin/$name"; then
      echo "oracle-browseruse: $PREFIX/bin/$name already exists; choose another prefix" >&2
      exit 2
    fi
  fi
done

if [[ -e "$DEST" ]]; then
  if ! cmp -s "$SOURCE_DIR/checksums.json" "$DEST/checksums.json"; then
    echo "oracle-browseruse: $DEST contains a different installation; choose another prefix" >&2
    exit 2
  fi
  "$PREFIX/bin/oracle" --version
  echo "oracle-browseruse: already installed"
  exit 0
fi

mkdir -p "$PREFIX/bin" "$PREFIX/share"
STAGE="$(mktemp -d "$PREFIX/share/.oracle-browseruse-install.XXXXXX")"
cleanup() { [[ -z "$STAGE" ]] || rm -rf -- "$STAGE"; }
trap cleanup EXIT
cp "$SOURCE_DIR/runtime/"* "$STAGE/"
cp "$SOURCE_DIR/assets/oracle-0.21.3-pr516.tgz" "$STAGE/"
cp "$SOURCE_DIR/checksums.json" "$STAGE/"

# Never run dependency lifecycle scripts or print the Browser Use credentials.
env -u BROWSER_USE_API_KEY -u BROWSER_USE_PROFILE_ID \
  npm ci --prefix "$STAGE" --omit=dev --ignore-scripts --no-audit --no-fund

for patch in browseruse submit-recovery composer-clear post-upload-clear segmented-picker gpt6-label; do
  node "$STAGE/patch-$patch.mjs"
done

mv -- "$STAGE" "$DEST"
STAGE=""
install -m 755 "$SOURCE_DIR/bin/oracle" "$PREFIX/bin/oracle"
install -m 755 "$SOURCE_DIR/bin/oracle-bu" "$PREFIX/bin/oracle-bu"
"$PREFIX/bin/oracle" --version
echo "oracle-browseruse: installed in $PREFIX/bin"
echo "Run $PREFIX/bin/oracle-bu with BROWSER_USE_API_KEY and BROWSER_USE_PROFILE_ID injected by Polaris."
