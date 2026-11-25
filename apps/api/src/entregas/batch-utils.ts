import type { Prisma } from '@prisma/client';

/** Fecha o lote quando todos os pedidos dele foram entregues ou cancelados (ou cancela se ficou vazio sem nenhuma tentativa). */
export async function closeBatchIfDone(tx: Prisma.TransactionClient, batchId: string | null) {
  if (!batchId) return;
  const orders = await tx.order.findMany({ where: { batchId }, select: { status: true } });
  if (orders.length === 0) {
    // Vazio: se o motoboy chegou a tentar alguma entrega (ocorrência), o lote rodou e conta como concluído.
    const tried = await tx.deliveryAttempt.count({ where: { batchId } });
    await tx.deliveryBatch.updateMany({ where: { id: batchId, status: 'OUT' }, data: { status: tried ? 'DONE' : 'CANCELLED', finishedAt: new Date() } });
    return;
  }
  if (orders.every((o) => o.status === 'COMPLETED' || o.status === 'CANCELLED')) {
    await tx.deliveryBatch.updateMany({ where: { id: batchId, status: 'OUT' }, data: { status: 'DONE', finishedAt: new Date() } });
  }
}
