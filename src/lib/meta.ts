import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "./config";

export type SiteType = "auto" | "custom";
export type SiteStatus = "published" | "unpublished";
export type Source = "slack" | "claude-code";

export type SiteMeta = {
  path: string;
  owner: string;
  type: SiteType;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
  ttlExpiresAt: string | null;
  files: string[];
  source: Source;
};

const TTL_DAYS = 90;
const raw = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export const OWNER_INDEX = "owner-index";

export function computeTtl(type: SiteType, now: Date = new Date()): string | null {
  if (type === "custom") return null;
  const e = new Date(now);
  e.setUTCDate(e.getUTCDate() + TTL_DAYS);
  return e.toISOString();
}

export function publishedKey(path: string, file = "index.html"): string {
  return `published/${path}/${file}`;
}

export function unpublishedKey(path: string, file = "index.html"): string {
  return `unpublished/${path}/${file}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function readMeta(path: string): Promise<SiteMeta | null> {
  const res = await client.send(
    new GetCommand({ TableName: config.table(), Key: { path } }),
  );
  return (res.Item as SiteMeta | undefined) ?? null;
}

export async function writeMeta(meta: SiteMeta): Promise<void> {
  await client.send(
    new PutCommand({ TableName: config.table(), Item: meta }),
  );
}

export async function deleteMeta(path: string): Promise<void> {
  await client.send(
    new DeleteCommand({ TableName: config.table(), Key: { path } }),
  );
}

export async function listByOwner(owner: string): Promise<SiteMeta[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: config.table(),
      IndexName: OWNER_INDEX,
      KeyConditionExpression: "#o = :o",
      ExpressionAttributeNames: { "#o": "owner" },
      ExpressionAttributeValues: { ":o": owner },
    }),
  );
  return (res.Items as SiteMeta[]) ?? [];
}

export async function listAll(): Promise<SiteMeta[]> {
  const all: SiteMeta[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: config.table(),
        ExclusiveStartKey: cursor,
      }),
    );
    all.push(...((res.Items as SiteMeta[]) ?? []));
    cursor = res.LastEvaluatedKey;
  } while (cursor);
  return all;
}

export async function listExpired(now: Date = new Date()): Promise<SiteMeta[]> {
  const nowIsoStr = now.toISOString();
  const result: SiteMeta[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: config.table(),
        FilterExpression:
          "#t = :auto AND #s = :published AND attribute_exists(ttlExpiresAt) AND ttlExpiresAt <= :now",
        ExpressionAttributeNames: { "#t": "type", "#s": "status" },
        ExpressionAttributeValues: {
          ":auto": "auto",
          ":published": "published",
          ":now": nowIsoStr,
        },
        ExclusiveStartKey: cursor,
      }),
    );
    result.push(...((res.Items as SiteMeta[]) ?? []));
    cursor = res.LastEvaluatedKey;
  } while (cursor);
  return result;
}
