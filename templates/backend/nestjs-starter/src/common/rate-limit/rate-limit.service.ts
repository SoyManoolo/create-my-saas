import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection } from 'node:net';
import { connect as connectTls } from 'node:tls';

type Bucket = { hits: number; resetAt: number };

/** Redis is used when REDIS_URL is configured; the in-process store is a safe development fallback. */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly config: ConfigService) {}
  async consume(key: string, limit?: number, windowSeconds?: number): Promise<boolean> {
    if (!this.config.get<boolean>('RATE_LIMIT_ENABLED', true)) return true;
    const max = limit ?? this.config.get<number>('RATE_LIMIT_REQUESTS', 30);
    const window = (windowSeconds ?? this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60)) * 1000;
    const redis = await this.consumeRedis(key, max, windowSeconds ?? this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60));
    if (redis !== null) return redis;
    if (this.config.get<string>('NODE_ENV') === 'production' || this.config.get<string>('NODE_ENV') === 'staging') return false;
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { hits: 0, resetAt: now + window } : current;
    bucket.hits += 1;
    this.buckets.set(key, bucket);
    return bucket.hits <= max;
  }

  async isRedisAvailable(timeoutMs = 500): Promise<boolean> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return false;
    try {
      const target = new URL(url);
      if (!['redis:', 'rediss:'].includes(target.protocol)) return false;
      const command = (parts: string[]): string => `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
      return await new Promise<boolean>((resolve) => {
        const socket = target.protocol === 'rediss:'
          ? connectTls({ host: target.hostname, port: Number(target.port || 6380), servername: target.hostname })
          : createConnection({ host: target.hostname, port: Number(target.port || 6379) });
        let settled = false;
        const finish = (available: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.removeAllListeners();
          socket.destroy();
          resolve(available);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        socket.once('error', () => finish(false));
        socket.once(target.protocol === 'rediss:' ? 'secureConnect' : 'connect', () => {
          let received = '';
          socket.on('data', (chunk: Buffer) => {
            received += chunk.toString();
            if (received.split('\r\n').some((line) => line.startsWith('-'))) return finish(false);
            if (received.includes('+PONG\r\n')) finish(true);
          });
          const password = decodeURIComponent(target.password);
          const username = decodeURIComponent(target.username);
          const ping = command(['PING']);
          socket.write(password ? `${command(username ? ['AUTH', username, password] : ['AUTH', password])}${ping}` : ping);
        });
      });
    } catch {
      return false;
    }
  }

  private async consumeRedis(key: string, max: number, windowSeconds: number): Promise<boolean | null> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      const target = new URL(url);
      if (!['redis:', 'rediss:'].includes(target.protocol)) return null;
      const redisKey = `${this.config.get<string>('RATE_LIMIT_PREFIX', 'rate-limit')}:${key}`;
      const command = (parts: string[]): string => `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
      const script = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return count";
      const increment = command(['EVAL', script, '1', redisKey, String(windowSeconds)]);
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = target.protocol === 'rediss:'
          ? connectTls({ host: target.hostname, port: Number(target.port || 6380), servername: target.hostname })
          : createConnection({ host: target.hostname, port: Number(target.port || 6379) });
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('Redis timeout')); }, 300);
        const done = (data: Buffer) => { clearTimeout(timer); socket.destroy(); resolve(data.toString()); };
        socket.once('error', reject);
        socket.once('connect', () => {
          const password = decodeURIComponent(target.password);
          if (!password) { socket.once('data', done); socket.write(increment); return; }
          socket.once('data', (authReply: Buffer) => {
            if (authReply.toString().startsWith('-')) { clearTimeout(timer); socket.destroy(); reject(new Error('Redis authentication failed')); return; }
            socket.once('data', done); socket.write(increment);
          });
          const username = decodeURIComponent(target.username);
          socket.write(command(username ? ['AUTH', username, password] : ['AUTH', password]));
        });
      });
      const match = reply.match(/^:(\d+)\r\n$/);
      return match ? Number(match[1]) <= max : null;
    } catch { return null; }
  }
}
