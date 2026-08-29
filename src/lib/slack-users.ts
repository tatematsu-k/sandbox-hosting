import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "./config";

const raw = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function lookupEmail(slackUserId: string): Promise<string | null> {
  const res = await client.send(
    new GetCommand({ TableName: config.slackUsersTable(), Key: { slackUserId } }),
  );
  const email = (res.Item as { email?: string } | undefined)?.email;
  return email ?? null;
}
