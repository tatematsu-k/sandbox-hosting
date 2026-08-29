# Per-User Upload Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared `UPLOAD_TOKEN` with per-user tokens stored in DynamoDB, so the API can derive a verified identity from the token itself instead of trusting a self-reported `X-Sandbox-User` header.

**Architecture:** A new DynamoDB table (`tokens`) maps `sha256(rawToken)` → `{owner, createdAt}`. `verifyBearer` hashes the incoming bearer token and does a single `GetItem` lookup. A new admin-only CLI (`scripts/manage-tokens.sh`) talks directly to the table via the caller's own AWS credentials to issue/list/revoke tokens — it does not go through the API Lambda.

**Tech Stack:** TypeScript (Lambda handlers), Terraform (AWS infra), Bash (admin CLI + client scripts), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-per-user-tokens-design.md`

## Global Constraints

- No GSI on the tokens table — `list`/`revoke` scan the table (scale: a handful to dozens of users).
- Full cutover, no parallel operation — the shared `UPLOAD_TOKEN` is deleted, not kept as a fallback.
- Slack path (`verifySlack`, `SLACK_SIGNING_SECRET`) is unaffected — do not modify it.
- Out of scope: token TTL/expiry, self-service issuance API, enforcing one token per user.
- Token generation: `openssl rand -hex 32`. Hash: SHA-256 hex, computed with `node:crypto` on **both** the admin CLI and the Lambda so the digests are byte-identical.
- Username format for `issue`/`revoke`: `^[a-z0-9][a-z0-9_-]{0,38}$` (same as `USERNAME_RE` in `src/lib/path.ts:4`).
- `terraform apply` in Task 9 modifies live shared infrastructure and deletes the currently-working shared token — confirm with the user before running it.

---

### Task 1: Tokens DynamoDB table + IAM read permission

**Files:**
- Modify: `terraform/storage.tf`
- Modify: `terraform/iam.tf`
- Modify: `terraform/outputs.tf`

**Interfaces:**
- Produces: `aws_dynamodb_table.tokens` (Terraform resource, PK `tokenHash`), Terraform output `tokens_table` — consumed by Task 6 (`scripts/manage-tokens.sh`) and Task 4 (`TOKENS_TABLE` env var wiring, via Task 2's `local.lambda_env`).

- [ ] **Step 1: Add the tokens table to `terraform/storage.tf`**

Append at the end of the file:

```hcl
resource "aws_dynamodb_table" "tokens" {
  name         = "${local.name}-tokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tokenHash"

  attribute {
    name = "tokenHash"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
```

- [ ] **Step 2: Grant the Lambda role read-only access**

In `terraform/iam.tf`, add a new statement to `data.aws_iam_policy_document.lambda_app` (after the existing `DynamoTable` statement, before `SsmRead`):

```hcl
  statement {
    sid = "TokensTableRead"
    actions = [
      "dynamodb:GetItem",
    ]
    resources = [
      aws_dynamodb_table.tokens.arn,
    ]
  }
```

- [ ] **Step 3: Expose the table name as an output**

In `terraform/outputs.tf`, add:

```hcl
output "tokens_table" {
  value = aws_dynamodb_table.tokens.name
}
```

- [ ] **Step 4: Validate**

Run:
```bash
npm run lint:tf
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```
Expected: `terraform fmt -check` prints nothing (no diff), `validate` reports `Success!`.

- [ ] **Step 5: Commit**

```bash
git add terraform/storage.tf terraform/iam.tf terraform/outputs.tf
git commit -m "infra: add tokens DynamoDB table and Lambda read permission"
```

---

### Task 2: Retire the shared UPLOAD_TOKEN infra

**Files:**
- Modify: `terraform/secrets.tf`
- Modify: `terraform/lambda.tf`
- Modify: `terraform/outputs.tf`
- Modify: `terraform/iam.tf`

**Interfaces:**
- Produces: env var `TOKENS_TABLE` on both Lambdas (replacing `UPLOAD_TOKEN_PARAM`) — consumed by Task 4 (`src/lib/config.ts`).

- [ ] **Step 1: Remove the shared token resource from `terraform/secrets.tf`**

Delete this block (keep the two Slack SSM parameter resources untouched):

```hcl
resource "random_password" "upload_token" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "upload_token" {
  name        = "${local.ssm_prefix}/UPLOAD_TOKEN"
  description = "Bearer token for Claude Code upload."
  type        = "SecureString"
  value       = random_password.upload_token.result

  lifecycle {
    ignore_changes = [value]
  }
}
```

- [ ] **Step 2: Swap the Lambda env var in `terraform/lambda.tf`**

In the `locals.lambda_env` block, replace:
```hcl
    UPLOAD_TOKEN_PARAM         = aws_ssm_parameter.upload_token.name
```
with:
```hcl
    TOKENS_TABLE               = aws_dynamodb_table.tokens.name
```

- [ ] **Step 3: Remove the now-dangling SSM read permission in `terraform/iam.tf`**

In the `SsmRead` statement's `resources`, remove this line:
```hcl
      aws_ssm_parameter.upload_token.arn,
```

- [ ] **Step 4: Remove the output in `terraform/outputs.tf`**

Delete:
```hcl
output "upload_token_param" {
  value     = aws_ssm_parameter.upload_token.name
  sensitive = true
}
```

- [ ] **Step 5: Validate**

Run:
```bash
npm run lint:tf
terraform -chdir=terraform validate
```
Expected: `Success!`. (Do not run `terraform plan`/`apply` yet — the app code in Tasks 3-5 still references the old env var name until those land; applying now would break the live Lambda. Deployment happens in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add terraform/secrets.tf terraform/lambda.tf terraform/iam.tf terraform/outputs.tf
git commit -m "infra: remove shared UPLOAD_TOKEN SSM parameter"
```

---

### Task 3: `src/lib/tokens.ts` — hash + DynamoDB lookup

**Files:**
- Create: `src/lib/tokens.ts`
- Create: `tests/tokens.test.ts`
- Modify: `src/lib/config.ts`

**Interfaces:**
- Consumes: `config.tokensTable(): string` (added in this task).
- Produces: `hashToken(raw: string): string`, `lookupOwner(tokenHash: string): Promise<string | null>` — consumed by Task 4 (`src/lib/auth.ts`).

- [ ] **Step 1: Add `tokensTable()` to `src/lib/config.ts`**

Add a new line right after `uploadTokenParam`. Do **not** remove `uploadTokenParam` yet —
`auth.ts` still calls it until Task 4 rewrites it; removing it now would break `npm run typecheck`
for the rest of this task.

```ts
  uploadTokenParam: () => required("UPLOAD_TOKEN_PARAM"),
  tokensTable: () => required("TOKENS_TABLE"),
```

- [ ] **Step 2: Write the failing test for `hashToken`**

Create `tests/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const { hashToken } = await import("@/src/lib/tokens");

describe("hashToken", () => {
  it("returns the sha256 hex digest of the input", () => {
    const expected = createHash("sha256").update("my-token").digest("hex");
    expect(hashToken("my-token")).toBe(expected);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "@/src/lib/tokens"` (module doesn't exist yet).

- [ ] **Step 4: Create `src/lib/tokens.ts`**

```ts
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "./config";

const raw = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function lookupOwner(tokenHash: string): Promise<string | null> {
  const res = await client.send(
    new GetCommand({ TableName: config.tokensTable(), Key: { tokenHash } }),
  );
  const owner = (res.Item as { owner?: string } | undefined)?.owner;
  return owner ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`uploadTokenParam` is unused by anything new here but still has its one
caller in `auth.ts`, so this is a clean, independently-typechecking commit. Task 4 removes
`uploadTokenParam` when it removes that caller.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/tokens.ts src/lib/config.ts tests/tokens.test.ts
git commit -m "feat: add tokens table hash+lookup helper"
```

---

### Task 4: Rewrite `verifyBearer` to use per-user tokens

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `tests/auth.test.ts`
- Modify: `src/lib/config.ts`

**Interfaces:**
- Consumes: `hashToken`, `lookupOwner` from `src/lib/tokens.ts` (Task 3).
- Produces: `verifyBearer(authorization: string | undefined): Promise<Identity>` — signature drops the second (`claimedUser`) parameter. Consumed by Task 5 (`src/handlers/api.ts`).
- Removes: `config.uploadTokenParam()` (its only caller, in `auth.ts`, is removed in this task).

- [ ] **Step 1: Update the failing tests in `tests/auth.test.ts`**

Replace the top of the file (mocks + verifyBearer describe block) with:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/src/lib/secrets", () => ({
  getSecret: vi.fn(),
}));

