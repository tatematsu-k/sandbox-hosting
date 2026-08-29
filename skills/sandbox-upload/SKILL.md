---
name: sandbox-upload
description: Use when the user wants to publish, share, deploy, or preview a local HTML file (or a directory with index.html + assets) on the private sandbox host. Triggers on phrases like "サンドボックスに上げる", "sandboxに公開", "HTMLをデプロイ", "ホスティングして", "プレビュー用URLが欲しい". Wraps the sandbox-hosting API with IP allowlist and TTL.
---

# Sandbox Upload

Publishes HTML to the private IP-restricted sandbox host. Single HTML files
are uploaded as-is. Single `.md`/`.markdown` files are uploaded as-is too —
the server converts them to HTML before publishing. Directories containing
`index.html` are zipped on the client and extracted server-side.

## Required environment

Configured by the user once, e.g. in `~/.config/sandbox-hosting/env`:

```
SANDBOX_BASE_URL=https://sandbox.example.com
SANDBOX_VIEW_URL=https://xxxxxxxxxx.cloudfront.net  # optional, used by healthcheck.sh only
SANDBOX_TOKEN=...                # per-user token issued by an operator via
                                  # `manage-tokens.sh issue <username>`; identifies you
```

`scripts/upload.sh` will source `~/.config/sandbox-hosting/env` automatically
if present.

## Commands

```bash
# Upload single HTML (auto path)
./scripts/upload.sh ./report.html

# Upload single Markdown (auto-converted to HTML server-side)
./scripts/upload.sh ./report.md

# Upload directory (zipped, must contain index.html at root)
./scripts/upload.sh ./build

# Upload with custom path (overwrites existing)
./scripts/upload.sh --path demo-foo ./report.html

# List my sites
./scripts/upload.sh list

# Reactivate TTL-expired site (resets 90d TTL for auto, no-op TTL for custom)
./scripts/upload.sh activate <path>

# Delete
./scripts/upload.sh delete <path>
```

## When invoked by Claude Code

1. Confirm the target file/dir exists.
2. If a directory is given, ensure `index.html` exists at the root before
   running the script (the server rejects zips without it).
3. Run the script with the appropriate subcommand.
4. Report back the published URL.
5. If the user mentioned a fixed share path, pass `--path <slug>`.
   Slug rule: 2-64 chars `[a-z0-9_-]`, starts with `[a-z0-9]`.

## Notes

- Viewers must be on the allowed IP list (`ALLOWED_IPS` on the server) to load
  the published URL. Tell the user this if they ask why a colleague can't open
  the link.
- Auto-path sites auto-expire in 90 days. Custom-path sites do not expire.
