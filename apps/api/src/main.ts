import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás de proxy (Render, site na frente), o limite por IP precisa do IP real do cliente.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');
  setupApp(app);
  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port);
  console.log(`API Delivery360 em http://localhost:${port}`);
}

void bootstrap();
