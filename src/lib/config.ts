function required(key: string): string {
  const value = process.env[key];
  if (!value || value.length === 0) {
    throw new Error(`missing required env: ${key}`);
  }
  return value;
}

function optional(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export const config = {
  bucket: () => required("CONTENT_BUCKET"),
  table: () => required("META_TABLE"),
  publicBaseUrl: () => required("PUBLIC_BASE_URL"),
  uploadTokenParam: () => required("UPLOAD_TOKEN_PARAM"),
  tokensTable: () => required("TOKENS_TABLE"),
  slackSigningSecretParam: () => required("SLACK_SIGNING_SECRET_PARAM"),
  slackBotTokenParam: () => optional("SLACK_BOT_TOKEN_PARAM"),
  region: () => required("AWS_REGION"),
};
