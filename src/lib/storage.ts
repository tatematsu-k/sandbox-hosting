import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { config } from "./config";

const client = new S3Client({});

const TEXT_HTML = "text/html; charset=utf-8";

export async function putObject(
  key: string,
  body: Buffer | string,
  contentType: string = TEXT_HTML,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=0, must-revalidate",
    }),
  );
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: config.bucket(), Key: key }),
    );
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  const bucket = config.bucket();
  let continuationToken: string | undefined;
  let total = 0;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = page.Contents?.map((o) => o.Key).filter((k): k is string => Boolean(k)) ?? [];
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
      total += keys.length;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return total;
}

export async function copyPrefix(from: string, to: string): Promise<number> {
  const bucket = config.bucket();
  const fromPrefix = from.endsWith("/") ? from : `${from}/`;
  const toPrefix = to.endsWith("/") ? to : `${to}/`;

  let continuationToken: string | undefined;
  let total = 0;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fromPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key) continue;
      const suffix = obj.Key.slice(fromPrefix.length);
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodeS3Key(obj.Key)}`,
          Key: `${toPrefix}${suffix}`,
        }),
      );
      total++;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return total;
}

export async function movePrefix(from: string, to: string): Promise<number> {
  const copied = await copyPrefix(from, to);
  if (copied > 0) await deletePrefix(from);
  return copied;
}

export async function deleteOne(key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: config.bucket(), Key: key }),
  );
}

export function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}