vi.mock("@/src/lib/tokens", () => ({
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
  lookupOwner: vi.fn(),
}));

vi.mock("@/src/lib/config", () => ({
  config: {
    bucket: () => "bucket",
    table: () => "table",
    publicBaseUrl: () => "https://example.com",
    tokensTable: () => "tokens-table",
    slackSigningSecretParam: () => "/sandbox-hosting/SLACK_SIGNING_SECRET",
    slackBotTokenParam: () => undefined,
    region: () => "ap-northeast-1",
  },
}));

const { verifyBearer, verifySlack } = await import("@/src/lib/auth");
const { Unauthorized } = await import("@/src/lib/errors");
const { getSecret } = await import("@/src/lib/secrets");
const { lookupOwner } = await import("@/src/lib/tokens");
const getSecretMock = vi.mocked(getSecret);
const lookupOwnerMock = vi.mocked(lookupOwner);

describe("verifyBearer", () => {
  beforeEach(() => {
    lookupOwnerMock.mockImplementation(async (hash) =>
      hash === "hash:secret-token" ? "tatematsu-k" : null,
    );
  });

  it("accepts a valid token and returns the stored owner", async () => {
    const id = await verifyBearer("Bearer secret-token");
    expect(id.username).toBe("tatematsu-k");
    expect(id.source).toBe("claude-code");
  });

  it("rejects missing header", async () => {
    await expect(verifyBearer(undefined)).rejects.toThrow(Unauthorized);
  });

  it("rejects a token with no matching record", async () => {
    await expect(verifyBearer("Bearer wrong")).rejects.toThrow(Unauthorized);
  });
});
```

Leave the `describe("verifySlack", ...)` block below unchanged.

- [ ] **Step 2: Run tests to verify the verifyBearer block fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — the new mock of `@/src/lib/config` has no `uploadTokenParam`, so the still-old
`verifyBearer` throws `config.uploadTokenParam is not a function`.

- [ ] **Step 3: Rewrite `verifyBearer` in `src/lib/auth.ts`**

Replace:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { Unauthorized } from "./errors";
import { normalizeUsername } from "./path";
import { config } from "./config";
import { getSecret } from "./secrets";

const SLACK_TIMESTAMP_WINDOW_S = 60 * 5;

export type Identity = {
  username: string;
  source: "slack" | "claude-code";
};

export async function verifyBearer(
  authorization: string | undefined,
  claimedUser: string | undefined,
): Promise<Identity> {
  const expected = await getSecret(config.uploadTokenParam());
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new Unauthorized("missing bearer token");
  if (!safeEqual(match[1].trim(), expected)) {
    throw new Unauthorized("invalid token");
  }
  return {
    username: normalizeUsername(claimedUser ?? "anon"),
    source: "claude-code",
  };
}
```
with:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { Unauthorized } from "./errors";
import { normalizeUsername } from "./path";
import { config } from "./config";
import { getSecret } from "./secrets";
import { hashToken, lookupOwner } from "./tokens";

