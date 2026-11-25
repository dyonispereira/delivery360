import type { Prisma } from '@prisma/client';

/** Fecha o lote quando todos os pedidos dele foram entregues ou cancelados (ou cancela se ficou vazio). */
export async function closeBatchIfDone(tx: Prisma.TransactionClient, batchId: string | null) {
  if (!batchId) return;
  const orders = await tx.order.findMany({ where: { batchId }, select: { status: true } });
  if (orders.length === 0) {
    await tx.deliveryBatch.update({ where: { id: batchId }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    return;
  }
  if (orders.every((o) => o.status === 'COMPLETED' || o.status === 'CANCELLED')) {
    await tx.deliveryBatch.updateMany({ where: { id: batchId, status: 'OUT' }, data: { status: 'DONE', finishedAt: new Date() } });
  }
}
