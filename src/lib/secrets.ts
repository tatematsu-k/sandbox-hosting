import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const client = new SSMClient({});
const cache = new Map<string, { value: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getSecret(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const res = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found: ${name}`);
  cache.set(name, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
