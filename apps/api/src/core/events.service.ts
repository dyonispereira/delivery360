import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Fila de eventos entre módulos. Cada módulo publica eventos (ex.: "pedido.entregue")
 * e o módulo Gestão os consome para gerar lançamentos no financeiro.
 * No MVP a fila é a tabela domain_events; um job vai processá-la nas próximas sprints.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  publish(tenantId: string, type: string, payload: Record<string, unknown>, db: Db = this.prisma) {
    return db.domainEvent.create({
      data: { tenantId, type, payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue },
    });
  }
}
