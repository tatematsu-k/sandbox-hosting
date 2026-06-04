import type { Handler } from "aws-lambda";
import { listExpired } from "@/src/lib/meta";
import { deactivate } from "@/src/lib/upload";

type CronResult = {
  checkedAt: string;
  expired: number;
  sites: { path: string }[];
};

export const handler: Handler<unknown, CronResult> = async () => {
  const now = new Date();
  const expired = await listExpired(now);
  const sites: { path: string }[] = [];

  for (const meta of expired) {
    try {
      const updated = await deactivate(meta.path);
      sites.push({ path: updated.path });
    } catch (err) {
      console.error(`[sandbox/cron] failed to deactivate ${meta.path}`, err);
    }
  }

  const result: CronResult = {
    checkedAt: now.toISOString(),
    expired: sites.length,
    sites,
  };
  console.log("[sandbox/cron] result", result);
  return result;
};
