import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "./config";

const raw = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export type SlackUser = {
  email: string;
  linkedUsername?: string;
};

export async function lookupSlackUser(slackUserId: string): Promise<SlackUser | null> {
  const res = await client.send(
    new GetCommand({ TableName: config.slackUsersTable(), Key: { slackUserId } }),
  );
  const item = res.Item as { email?: string; linkedUsername?: string } | undefined;
  if (!item?.email) return null;
  return { email: item.email, linkedUsername: item.linkedUsername };
}
