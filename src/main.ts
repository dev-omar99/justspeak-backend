import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  const httpInstance = app.getHttpAdapter().getInstance();
  if (typeof httpInstance?.disable === 'function') {
    httpInstance.disable('x-powered-by');
  }

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

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('JustSpeak API')
    .setDescription(
      'The comprehensive RESTful API documentation for JustSpeak language practice platform. Includes authentication, matchmaking, video rooms, user profiles, and administrative operations.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT Bearer token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'Signup, login, OTP verification, Google OAuth, and password recovery')
    .addTag('Users', 'User profile, leaderboard, buddy system, tribes, and subscriptions')
    .addTag('Rooms', 'Live WebRTC rooms, matchmaking queue, buddy direct calls, and reconnect tickets')
    .addTag('Feedback', 'Session ratings, language badges, and peer reviews')
    .addTag('Admin', 'Platform administration, user management, and statistics')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'JustSpeak API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
