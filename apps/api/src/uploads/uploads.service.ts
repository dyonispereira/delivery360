import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Até 3 MB por foto (o painel já reduz para ~1600 px antes de enviar). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Confere o tipo pelos primeiros bytes do arquivo (não confia no que o navegador diz). SVG não entra. */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recebe a foto como data URL (base64) e devolve o endereço público dela. */
  async save(dataUrl: string, tenantId: string | null, userId: string | null, baseUrl: string) {
    const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl ?? '');
    if (!m) throw new BadRequestException('Envie uma foto em JPG, PNG ou WebP.');
    const bytes = Buffer.from(m[1], 'base64');
    if (bytes.length === 0) throw new BadRequestException('A foto está vazia.');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new BadRequestException('A foto passa de 3 MB. Use uma imagem menor.');
    const mime = sniffImage(bytes);
    if (!mime) throw new BadRequestException('Formato não aceito. Envie uma foto em JPG, PNG ou WebP.');
    const up = await this.prisma.upload.create({ data: { tenantId, createdById: userId, mime, bytes, size: bytes.length }, select: { id: true } });
    return { id: up.id, url: `${baseUrl}/public/uploads/${up.id}` };
  }

  async get(id: string) {
    const up = await this.prisma.upload.findUnique({ where: { id }, select: { mime: true, bytes: true } });
    if (!up) throw new NotFoundException('Foto não encontrada.');
    return up;
  }
}

/** Endereço público da API para montar o link da foto. */
export function apiBaseUrl(req: { protocol: string; get(name: string): string | undefined }) {
  const env = process.env.PUBLIC_API_URL?.replace(/\/+$/, '');
  return env || `${req.protocol}://${req.get('host')}`;
}
