import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@delivery360/shared'],
  /**
   * Em hospedagem de um serviço só (ex.: link de teste no Render), a API roda no mesmo servidor
   * e o navegador fala com ela por /api, sem precisar de outro domínio nem de CORS.
   */
  async rewrites() {
    const target = process.env.API_INTERNAL_URL;
    return target ? [{ source: '/api/:path*', destination: `${target}/:path*` }] : [];
  },
};

export default nextConfig;