const SLACK_TIMESTAMP_WINDOW_S = 60 * 5;

export type Identity = {
  username: string;
  source: "slack" | "claude-code";
};

export async function verifyBearer(
  authorization: string | undefined,
): Promise<Identity> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new Unauthorized("missing bearer token");
  const owner = await lookupOwner(hashToken(match[1].trim()));
  if (!owner) throw new Unauthorized("invalid token");
  return { username: owner, source: "claude-code" };
}
```

(Leave `verifySlack` and `safeEqual` below untouched — `safeEqual` is still used by `verifySlack`.)

- [ ] **Step 4: Remove the now-unused `uploadTokenParam` from `src/lib/config.ts`**

`auth.ts` no longer calls it after Step 3, and nothing else in the codebase does. Delete:
```ts
  uploadTokenParam: () => required("UPLOAD_TOKEN_PARAM"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS (all `verifyBearer` and `verifySlack` tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: errors remain only in `src/handlers/api.ts` (still calling `verifyBearer` with 2 args) — fixed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth.ts src/lib/config.ts tests/auth.test.ts
git commit -m "feat: derive upload identity from per-user token instead of shared secret"
```

---

### Task 5: Update `verifyBearer` call sites in `src/handlers/api.ts`

**Files:**
- Modify: `src/handlers/api.ts`

**Interfaces:**
- Consumes: `verifyBearer(authorization: string | undefined): Promise<Identity>` (Task 4).

- [ ] **Step 1: Drop the second argument at all 4 call sites**

In `src/handlers/api.ts`, replace all 4 occurrences of:
```ts
  const identity = await verifyBearer(headers["authorization"], headers["x-sandbox-user"]);
```
with:
```ts
  const identity = await verifyBearer(headers["authorization"]);
```
(Lines inside `handleUpload`, `handleList`, `handleActivate`, `handleDelete`.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Build Lambda bundles**

Run: `npm run build`
Expected: succeeds, produces `dist/api/index.mjs` and `dist/cron/index.mjs`.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/api.ts
git commit -m "refactor: stop reading X-Sandbox-User, identity now comes from the token"
```

---

### Task 6: Admin CLI — `scripts/manage-tokens.sh`

**Files:**
- Create: `scripts/manage-tokens.sh`

**Interfaces:**
- Consumes: Terraform output `tokens_table` (Task 1).
- Produces: `issue`/`list`/`revoke` subcommands, used manually in Task 9.

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# scripts/manage-tokens.sh
# Issue, list, and revoke per-user sandbox-hosting upload tokens.
# Talks directly to the tokens DynamoDB table with the caller's own AWS
# credentials — this does NOT go through the API Lambda.

set -euo pipefail
cd "$(dirname "$0")/.."

USERNAME_RE='^[a-z0-9][a-z0-9_-]{0,38}$'
TABLE="${TOKENS_TABLE:-$(terraform -chdir=terraform output -raw tokens_table)}"

print_usage() {
  cat <<'EOF'
Usage:
  manage-tokens.sh issue <username>
  manage-tokens.sh list
  manage-tokens.sh revoke <username>
EOF
}

require_valid_username() {
  local username="$1"
  if ! [[ "$username" =~ $USERNAME_RE ]]; then
    echo "invalid username '$username' (must match $USERNAME_RE)" >&2
    exit 2
  fi
}

sha256_hex() {
  node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"
}

cmd_issue() {
  local username="$1" token hash now
  require_valid_username "$username"
  token="$(openssl rand -hex 32)"
  hash="$(sha256_hex "$token")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  aws dynamodb put-item \
    --table-name "$TABLE" \
    --item "$(printf '{"tokenHash":{"S":"%s"},"owner":{"S":"%s"},"createdAt":{"S":"%s"}}' "$hash" "$username" "$now")" \
    >/dev/null

  echo "==> Issued a token for '$username'. This is shown once — save it now:"
  echo "$token"
}

cmd_list() {
  aws dynamodb scan \
    --table-name "$TABLE" \
    --query 'Items[].{owner:owner.S,createdAt:createdAt.S}' \
    --output table
}

cmd_revoke() {
  local username="$1" hashes hash
  require_valid_username "$username"

  hashes="$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression '#o = :u' \
    --expression-attribute-names '{"#o":"owner"}' \
    --expression-attribute-values "$(printf '{":u":{"S":"%s"}}' "$username")" \
    --query 'Items[].tokenHash.S' \
    --output text)"

  if [[ -z "$hashes" ]]; then
    echo "no tokens found for '$username'" >&2
    exit 1
  fi

  while IFS= read -r hash; do
    [[ -z "$hash" ]] && continue
    aws dynamodb delete-item \
      --table-name "$TABLE" \
      --key "$(printf '{"tokenHash":{"S":"%s"}}' "$hash")" \
      >/dev/null
    echo "==> Revoked token (hash: ${hash:0:12}...) for '$username'"
  done <<< "$hashes"
}

case "${1:-}" in
  issue)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_issue "$2"
    ;;
  list)
    cmd_list
    ;;
  revoke)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_revoke "$2"
    ;;
  *)
    print_usage >&2
    exit 2
    ;;
