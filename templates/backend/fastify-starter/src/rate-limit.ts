import { createConnection } from 'node:net';
import { connect as connectTls } from 'node:tls';
import type { Config } from './config.js';

type Bucket = number[];
export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';

/** Redis counters are shared by every API process; memory is only a local fallback. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: Config) {}

  async consume(key: string): Promise<RateLimitResult> {
    if (!this.config.RATE_LIMIT_ENABLED) return 'allowed';
    const redis = await this.consumeRedis(key);
    if (redis !== null) return redis ? 'allowed' : 'limited';
    if (this.config.environment === 'production' || this.config.environment === 'staging') return 'unavailable';

    const now = Date.now();
    const cutoff = now - this.config.RATE_LIMIT_WINDOW_SECONDS * 1_000;
    const bucket = this.buckets.get(key) ?? [];
    while (bucket[0] !== undefined && bucket[0] <= cutoff) bucket.shift();
    if (bucket.length >= this.config.RATE_LIMIT_REQUESTS) return 'limited';
    bucket.push(now);
    this.buckets.set(key, bucket);
    return 'allowed';
  }

  private async consumeRedis(key: string): Promise<boolean | null> {
    if (!this.config.REDIS_URL) return null;
    try {
      const target = new URL(this.config.REDIS_URL);
      if (!['redis:', 'rediss:'].includes(target.protocol)) return null;
      const window = Math.floor(Date.now() / (this.config.RATE_LIMIT_WINDOW_SECONDS * 1_000));
      const redisKey = `${this.config.RATE_LIMIT_PREFIX}:${key}:${window}`;
      const command = (parts: string[]) => `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
      const script = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return count";
      const increment = command(['EVAL', script, '1', redisKey, String(this.config.RATE_LIMIT_WINDOW_SECONDS)]);
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = target.protocol === 'rediss:'
          ? connectTls({ host: target.hostname, port: Number(target.port || 6380), servername: target.hostname })
          : createConnection({ host: target.hostname, port: Number(target.port || 6379) });
        let received = '';
        const finish = (result: string | Error) => {
          clearTimeout(timer);
          socket.removeAllListeners();
          socket.destroy();
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const timer = setTimeout(() => finish(new Error('Redis timeout')), 300);
        socket.once('error', (error) => finish(error));
        socket.once('connect', () => {
          const password = decodeURIComponent(target.password);
          const username = decodeURIComponent(target.username);
          socket.on('data', (chunk: Buffer) => {
            received += chunk.toString();
            if (received.startsWith('-')) return finish(new Error('Redis command failed'));
            const match = received.match(/(?:^|\r\n):(\d+)\r\n/);
            if (match) finish(match[1]);
          });
          socket.write(password ? `${command(username ? ['AUTH', username, password] : ['AUTH', password])}${increment}` : increment);
        });
      });
      return Number(reply) <= this.config.RATE_LIMIT_REQUESTS;
    } catch {
      return null;
    }
  }
}
