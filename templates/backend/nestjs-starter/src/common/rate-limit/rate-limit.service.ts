import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

type Bucket = { hits: number; resetAt: number };
export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';
const incrementScript = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return count";
const within = <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Redis timeout')), timeoutMs);
  operation.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const redisCommandTimeoutMs = 300;
const redisConnectTimeoutMs = 1_000;

/** A shared node-redis connection backs all instances; memory is development/test fallback only. */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private client?: RedisClientType;
  private connecting?: Promise<RedisClientType | undefined>;
  private retryAfter = 0;
  constructor(private readonly config: ConfigService) {}

  async consume(key: string, limit?: number, windowSeconds?: number): Promise<RateLimitResult> {
    if (!this.config.get<boolean>('RATE_LIMIT_ENABLED', true)) return 'allowed';
    const max = limit ?? this.config.get<number>('RATE_LIMIT_REQUESTS', 30);
    const seconds = windowSeconds ?? this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60);
    const redis = await this.consumeRedis(key, max, seconds);
    if (redis !== undefined) return redis ? 'allowed' : 'limited';
    if (this.protectedEnvironment()) return 'unavailable';
    return this.consumeMemory(key, max, seconds);
  }

  async isRedisAvailable(timeoutMs = 500): Promise<boolean> {
    const client = await this.redis(timeoutMs);
    if (!client) return false;
    try { return (await within(client.ping(), timeoutMs)) === 'PONG'; }
    catch { this.markUnavailable(); return false; }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client?.isOpen) await client.close();
  }

  private consumeMemory(key: string, max: number, seconds: number): RateLimitResult {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { hits: 0, resetAt: now + seconds * 1_000 } : current;
    bucket.hits += 1;
    this.buckets.set(key, bucket);
    return bucket.hits <= max ? 'allowed' : 'limited';
  }

  private async consumeRedis(key: string, max: number, seconds: number): Promise<boolean | undefined> {
    const client = await this.redis(this.client?.isReady ? redisCommandTimeoutMs : redisConnectTimeoutMs);
    if (!client) return undefined;
    try {
      const window = Math.floor(Date.now() / (seconds * 1_000));
      const redisKey = `${this.config.get<string>('RATE_LIMIT_PREFIX', 'rate-limit')}:${key}:${window}`;
      const count = await within(client.eval(incrementScript, { keys: [redisKey], arguments: [String(seconds)] }) as Promise<number>, redisCommandTimeoutMs);
      return Number(count) <= max;
    } catch { this.markUnavailable(); return undefined; }
  }

  private async redis(timeoutMs: number): Promise<RedisClientType | undefined> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url || Date.now() < this.retryAfter) return undefined;
    try { if (!['redis:', 'rediss:'].includes(new URL(url).protocol)) return undefined; } catch { return undefined; }
    if (this.client?.isReady) return this.client;
    if (!this.client) {
      this.client = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: redisConnectTimeoutMs, reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 1_000) } });
      this.client.on('error', () => undefined);
    }
    if (!this.connecting) {
      const client = this.client;
      this.connecting = this.waitForReady(client).catch(() => { this.markUnavailable(); return undefined; }).finally(() => { this.connecting = undefined; });
    }
    return within(this.connecting, timeoutMs).catch(() => { this.markUnavailable(); return undefined; });
  }

  private async waitForReady(client: RedisClientType): Promise<RedisClientType> {
    if (client.isReady) return client;
    if (!client.isOpen) await client.connect();
    if (client.isReady) return client;
    return new Promise<RedisClientType>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Redis connection timeout')), redisConnectTimeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        client.off('ready', ready);
        client.off('error', failed);
        error ? reject(error) : resolve(client);
      };
      const ready = () => finish();
      const failed = (error: Error) => finish(error);
      client.once('ready', ready);
      client.once('error', failed);
    });
  }

  private protectedEnvironment(): boolean { return ['production', 'staging'].includes(this.config.get<string>('NODE_ENV', 'development')); }
  private markUnavailable(): void { this.retryAfter = Date.now() + 250; }
}