esac
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/manage-tokens.sh`

- [ ] **Step 3: Verify with shellcheck** (matches what CI runs)

Run: `shellcheck -e SC1090 -e SC1091 scripts/manage-tokens.sh` (install via `brew install shellcheck` if missing locally — CI will run this regardless).
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add scripts/manage-tokens.sh
git commit -m "feat: add scripts/manage-tokens.sh for issuing/listing/revoking upload tokens"
```

---

### Task 7: Update client-side scripts and skill docs

**Files:**
- Modify: `skills/sandbox-upload/scripts/upload.sh`
- Modify: `scripts/healthcheck.sh`
- Modify: `scripts/setup-client.sh`
- Modify: `skills/sandbox-upload/SKILL.md`

**Interfaces:** none (shell scripts + docs, no code interfaces).

- [ ] **Step 1: Remove `X-Sandbox-User` from `skills/sandbox-upload/scripts/upload.sh`**

Remove the line:
```bash
  -H "X-Sandbox-User: ${SANDBOX_USER}"
```
from the `curl_common` array. Also remove the now-unused line:
```bash
SANDBOX_USER="${SANDBOX_USER:-${USER:-anon}}"
```

- [ ] **Step 2: Remove `X-Sandbox-User` from `scripts/healthcheck.sh`**

