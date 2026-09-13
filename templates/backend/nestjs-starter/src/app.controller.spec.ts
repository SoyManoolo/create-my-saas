import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReadinessService } from './common/readiness/readiness.service';

describe('AppController', () => {
  let appController: AppController;
  let readiness: { check: jest.Mock };

  beforeEach(async () => {
    readiness = {
      check: jest.fn().mockResolvedValue({ status: 'ready', checks: { database: 'ok', redis: 'disabled' } }),
    };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ReadinessService,
          useValue: readiness,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health check', () => {
    it('reports the service as running', () => {
      expect(appController.getHealth()).toEqual({ message: 'Running successfully!' });
    });

    it('keeps liveness independent from external dependencies', () => {
      expect(appController.getLiveness()).toEqual({ status: 'ok' });
    });

    it('reports readiness separately', async () => {
      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ready',
        checks: { database: 'ok', redis: 'disabled' },
      });
    });

    it('maps an unavailable dependency to a structured 503', async () => {
      const failure = {
        status: 'not_ready',
        checks: { database: 'unavailable', redis: 'ok' },
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'One or more required dependencies are unavailable.',
        },
      };
      readiness.check.mockResolvedValue(failure);

      await expect(appController.getReadiness()).rejects.toMatchObject({
        response: failure,
        status: 503,
      });
    });
  });
});
