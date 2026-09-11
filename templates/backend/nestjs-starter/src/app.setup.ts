import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppErrorFilter } from './common/errors/app-error.filter';

export function configureApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AppErrorFilter());
}