Remove the line:
```bash
USER_NAME="${SANDBOX_USER:-healthcheck}"
```
and both occurrences of:
```bash
  -H "X-Sandbox-User: $USER_NAME" \
```
(one in the upload block, one in the list block).

- [ ] **Step 3: Update `scripts/setup-client.sh`**

Remove the username prompt and variable:
```bash
existing_user=""
...
  existing_user="${SANDBOX_USER:-}"
...
user=$(prompt "Username to claim on upload" "${existing_user:-${USER:-anon}}")
```
and the `SANDBOX_USER="$user"` line in the generated env file heredoc.

Change the token prompt label from:
```bash
  token=$(prompt "UPLOAD_TOKEN" "")
```
(both occurrences) to:
```bash
  token=$(prompt "Upload token (issued by an operator via manage-tokens.sh issue)" "")
```

- [ ] **Step 4: Update `skills/sandbox-upload/SKILL.md`**

In the "Required environment" section, replace:
```
SANDBOX_BASE_URL=https://sandbox.example.com
SANDBOX_TOKEN=...                # matches SSM /sandbox-hosting/UPLOAD_TOKEN
SANDBOX_USER=tatematsu          # optional, default = $USER
```
with:
```
SANDBOX_BASE_URL=https://sandbox.example.com
SANDBOX_TOKEN=...                # per-user token issued by an operator via
                                  # `manage-tokens.sh issue <username>`; identifies you
```

- [ ] **Step 5: Manually smoke-test the scripts parse correctly**

Run: `bash -n skills/sandbox-upload/scripts/upload.sh && bash -n scripts/healthcheck.sh && bash -n scripts/setup-client.sh`
Expected: no output (syntax OK).

- [ ] **Step 6: shellcheck**

Run: `shellcheck -e SC1090 -e SC1091 skills/sandbox-upload/scripts/upload.sh scripts/healthcheck.sh scripts/setup-client.sh`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add skills/sandbox-upload/scripts/upload.sh scripts/healthcheck.sh scripts/setup-client.sh skills/sandbox-upload/SKILL.md
git commit -m "chore: drop client-side X-Sandbox-User claim, identity now comes from the token"
```

---

### Task 8: Update README, architecture review, and setup-aws.sh

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture-review.md`
- Modify: `scripts/setup-aws.sh`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`**

Replace item 3 in the "初回（運用者）" numbered list:
```
3. **`UPLOAD_TOKEN` を控える**（Claude Code クライアントに配布）
   ```bash
   aws ssm get-parameter --name "/sandbox-hosting/UPLOAD_TOKEN" \
     --with-decryption --query 'Parameter.Value' --output text
   ```
```
with:
```
3. **利用者ごとにトークンを発行**（Claude Code クライアントに個別配布）
   ```bash
   ./scripts/manage-tokens.sh issue <username>
   ```
   トークンは発行時に一度だけ表示される。一覧確認は `list`、失効は
   `revoke <username>`。
```

- [ ] **Step 2: Update `docs/architecture-review.md` finding S-2**

Replace:
```
### S-2 🟡 Med: `UPLOAD_TOKEN` は依然として単一共有秘密

- SSM 化により安全に保管できるようになったが、複数ユーザー間で共有される構造は同じ
- 漏洩時は全クライアントを一斉ローテーションする必要

**Mitigation**
- 短期: SSM パスを `/sandbox-hosting/tokens/{username}` 配下に分けて配布・検証
- 中期: API GW Lambda Authorizer + DynamoDB 内のトークンテーブル
- 長期: Amazon Cognito User Pool + JWT
```
with:
```
### S-2 ✅ Resolved: 単一共有 `UPLOAD_TOKEN` を per-user トークンに置き換え

