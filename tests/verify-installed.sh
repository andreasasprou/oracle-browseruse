#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${1:?Pass the clean installation prefix}"

[[ "$("$PREFIX/bin/oracle" --version)" == "0.21.3" ]]
bash "$SOURCE_DIR/install.sh" "$PREFIX"

for patch in browseruse submit-recovery composer-clear post-upload-clear segmented-picker gpt6-label; do
  node "$PREFIX/share/oracle-browseruse/patch-$patch.mjs" --check >/dev/null
done

# Both credentials come from the runtime environment, not installation files.
set +e
missing_key_output="$(env -u BROWSER_USE_API_KEY -u BROWSER_USE_PROFILE_ID \
  "$PREFIX/bin/oracle-bu" --engine browser -p test 2>&1)"
missing_key_exit=$?
set -e
[[ "$missing_key_exit" == 2 && "$missing_key_output" == *'BROWSER_USE_API_KEY is not set'* ]]

# Installation must preserve an unrelated executable at the destination.
conflict_prefix="$(mktemp -d)"
trap 'rm -rf -- "$conflict_prefix"' EXIT
mkdir "$conflict_prefix/bin"
printf '%s\n' 'existing oracle executable' > "$conflict_prefix/bin/oracle"
set +e
conflict_output="$(bash "$SOURCE_DIR/install.sh" "$conflict_prefix" 2>&1)"
conflict_exit=$?
set -e
[[ "$conflict_exit" == 2 && "$conflict_output" == *'already exists'* ]]
[[ "$(cat "$conflict_prefix/bin/oracle")" == 'existing oracle executable' ]]
echo 'Installer checks passed: version, repeat installation, patches, missing credential, existing executable preservation.'
