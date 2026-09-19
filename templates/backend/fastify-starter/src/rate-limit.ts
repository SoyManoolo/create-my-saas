import { createClient, type RedisClientType } from 'redis';
import type { Config } from './config.js';

type Bucket = number[];
type RateLimitPolicy = { limit: number; windowSeconds: number };
export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';
const incrementScript = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return count";
const within = <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => Promise.race([operation, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('Redis timeout')), timeoutMs))]);

/** A shared node-redis connection backs all instances; memory is development/test fallback only. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private client?: RedisClientType;
  private connecting?: Promise<RedisClientType | undefined>;
  private retryAfter = 0;
  constructor(private readonly config: Config) {}

  async consume(key: string, policy?: RateLimitPolicy): Promise<RateLimitResult> {
    if (!this.config.RATE_LIMIT_ENABLED) return 'allowed';
    const limit = policy?.limit ?? this.config.RATE_LIMIT_REQUESTS;
    const seconds = policy?.windowSeconds ?? this.config.RATE_LIMIT_WINDOW_SECONDS;
    const redis = await this.consumeRedis(key, limit, seconds);
    if (redis !== undefined) return redis ? 'allowed' : 'limited';
    if (this.config.environment === 'production' || this.config.environment === 'staging') return 'unavailable';
    return this.consumeMemory(key, limit, seconds);
  }

  async isRedisAvailable(timeoutMs = 500): Promise<boolean> {
    const client = await this.redis(timeoutMs);
    if (!client) return false;
    try { return (await within(client.ping(), timeoutMs)) === 'PONG'; }
    catch { this.markUnavailable(); return false; }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client?.isOpen) await client.close();
  }

  private consumeMemory(key: string, limit: number, seconds: number): RateLimitResult {
    const now = Date.now(); const cutoff = now - seconds * 1_000;
    const bucket = this.buckets.get(key) ?? [];
    while (bucket[0] !== undefined && bucket[0] <= cutoff) bucket.shift();
    if (bucket.length >= limit) return 'limited';
    bucket.push(now); this.buckets.set(key, bucket); return 'allowed';
  }

  private async consumeRedis(key: string, limit: number, seconds: number): Promise<boolean | undefined> {
    const client = await this.redis(300);
    if (!client) return undefined;
    try {
      const window = Math.floor(Date.now() / (seconds * 1_000));
      const count = await within(client.eval(incrementScript, { keys: [`${this.config.RATE_LIMIT_PREFIX}:${key}:${window}`], arguments: [String(seconds)] }) as Promise<number>, 300);
      return Number(count) <= limit;
    } catch { this.markUnavailable(); return undefined; }
  }

  private async redis(timeoutMs: number): Promise<RedisClientType | undefined> {
    const url = this.config.REDIS_URL;
    if (!url || Date.now() < this.retryAfter) return undefined;
    try { if (!['redis:', 'rediss:'].includes(new URL(url).protocol)) return undefined; } catch { return undefined; }
    if (this.client?.isReady) return this.client;
    if (!this.client) {
      this.client = createClient({ url, disableOfflineQueue: true, commandsQueueMaxLength: 1, socket: { connectTimeout: timeoutMs, reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 1_000) } });
      this.client.on('error', () => undefined);
    }
    if (!this.connecting) {
      const client = this.client;
      this.connecting = (client.isOpen ? Promise.resolve() : client.connect()).then(() => client).catch(() => { this.markUnavailable(); return undefined; }).finally(() => { this.connecting = undefined; });
    }
    return within(this.connecting, timeoutMs).catch(() => { this.markUnavailable(); return undefined; });
  }

  private markUnavailable(): void { this.retryAfter = Date.now() + 250; }
}
