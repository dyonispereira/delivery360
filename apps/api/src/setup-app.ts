import { BadRequestException, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { translateValidationMessage } from './validation-messages';

/** Junta as mensagens de todos os campos (inclusive aninhados), já em português. */
function collect(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((m) => translateValidationMessage(m.startsWith(e.property) ? m.replace(e.property, path) : m));
    return [...own, ...collect(e.children ?? [], path)];
  });
}

/** Configuração comum ao servidor e aos testes e2e. */
export function setupApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException(collect(errors)),
    }));
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'] });
}
