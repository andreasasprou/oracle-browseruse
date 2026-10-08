# Oracle with Browser Use

Install the verified Oracle browser client on new Polaris machines. Oracle runs
on the machine; Browser Use hosts the signed-in ChatGPT browser. No Oracle server,
domain, inbound port, local Chrome, or OpenAI API key is required.

This distribution includes Oracle **0.21.3 with upstream PR #516**, six patches
from the working client, a pinned npm dependency lock, and the Browser Use wrapper.
It deliberately does not install whichever Oracle version happens to be latest.
Oracle is MIT-licensed; its license is included in the packaged distribution.

## Polaris Variables

Configure these in the Polaris project before preparing a new machine:

| Name | Value | Type |
| --- | --- | --- |
| `BROWSER_USE_API_KEY` | A Browser Use API key with access to your cloud profile | Secret |
| `BROWSER_USE_PROFILE_ID` | Your existing signed-in Browser Use profile ID | Variable |

Use project scope for the personal signed-in ChatGPT profile. Organization scope
also grants the configured projects access to that profile. Credentials are
supplied at execution time; the installer never saves them to disk.

## Setup command

Prerequisites: Node.js 24+, npm, Bash, curl, jq, and tar. Install this client after
any existing project setup commands. Paste this block into the setup command:

```bash
set -e
oracle_setup_dir="$(mktemp -d)"
curl -fsSL https://codeload.github.com/andreasasprou/oracle-browseruse/tar.gz/refs/tags/v1.0.0 \
  -o "$oracle_setup_dir/source.tgz"
tar -xzf "$oracle_setup_dir/source.tgz" -C "$oracle_setup_dir" --strip-components=1
bash "$oracle_setup_dir/install.sh"
rm -rf -- "$oracle_setup_dir"
```

The binaries install in `$HOME/.local/bin`; the isolated npm installation and
support scripts live in `$HOME/.local/share/oracle-browseruse`. Existing unrelated
Oracle executables are preserved: installation refuses a conflict. Re-running
the same installer validates the existing version and does not reinstall npm
dependencies. An optional absolute prefix permits an isolated installation.

Call the executable by its full path so agent commands do not depend on whether
the shell adds `$HOME/.local/bin` to PATH:

```bash
"$HOME/.local/bin/oracle-bu" \
  --engine browser \
  --model gpt-6-astra \
  --browser-model-strategy select \
  --browser-thinking-time pro \
  -p "Review the changes" --file "src/**"
```

Always invoke `oracle-bu` for a browser run. The `oracle` executable is for local
previews and session inspection. Do not pass `--browser-tab` or
`--browser-manual-login` to `oracle-bu`. Each request creates a browser, verifies
ChatGPT authentication, runs Oracle, and attempts to stop the browser on exit.

## Smoke test

Run this manually on the new machine, with the variables injected by Polaris:

```bash
"$HOME/.local/bin/oracle-bu" \
  --engine browser \
  --model gpt-6-astra \
  --browser-model-strategy select \
  --browser-thinking-time pro \
  --wait --slug oracle-install-proof \
  -p "Reply with exactly ORACLE_OK"
```

Verify the authentication preflight, model and effort selection, `ORACLE_OK`, and
the browser-stop message. The setup command itself never launches a paid browser.
Sessions and artifacts are saved in the normal Oracle session store on the
machine; this package does not provide remote history or central storage.

If the cloud profile is signed out, a human runs `oracle-bu login`, follows the
printed Live View link to sign in, and then runs `oracle-bu stop <browser-id>` to
save the profile. No local Chrome profile or cookies need to be copied.

## Maintenance

Each published setup command pins a Git commit. Upgrade the pinned build and
patches only after a clean install and live browser proof. The npm lifecycle
scripts are disabled during installation. File checksums detect corrupted or
mismatched distributions; HTTPS and the pinned GitHub commit identify the source.
