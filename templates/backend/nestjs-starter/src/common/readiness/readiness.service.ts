import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RateLimitService } from '../rate-limit/rate-limit.service';

type DependencyStatus = 'ok' | 'unavailable' | 'disabled';
type ReadinessResult = {
  status: 'ready' | 'not_ready';
  checks: { database: DependencyStatus; redis: DependencyStatus };
  error?: { code: 'SERVICE_NOT_READY'; message: string };
};

const READINESS_TIMEOUT_MS = 500;

@Injectable()
export class ReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async check(): Promise<ReadinessResult> {
    const databaseProbe = this.probe(() => this.dataSource.query('SELECT 1'));
    const redisProbe = this.config.get<boolean>('RATE_LIMIT_ENABLED', true)
      ? this.probe(async () => {
        if (!(await this.rateLimit.isRedisAvailable(READINESS_TIMEOUT_MS))) throw new Error('Redis unavailable');
      })
      : Promise.resolve<DependencyStatus>('disabled');
    const [database, redis] = await Promise.all([databaseProbe, redisProbe]);
    const checks = { database, redis };
    if (database === 'unavailable' || redis === 'unavailable') {
      return {
        status: 'not_ready',
        checks,
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'One or more required dependencies are unavailable.',
        },
      };
    }
    return { status: 'ready', checks };
  }

  private async probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Readiness timeout')), READINESS_TIMEOUT_MS);
        }),
      ]);
      return 'ok';
    } catch {
      return 'unavailable';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