- DynamoDB `tokens` テーブル(PK=`sha256(token)`)にユーザーごとのトークンを保存し、
  `verifyBearer` がハッシュ一致で検証済みの owner を返すようになった
  (`docs/superpowers/specs/2026-08-29-per-user-tokens-design.md`)
- 漏洩時は影響ユーザーの `manage-tokens.sh revoke <username>` だけで済み、
  他ユーザーへの影響はない
- `X-Sandbox-User` ヘッダーの自己申告問題(Authn/Authz 節)もこの変更で同時に解消
```

Also update the top summary table row from:
```
| Security | 🟢 1 High, 4 Med | 単一共有 `UPLOAD_TOKEN`、API GW に WAF 未導入 |
| Authn / Authz | 🟢 1 High, 1 Med | `X-Sandbox-User` の client claim 問題は AWS でも残る |
```
to:
```
| Security | 🟢 1 High, 3 Med | API GW に WAF 未導入(単一共有トークン問題は解消) |
| Authn / Authz | 🟢 1 High, 0 Med | per-user トークンによりクライアント claim 問題を解消 |
```

- [ ] **Step 3: Update `scripts/setup-aws.sh`**

Replace:
```
2) Note the upload token:
     aws ssm get-parameter --name "/sandbox-hosting/UPLOAD_TOKEN" \
        --with-decryption --query 'Parameter.Value' --output text
```
with:
```
2) Issue a token for yourself (and anyone else who needs one):
     ./scripts/manage-tokens.sh issue <username>
```

- [ ] **Step 4: Verify `setup-aws.sh` still parses cleanly**

Run: `bash -n scripts/setup-aws.sh && shellcheck -e SC1090 -e SC1091 scripts/setup-aws.sh`
Expected: no output, no warnings.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture-review.md scripts/setup-aws.sh
git commit -m "docs: document per-user token issuance, close S-2 finding"
```

---

### Task 9: Deploy and cut over

**Files:** none (infra operation + manual verification).

**Interfaces:** none — this is the integration step tying Tasks 1-8 together against real AWS.

- [ ] **Step 1: Review the full plan**

Run: `terraform -chdir=terraform plan`
Expected: shows the `tokens` table being created, the `upload_token` SSM parameter and `random_password` being destroyed, and the Lambda env vars updating (`UPLOAD_TOKEN_PARAM` removed, `TOKENS_TABLE` added).

- [ ] **Step 2: Confirm with the user, then apply**

This deletes the shared token that is currently in active use — **stop and get explicit confirmation before running this**, since it is a live infra change with no rollback other than re-applying the old config.

Run: `terraform -chdir=terraform apply`

- [ ] **Step 3: Issue a token for the current user**

Run: `./scripts/manage-tokens.sh issue tatematsu`
Expected: prints a 64-char hex token once.

- [ ] **Step 4: Update local client config**

Run: `./scripts/setup-client.sh` and paste the token from Step 3 when prompted.

- [ ] **Step 5: Verify end-to-end**

Run: `./scripts/healthcheck.sh`
Expected: `HTTP 200 OK` for the published test page, and the `list` call returns it under `owner: "tatematsu"`.

- [ ] **Step 6: Verify revocation works (with 2 tokens — this is the case the final review's Critical fix targeted)**

`manage-tokens.sh revoke` used to silently no-op for a user with 2+ tokens (fixed in commit
`7e626bc`, see `docs/superpowers/specs` ledger) — testing with only one token would not have
caught that bug, so issue two before revoking:

```bash
./scripts/manage-tokens.sh issue smoke-test-user   # token A
./scripts/manage-tokens.sh issue smoke-test-user   # token B
./scripts/manage-tokens.sh revoke smoke-test-user  # must revoke BOTH
```

Then confirm requests using **both** revoked tokens get `401`:
```bash
for t in "<token A>" "<token B>"; do
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
    -H "Authorization: Bearer $t" \
    -H "Content-Type: application/json" -d '{"scope":"mine"}' \
    "$SANDBOX_BASE_URL/list"
done
```
Expected: `401` for both. If either returns `200`, `revoke` regressed — do not consider the
cutover complete until both fail. Note: `lookupOwner`'s DynamoDB read has no `ConsistentRead`,
so a request made within roughly a second of revoking could observe stale data — if you see a
`200` immediately after revoking, wait a moment and retry before treating it as a bug.

- [ ] **Step 7: No commit needed** — this task only touches live infra state, not repo files.
