import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { ReadinessService } from './common/readiness/readiness.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get()
  getHealth(): { message: string } {
    return this.appService.getHealth();
  }

  @Get('health')
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness() {
    const result = await this.readiness.check();
    if (result.status === 'not_ready') throw new ServiceUnavailableException(result);
    return result;
  }
}
