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
