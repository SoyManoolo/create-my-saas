import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';

async function bootstrap() {
  // Stripe verifies an HMAC over the exact body bytes. Nest exposes those bytes
  // as request.rawBody while retaining normal JSON parsing for every other route.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApplication(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
