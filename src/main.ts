import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

function validateRequiredEnv(): void {
  const logger = new Logger('Bootstrap');
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter(
    (key) => !process.env[key] || !process.env[key]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
    logger.warn(
      'GOOGLE_CLIENT_ID is not configured; Google Sign-In endpoints will reject requests until set.',
    );
  }
}

async function bootstrap() {
  validateRequiredEnv();
  const app = await NestFactory.create(AppModule);

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true;
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();