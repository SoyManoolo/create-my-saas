import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection } from 'node:net';

type Bucket = { hits: number; resetAt: number };

/** Redis is used when REDIS_URL is configured; the in-process store is a safe development fallback. */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly config: ConfigService) {}
  async consume(key: string, limit?: number, windowSeconds?: number): Promise<boolean> {
    const max = limit ?? this.config.get<number>('RATE_LIMIT_MAX', 30);
    const window = (windowSeconds ?? this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60)) * 1000;
    const redis = await this.consumeRedis(key, max, windowSeconds ?? this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60));
    if (redis !== null) return redis;
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { hits: 0, resetAt: now + window } : current;
    bucket.hits += 1;
    this.buckets.set(key, bucket);
    return bucket.hits <= max;
  }

  private async consumeRedis(key: string, max: number, windowSeconds: number): Promise<boolean | null> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      const target = new URL(url); const redisKey = `rate-limit:${key}`;
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: target.hostname, port: Number(target.port || 6379) });
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('Redis timeout')); }, 300);
        socket.once('error', reject); socket.on('data', (data: Buffer) => { clearTimeout(timer); socket.end(); resolve(data.toString()); });
        socket.once('connect', () => socket.write(`*1\r\n$5\r\nMULTI\r\n*2\r\n$4\r\nINCR\r\n$${Buffer.byteLength(redisKey)}\r\n${redisKey}\r\n*3\r\n$6\r\nEXPIRE\r\n$${Buffer.byteLength(redisKey)}\r\n${redisKey}\r\n$${String(windowSeconds).length}\r\n${windowSeconds}\r\n*1\r\n$4\r\nEXEC\r\n`));
      });
      const matches = [...reply.matchAll(/:(\d+)/g)].map((match) => Number(match[1]));
      return matches.length > 0 ? matches[0] <= max : null;
    } catch { return null; }
  }
}
