import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Configuração comum ao servidor e aos testes e2e. */
export function setupApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'] });
}
