#!/usr/bin/env bash
# scripts/setup-aws.sh
# First-run helper: provision Terraform state, bootstrap secrets,
# and apply the full stack. Idempotent.

set -euo pipefail
cd "$(dirname "$0")/.."

for cmd in aws terraform node npm zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd is required" >&2
    exit 1
  fi
done

aws sts get-caller-identity >/dev/null
echo "==> AWS credentials: $(aws sts get-caller-identity --query 'Arn' --output text)"

if [[ ! -f terraform/terraform.tfvars ]]; then
  cp terraform/terraform.tfvars.example terraform/terraform.tfvars
  echo "==> Created terraform/terraform.tfvars (edit allowed_ips / public_base_url / alarm_email)"
fi

if [[ ! -f terraform/backend.tf ]]; then
  cat <<'EOM'
==> backend.tf not found.
    By default Terraform uses local state. If you want S3-backed remote state,
    copy terraform/backend.tf.example to terraform/backend.tf and edit before continuing.
EOM
fi

echo "==> npm install"
npm install --silent

echo "==> npm run build"
npm run build

echo "==> terraform init"
terraform -chdir=terraform init -input=false

echo "==> terraform apply"
terraform -chdir=terraform apply -auto-approve

echo
echo "==> Outputs"
terraform -chdir=terraform output

echo
echo "==> Next steps"
cat <<'EOM'
1) Populate Slack secrets manually:
     aws ssm put-parameter --name "/sandbox-hosting/SLACK_SIGNING_SECRET" \
        --type SecureString --overwrite --value "<signing secret>"

2) Issue a token for yourself (and anyone else who needs one):
     ./scripts/manage-tokens.sh issue <username>

3) Configure clients:
     ./scripts/setup-client.sh

4) Verify:
     ./scripts/healthcheck.sh
EOM
