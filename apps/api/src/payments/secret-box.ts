import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifra segredos guardados no banco (chave da API do gateway) com AES-256-GCM.
 * A chave vem de PAYMENTS_SECRET (ou, se não houver, de JWT_SECRET).
 */
function key() {
  const secret = process.env.PAYMENTS_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Defina PAYMENTS_SECRET para guardar chaves de pagamento.');
  return createHash('sha256').update(`delivery360:payments:${secret}`).digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function open(sealed: string) {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Segredo em formato desconhecido.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
