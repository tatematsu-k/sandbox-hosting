import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "next build",
  crons: [
    {
      path: "/api/cron/expire-ttl",
      schedule: "0 3 * * *",
    },
  ],
};
