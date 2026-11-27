/* eslint-disable */
// Gerador das artes da loja modelo "Fornalha Pizzaria" (fictícia).
// Tudo é desenhado aqui em SVG (sem fotos de terceiros) e virado PNG/WebP pelo Chromium.
// Uso: node apps/web/scripts/vitrine/render.mjs

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Math.round(n * 10) / 10;

export const BRAND = {
  red: '#B3261E',
  redDark: '#7A140F',
  cream: '#FFF4E0',
  char: '#1D1A17',
  gold: '#F2B705',
};

/* ---------- Defs reaproveitáveis ---------- */
function defs(id) {
  return `
  <defs>
    <filter id="${id}-cheese" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 0 0.05  0 0 0 0.55 0" result="c"/>
      <feComposite in="c" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="${id}-photo" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0.16 0" result="c"/>
      <feComposite in="c" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="${id}-ctex" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="3" seed="4" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.75  0 0 0 0 0.45  0 0 0 0 0.1  0 0 0 0.5 -0.08" result="c"/>
      <feComposite in="c" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="${id}-soft"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="${id}-blur8"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="${id}-blur20"><feGaussianBlur stdDeviation="20"/></filter>
    <filter id="${id}-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="2" dy="4" stdDeviation="3" flood-color="#3a1a05" flood-opacity="0.45"/>
    </filter>
    <filter id="${id}-bigshadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="28" stdDeviation="26" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <filter id="${id}-wood" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.09" numOctaves="4" seed="11" result="w"/>
      <feColorMatrix in="w" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.9 0" result="c"/>
      <feComposite in="c" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="${id}-char" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="4" seed="21" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.09  0 0 0 0 0.02  0 0 0 -11 6.1" result="spots"/>
      <feComposite in="spots" in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="${id}-crust" cx="50%" cy="50%" r="50%">
      <stop offset="86%" stop-color="#E9B465"/>
      <stop offset="91%" stop-color="#E0A04F"/>
      <stop offset="95.5%" stop-color="#C47D33"/>
      <stop offset="98.5%" stop-color="#93531F"/>
      <stop offset="100%" stop-color="#5E3010"/>
    </radialGradient>
    <radialGradient id="${id}-cheesefill" cx="45%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#FFDC84"/>
      <stop offset="50%" stop-color="#F7C152"/>
      <stop offset="85%" stop-color="#EBA43A"/>
      <stop offset="100%" stop-color="#D98A2B"/>
    </radialGradient>
    <radialGradient id="${id}-light" cx="35%" cy="28%" r="80%">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.12"/>
      <stop offset="50%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#2a1200" stop-opacity="0.3"/>
    </radialGradient>
    <radialGradient id="${id}-pep" cx="45%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#D2452C"/>
      <stop offset="70%" stop-color="#A82A19"/>
      <stop offset="100%" stop-color="#6E150B"/>
    </radialGradient>
    <radialGradient id="${id}-cal" cx="45%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#C95A48"/>
      <stop offset="75%" stop-color="#A9402F"/>
      <stop offset="100%" stop-color="#7A2A1E"/>
    </radialGradient>
    <radialGradient id="${id}-tom" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#F06B4E"/>
      <stop offset="70%" stop-color="#D93A25"/>
      <stop offset="100%" stop-color="#A9200F"/>
    </radialGradient>
    <radialGradient id="${id}-brown" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#A9561B" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="#C9772A" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#E09A3E" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-choco" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#7A4128"/>
      <stop offset="60%" stop-color="#4E2414"/>
      <stop offset="100%" stop-color="#32160B"/>
    </radialGradient>
    <linearGradient id="${id}-leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4C9A3A"/>
      <stop offset="100%" stop-color="#1F5E1E"/>
    </linearGradient>
  </defs>`;
}

/* ---------- Coberturas ---------- */
function scatter(r, n, R, minD, avoid = []) {
  const pts = [];
  let tries = 0;
  while (pts.length < n && tries < n * 400) {
    tries++;
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * R;
    const p = [Math.cos(a) * d, Math.sin(a) * d];
    if (!minD || [...pts, ...avoid].every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > minD)) pts.push(p);
  }
  return pts;
}

const T = {
  pepperoni(id, r, x, y, s = 1) {
    const rad = (30 + r() * 6) * s;
    const spots = Array.from({ length: 5 }, () => `<circle cx="${f(x + (r() - 0.5) * rad)}" cy="${f(y + (r() - 0.5) * rad)}" r="${f(rad * (0.06 + r() * 0.08))}" fill="#5B1007" opacity="0.5"/>`).join('');
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="url(#${id}-pep)"/>
      <circle cx="${f(x)}" cy="${f(y)}" r="${f(rad * 0.82)}" fill="none" stroke="#7E1A0C" stroke-width="${f(rad * 0.12)}" opacity="0.55"/>
      ${spots}<ellipse cx="${f(x - rad * 0.3)}" cy="${f(y - rad * 0.35)}" rx="${f(rad * 0.28)}" ry="${f(rad * 0.12)}" fill="#fff" opacity="0.28" transform="rotate(-30 ${f(x)} ${f(y)})"/></g>`;
  },
  calabresa(id, r, x, y, s = 1) {
    const rad = (34 + r() * 6) * s;
    const fat = Array.from({ length: 9 }, () => {
      const a = r() * Math.PI * 2, d = r() * rad * 0.75;
      return `<ellipse cx="${f(x + Math.cos(a) * d)}" cy="${f(y + Math.sin(a) * d)}" rx="${f(2 + r() * 4)}" ry="${f(1.5 + r() * 2.5)}" fill="#F1B2A0" opacity="0.85"/>`;
    }).join('');
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="url(#${id}-cal)"/>
      <circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="none" stroke="#5E1D12" stroke-width="3.5"/>${fat}
      <ellipse cx="${f(x - rad * 0.3)}" cy="${f(y - rad * 0.4)}" rx="${f(rad * 0.3)}" ry="${f(rad * 0.1)}" fill="#fff" opacity="0.22" transform="rotate(-25 ${f(x)} ${f(y)})"/></g>`;
  },
  onion(id, r, x, y, s = 1) {
    const rx = (26 + r() * 14) * s, ry = rx * (0.45 + r() * 0.3), rot = r() * 180;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})" filter="url(#${id}-shadow)"><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="none" stroke="#9C4F86" stroke-width="${f(9 * s)}" opacity="0.85"/>
      <ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="none" stroke="#F4E6F0" stroke-width="${f(4.5 * s)}" opacity="0.95"/></g>`;
  },
  olive(id, r, x, y, s = 1) {
    const rad = (11 + r() * 3) * s;
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="none" stroke="#1E1B18" stroke-width="${f(rad * 0.75)}"/>
      <path d="M${f(x - rad * 0.6)} ${f(y - rad * 0.9)} a${f(rad)} ${f(rad)} 0 0 1 ${f(rad * 1.2)} 0" stroke="#8C8C8C" stroke-width="2" fill="none" opacity="0.7"/></g>`;
  },
  greenolive(id, r, x, y, s = 1) {
    const rad = (11 + r() * 3) * s;
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="none" stroke="#6F7D2A" stroke-width="${f(rad * 0.75)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad * 0.38)}" fill="#C0392B"/></g>`;
  },
  basil(id, r, x, y, s = 1) {
    const L = (34 + r() * 14) * s, W = L * 0.55, rot = r() * 360;
    return `<g filter="url(#${id}-shadow)" transform="rotate(${f(rot)} ${f(x)} ${f(y)})">
      <path d="M${f(x - L)} ${f(y)} Q${f(x - L * 0.2)} ${f(y - W)} ${f(x + L)} ${f(y)} Q${f(x - L * 0.2)} ${f(y + W)} ${f(x - L)} ${f(y)}Z" fill="url(#${id}-leaf)"/>
      <path d="M${f(x - L * 0.9)} ${f(y)} L${f(x + L * 0.85)} ${f(y)}" stroke="#A6D68E" stroke-width="1.8" opacity="0.7"/>
      <path d="M${f(x - L * 0.4)} ${f(y - W * 0.35)} Q${f(x)} ${f(y - W * 0.5)} ${f(x + L * 0.3)} ${f(y - W * 0.3)}" stroke="#fff" stroke-width="2" fill="none" opacity="0.18"/></g>`;
  },
  tomato(id, r, x, y, s = 1) {
    const rad = (36 + r() * 6) * s;
    const lobes = Array.from({ length: 4 }, (_, i) => {
      const a = (i / 4) * Math.PI * 2 + r() * 0.4;
      const cx = x + Math.cos(a) * rad * 0.5, cy = y + Math.sin(a) * rad * 0.5;
      const seeds = Array.from({ length: 4 }, () => `<ellipse cx="${f(cx + (r() - 0.5) * rad * 0.35)}" cy="${f(cy + (r() - 0.5) * rad * 0.35)}" rx="2.6" ry="1.6" fill="#F7E08A"/>`).join('');
      return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rad * 0.3)}" ry="${f(rad * 0.22)}" fill="#F48C69" transform="rotate(${f((a * 180) / Math.PI)} ${f(cx)} ${f(cy)})"/>${seeds}`;
    }).join('');
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="url(#${id}-tom)"/>${lobes}
      <circle cx="${f(x)}" cy="${f(y)}" r="${f(rad * 0.16)}" fill="#E85A3F"/>
      <ellipse cx="${f(x - rad * 0.35)}" cy="${f(y - rad * 0.4)}" rx="${f(rad * 0.3)}" ry="${f(rad * 0.1)}" fill="#fff" opacity="0.3" transform="rotate(-30 ${f(x)} ${f(y)})"/></g>`;
  },
  cherry(id, r, x, y, s = 1) {
    const rad = (17 + r() * 3) * s;
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="url(#${id}-tom)"/>
      <path d="M${f(x - rad * 0.5)} ${f(y)} Q${f(x)} ${f(y - rad * 0.5)} ${f(x + rad * 0.5)} ${f(y)} Q${f(x)} ${f(y + rad * 0.5)} ${f(x - rad * 0.5)} ${f(y)}" fill="#F48C69"/>
      <ellipse cx="${f(x - rad * 0.35)}" cy="${f(y - rad * 0.45)}" rx="${f(rad * 0.3)}" ry="${f(rad * 0.12)}" fill="#fff" opacity="0.35"/></g>`;
  },
  chicken(id, r, x, y, s = 1) {
    const parts = Array.from({ length: 3 }, () => {
      const L = (14 + r() * 16) * s, a = r() * 180, dx = (r() - 0.5) * 20, dy = (r() - 0.5) * 20;
      return `<rect x="${f(x + dx - L / 2)}" y="${f(y + dy - 4.5 * s)}" width="${f(L)}" height="${f(9 * s)}" rx="${f(4.5 * s)}" fill="#EDCB9B" stroke="#C99A5F" stroke-width="1.6" transform="rotate(${f(a)} ${f(x + dx)} ${f(y + dy)})"/>`;
    }).join('');
    return `<g filter="url(#${id}-shadow)">${parts}</g>`;
  },
  catupiry(id, r, x, y, s = 1) {
    const rad = (26 + r() * 16) * s;
    const blob = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2;
      return `${f(x + Math.cos(a) * rad * (0.75 + r() * 0.35))},${f(y + Math.sin(a) * rad * (0.75 + r() * 0.35))}`;
    });
    return `<g filter="url(#${id}-shadow)"><polygon points="${blob.join(' ')}" fill="#FFF9EE" stroke="#EADCC0" stroke-width="5" stroke-linejoin="round"/>
      <ellipse cx="${f(x - rad * 0.2)}" cy="${f(y - rad * 0.25)}" rx="${f(rad * 0.35)}" ry="${f(rad * 0.18)}" fill="#fff"/></g>`;
  },
  corn(id, r, x, y, s = 1) {
    return `<g filter="url(#${id}-shadow)"><rect x="${f(x - 6 * s)}" y="${f(y - 5 * s)}" width="${f(12 * s)}" height="${f(10 * s)}" rx="${f(4 * s)}" fill="#F7C531" stroke="#D99D12" stroke-width="1.2" transform="rotate(${f(r() * 90)} ${f(x)} ${f(y)})"/></g>`;
  },
  bacon(id, r, x, y, s = 1) {
    const w = (20 + r() * 10) * s, h = (11 + r() * 5) * s, a = r() * 180;
    return `<g filter="url(#${id}-shadow)" transform="rotate(${f(a)} ${f(x)} ${f(y)})"><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="3" fill="#8E2F1C"/>
      <rect x="${f(x - w / 2)}" y="${f(y - h * 0.1)}" width="${f(w)}" height="${f(h * 0.25)}" fill="#E9B79D"/><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="3" fill="none" stroke="#5A1A0E" stroke-width="1.4"/></g>`;
  },
  broccoli(id, r, x, y, s = 1) {
    const buds = Array.from({ length: 8 }, () => `<circle cx="${f(x + (r() - 0.5) * 30 * s)}" cy="${f(y + (r() - 0.6) * 24 * s)}" r="${f((7 + r() * 5) * s)}" fill="${r() > 0.5 ? '#3F7F2C' : '#2E6B22'}"/>`).join('');
    return `<g filter="url(#${id}-shadow)"><rect x="${f(x - 5 * s)}" y="${f(y)}" width="${f(10 * s)}" height="${f(20 * s)}" rx="4" fill="#9CC46B"/>${buds}</g>`;
  },
  ham(id, r, x, y, s = 1) {
    const w = (26 + r() * 10) * s, a = r() * 90;
    return `<g filter="url(#${id}-shadow)" transform="rotate(${f(a)} ${f(x)} ${f(y)})"><rect x="${f(x - w / 2)}" y="${f(y - w / 2)}" width="${f(w)}" height="${f(w)}" rx="4" fill="#EBA3A0" stroke="#D07C78" stroke-width="2"/></g>`;
  },
  egg(id, r, x, y, s = 1) {
    const rx = 26 * s, ry = 20 * s, a = r() * 180;
    return `<g filter="url(#${id}-shadow)" transform="rotate(${f(a)} ${f(x)} ${f(y)})"><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="#FDFBF5"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.48)}" ry="${f(ry * 0.55)}" fill="#F6B930"/></g>`;
  },
  pea(id, r, x, y, s = 1) {
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(6 * s)}" fill="#6DAA3A" stroke="#3F7A1E" stroke-width="1.4" filter="url(#${id}-shadow)"/>`;
  },
  blue(id, r, x, y, s = 1) {
    return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f((10 + r() * 8) * s)}" ry="${f((7 + r() * 6) * s)}" fill="#E9EEF0" stroke="#7D8EA3" stroke-width="3" stroke-dasharray="4 5" opacity="0.95"/>`;
  },
  parmesan(id, r, x, y, s = 1) {
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(9 * s)}" height="${f(3 * s)}" rx="1.5" fill="#FFF6D8" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})" opacity="0.95"/>`;
  },
  pepper(id, r, x, y, s = 1) {
    const L = (30 + r() * 10) * s, a = r() * 180;
    return `<g transform="rotate(${f(a)} ${f(x)} ${f(y)})" filter="url(#${id}-shadow)"><path d="M${f(x - L / 2)} ${f(y)} q${f(L / 2)} ${f(-14 * s)} ${f(L)} 0" stroke="#2E8B3A" stroke-width="${f(7 * s)}" fill="none" stroke-linecap="round"/></g>`;
  },
  oregano(id, r, x, y, s = 1) {
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(4 * s)}" height="${f(2.2 * s)}" fill="${r() > 0.5 ? '#4F6B2A' : '#6B7F35'}" opacity="0.85" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})"/>`;
  },
  chili(id, r, x, y, s = 1) {
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3.2 * s)}" fill="#C1121F"/>`;
  },
  shrimp(id, r, x, y, s = 1) {
    const a = r() * 360;
    return `<g transform="rotate(${f(a)} ${f(x)} ${f(y)})" filter="url(#${id}-shadow)"><path d="M${f(x + 18 * s)} ${f(y)} a${f(18 * s)} ${f(18 * s)} 0 1 1 ${f(-10 * s)} ${f(-15 * s)}" stroke="#F49A6B" stroke-width="${f(12 * s)}" fill="none" stroke-linecap="round"/>
      <path d="M${f(x + 18 * s)} ${f(y)} a${f(18 * s)} ${f(18 * s)} 0 1 1 ${f(-10 * s)} ${f(-15 * s)}" stroke="#FCD0B4" stroke-width="${f(4 * s)}" fill="none" stroke-dasharray="3 6"/></g>`;
  },
  strawberry(id, r, x, y, s = 1) {
    const w = 30 * s, h = 34 * s, a = r() * 360;
    const seeds = Array.from({ length: 9 }, () => `<ellipse cx="${f(x + (r() - 0.5) * w * 0.9)}" cy="${f(y + (r() - 0.4) * h * 0.7)}" rx="1.6" ry="2.4" fill="#FBE7A1"/>`).join('');
    return `<g transform="rotate(${f(a)} ${f(x)} ${f(y)})" filter="url(#${id}-shadow)"><path d="M${f(x)} ${f(y + h * 0.55)} C${f(x - w)} ${f(y)} ${f(x - w * 0.6)} ${f(y - h * 0.55)} ${f(x)} ${f(y - h * 0.4)} C${f(x + w * 0.6)} ${f(y - h * 0.55)} ${f(x + w)} ${f(y)} ${f(x)} ${f(y + h * 0.55)}Z" fill="#D7263D"/>
      <path d="M${f(x)} ${f(y + h * 0.3)} C${f(x - w * 0.5)} ${f(y)} ${f(x - w * 0.3)} ${f(y - h * 0.3)} ${f(x)} ${f(y - h * 0.2)} C${f(x + w * 0.3)} ${f(y - h * 0.3)} ${f(x + w * 0.5)} ${f(y)} ${f(x)} ${f(y + h * 0.3)}Z" fill="#F57A86" opacity="0.6"/>${seeds}</g>`;
  },
  banana(id, r, x, y, s = 1) {
    const rad = 20 * s;
    return `<g filter="url(#${id}-shadow)"><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="#F6E6A6" stroke="#E2C66A" stroke-width="3"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(rad * 0.3)}" fill="#E8D080" opacity="0.7"/></g>`;
  },
  sprinkle(id, r, x, y, s = 1) {
    const c = ['#F94144', '#F9C74F', '#90BE6D', '#577590', '#F8F9FA'][Math.floor(r() * 5)];
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(10 * s)}" height="${f(3.4 * s)}" rx="1.7" fill="${c}" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})"/>`;
  },
};

/** Receitas: [cobertura, quantidade, distância mínima, escala]. */
export const RECIPES = {
  calabresa: { base: 'cheese', layers: [['calabresa', 24, 64, 0.95], ['onion', 14, 34, 1], ['olive', 10, 40, 1], ['oregano', 160, 0, 1]] },
  margherita: { base: 'cheese', sauce: 0.35, layers: [['tomato', 10, 95, 1.1], ['basil', 16, 46, 1], ['parmesan', 70, 0, 1]] },
  mussarela: { base: 'cheese', golden: true, layers: [['tomato', 8, 120, 0.9], ['olive', 16, 60, 1.1], ['oregano', 420, 0, 1.2]] },
  frango: { base: 'cheese', layers: [['chicken', 70, 24, 1.35], ['catupiry', 9, 95, 1.2], ['olive', 8, 60, 1], ['oregano', 140, 0, 1]] },
  portuguesa: { base: 'cheese', layers: [['ham', 28, 46, 1.15], ['onion', 12, 40, 1.1], ['egg', 9, 80, 1.1], ['pea', 70, 14, 1.2], ['olive', 10, 50, 1]] },
  pepperoni: { base: 'cheese', layers: [['pepperoni', 44, 48, 0.88], ['oregano', 120, 0, 1]] },
  quatroqueijos: { base: 'cheese', golden: true, layers: [['blue', 22, 50, 1.5], ['catupiry', 9, 100, 1.1], ['parmesan', 200, 0, 1.2], ['oregano', 100, 0, 1]] },
  brocolis: { base: 'cheese', layers: [['broccoli', 22, 58, 1.5], ['bacon', 30, 30, 1.25], ['cherry', 9, 70, 1.1]] },
  baiana: { base: 'cheese', sauce: 0.25, layers: [['calabresa', 18, 64, 0.9], ['corn', 110, 12, 1.4], ['chili', 120, 0, 1.2], ['olive', 8, 60, 1]] },
  bacon: { base: 'cheese', layers: [['bacon', 60, 26, 1.35], ['onion', 8, 60, 1], ['oregano', 140, 0, 1]] },
  camarao: { base: 'cheese', layers: [['shrimp', 20, 70, 1.8], ['catupiry', 8, 90, 1.1], ['basil', 10, 50, 0.8]] },
  chocolate: { base: 'choco', layers: [['strawberry', 13, 70, 1.6], ['sprinkle', 140, 0, 1.2]] },
  banana: { base: 'cream', layers: [['banana', 30, 42, 1.15]], cinnamon: true },
};

function baseCheese(id, r, R, golden) {
  const bubbles = Array.from({ length: golden ? 70 : 48 }, () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.97;
    const s = 10 + r() * 30;
    return `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(s)}" fill="url(#${id}-brown)" opacity="${f((golden ? 0.85 : 0.6) * (0.6 + r() * 0.4))}"/>`;
  }).join('');
  const oil = Array.from({ length: 26 }, () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.9;
    return `<ellipse cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" rx="${f(6 + r() * 14)}" ry="${f(4 + r() * 8)}" fill="#F08A12" opacity="0.28"/>`;
  }).join('');
  const glints = Array.from({ length: 40 }, () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.9;
    return `<ellipse cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" rx="${f(3 + r() * 6)}" ry="${f(1.5 + r() * 2)}" fill="#FFFBEA" opacity="${f(0.35 + r() * 0.4)}" transform="rotate(${f(-30 + r() * 20)} ${f(Math.cos(a) * d)} ${f(Math.sin(a) * d)})"/>`;
  }).join('');
  return `<g filter="url(#${id}-cheese)"><circle r="${f(R)}" fill="url(#${id}-cheesefill)"/><circle r="${f(R)}" fill="#000" filter="url(#${id}-ctex)" opacity="0.55"/>${bubbles}${oil}</g>${glints}`;
}

/** Pizza redonda vista de cima, centrada em (0,0), raio externo R. */
export function pizzaSVG(id, flavor, R = 400, seed = 1, opts = {}) {
  const recipe = RECIPES[flavor];
  const r = rng(seed * 7919 + flavor.length * 31);
  const inner = R * 0.885;
  const parts = [];
  // tábua de madeira por baixo (a foto de estúdio usa a pá de metal no lugar)
  if (opts.board !== false) {
    parts.push(`<circle r="${f(R * 1.07)}" fill="#9A6A3C"/><circle r="${f(R * 1.07)}" fill="#000" filter="url(#${id}-wood)" opacity="0.35"/><circle r="${f(R * 1.07)}" fill="none" stroke="#5A3A1E" stroke-width="${f(R * 0.012)}"/>`);
    parts.push(`<circle r="${f(R * 1.02)}" fill="#000" opacity="0.35" filter="url(#${id}-blur8)"/>`);
  }
  // massa (borda)
  parts.push(`<circle r="${R}" fill="url(#${id}-crust)"/>`);
  parts.push(`<circle r="${R}" fill="#000" filter="url(#${id}-char)" opacity="0.7"/>`);
  parts.push(`<circle r="${R}" fill="#000" filter="url(#${id}-grain)" opacity="0.45"/>`);
  parts.push(`<circle r="${f(R * 0.945)}" fill="none" stroke="#FFE2A8" stroke-width="${f(R * 0.03)}" opacity="0.35" filter="url(#${id}-blur8)"/>`);
  parts.push(Array.from({ length: 30 }, () => { const a = r() * Math.PI * 2; const d = R * (0.9 + r() * 0.08); return `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(1.5 + r() * 2.5)}" fill="#F7EBD3" opacity="0.7"/>`; }).join(''));
  if (recipe.base === 'choco') {
    parts.push(`<g filter="url(#${id}-cheese)"><circle r="${f(inner)}" fill="url(#${id}-choco)"/></g>`);
    const drizzle = Array.from({ length: 9 }, (_, i) => {
      const y0 = -inner + i * inner * 0.24;
      let d = `M${f(-inner)} ${f(y0 + (r() - 0.5) * 40)}`;
      for (let k = 1; k <= 8; k++) d += ` L${f(-inner + (k * inner) / 4)} ${f(y0 + (k % 2 ? -1 : 1) * (18 + r() * 30) + k * 12)}`;
      return `<path d="${d}" stroke="#FFF6E6" stroke-width="${f(4 + r() * 5)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`;
    }).join('');
    parts.push(`<clipPath id="${id}-cc${seed}"><circle r="${f(inner * 0.95)}"/></clipPath><g clip-path="url(#${id}-cc${seed})">${drizzle}</g>`);
    parts.push(`<ellipse cx="${f(-inner * 0.3)}" cy="${f(-inner * 0.35)}" rx="${f(inner * 0.35)}" ry="${f(inner * 0.12)}" fill="#fff" opacity="0.12" transform="rotate(-25)"/>`);
  } else if (recipe.base === 'cream') {
    parts.push(`<g filter="url(#${id}-cheese)"><circle r="${f(inner)}" fill="#FBEFD5"/></g>`);
  } else {
    // molho aparecendo perto da borda
    parts.push(`<circle r="${f(inner * 1.01)}" fill="#C8401F"/>`);
    parts.push(baseCheese(id, r, inner * (recipe.sauce ? 0.92 : 0.97), recipe.golden));
  }
  for (const [name, n, minD, s] of recipe.layers) {
    if (!n) continue;
    const pts = scatter(r, n, inner * 0.82, minD);
    for (const [x, y] of pts) parts.push(T[name](id, r, x, y, s * (R / 400)));
  }
  if (recipe.cinnamon) {
    parts.push(Array.from({ length: 220 }, () => {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * inner * 0.9;
      return `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(1.5 + r() * 2.5)}" fill="#8B4A1E" opacity="0.7"/>`;
    }).join(''));
  }
  // cortes das fatias
  const cuts = Array.from({ length: 4 }, (_, i) => {
    const a = (i * Math.PI) / 4 + 0.2;
    return `<line x1="${f(Math.cos(a) * R * 0.98)}" y1="${f(Math.sin(a) * R * 0.98)}" x2="${f(-Math.cos(a) * R * 0.98)}" y2="${f(-Math.sin(a) * R * 0.98)}" stroke="#5B2A0E" stroke-width="5" opacity="0.32"/>`;
  }).join('');
  parts.push(`<g filter="url(#${id}-soft)">${cuts}</g>`);
  parts.push(`<circle r="${R}" fill="url(#${id}-light)"/>`);
  parts.push(`<circle r="${f(R * (opts.board === false ? 1 : 1.07))}" fill="#000" filter="url(#${id}-photo)"/>`);
  return opts.board === false ? `<g>${parts.join('')}</g>` : `<g filter="url(#${id}-bigshadow)">${parts.join('')}</g>`;
}

/** Pizza retangular (meio metro / metro) com até 4 sabores lado a lado, centrada em (0,0). */
export function longPizzaSVG(id, flavors, W = 1500, H = 520, seed = 3) {
  const r = rng(seed);
  const pad = 46;
  const parts = [];
  parts.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="70" fill="#D9984A"/>`);
  parts.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="70" fill="#000" filter="url(#${id}-char)" opacity="0.5"/>`);
  parts.push(`<rect x="${-W / 2 + pad * 0.4}" y="${-H / 2 + pad * 0.4}" width="${W - pad * 0.8}" height="${H - pad * 0.8}" rx="56" fill="#E8B86A"/>`);
  const iw = W - pad * 2, ih = H - pad * 2;
  parts.push(`<rect x="${-iw / 2}" y="${-ih / 2}" width="${iw}" height="${ih}" rx="40" fill="#C8401F"/>`);
  parts.push(`<g filter="url(#${id}-cheese)"><rect x="${-iw / 2 + 8}" y="${-ih / 2 + 8}" width="${iw - 16}" height="${ih - 16}" rx="36" fill="url(#${id}-cheesefill)"/>${Array.from({ length: 50 }, () => `<circle cx="${f((r() - 0.5) * iw)}" cy="${f((r() - 0.5) * ih)}" r="${f(14 + r() * 24)}" fill="url(#${id}-brown)" opacity="0.55"/>`).join('')}</g>`);
  const n = flavors.length;
  const sw = iw / n;
  flavors.forEach((fl, i) => {
    const x0 = -iw / 2 + i * sw;
    const recipe = RECIPES[fl];
    for (const [name, cnt, minD, s] of recipe.layers) {
      if (!cnt) continue;
      const k = Math.max(3, Math.round((cnt * sw * ih * 1.6) / (Math.PI * 330 * 330)));
      const pts = [];
      let tries = 0;
      while (pts.length < k && tries < 4000) {
        tries++;
        const p = [x0 + 30 + r() * (sw - 60), -ih / 2 + 30 + r() * (ih - 60)];
        if (!minD || pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > minD * 0.8)) pts.push(p);
      }
      for (const [x, y] of pts) parts.push(T[name](id, r, x, y, s));
    }
    if (i > 0) parts.push(`<line x1="${f(x0)}" y1="${f(-H / 2 + 10)}" x2="${f(x0)}" y2="${f(H / 2 - 10)}" stroke="#5B2A0E" stroke-width="5" opacity="0.3" filter="url(#${id}-soft)"/>`);
  });
  for (let k = 1; k < 6; k++) {
    const x = -W / 2 + (W * k) / 6;
    parts.push(`<line x1="${f(x)}" y1="${-H / 2 + 8}" x2="${f(x)}" y2="${H / 2 - 8}" stroke="#5B2A0E" stroke-width="3" opacity="0.18" filter="url(#${id}-soft)"/>`);
  }
  parts.push(`<line x1="${-W / 2 + 8}" y1="0" x2="${W / 2 - 8}" y2="0" stroke="#5B2A0E" stroke-width="3" opacity="0.18" filter="url(#${id}-soft)"/>`);
  parts.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="70" fill="url(#${id}-light)"/>`);
  return `<g filter="url(#${id}-bigshadow)">${parts.join('')}</g>`;
}

/* ---------- Cenários ---------- */
export function woodBG(id, w, h, tone = 'dark') {
  const base = tone === 'dark' ? '#2B1A10' : '#7A4E2A';
  return `<rect width="${w}" height="${h}" fill="${base}"/><rect width="${w}" height="${h}" fill="#000" filter="url(#${id}-wood)" opacity="${tone === 'dark' ? 0.7 : 0.55}"/>
    ${Array.from({ length: Math.ceil(h / 180) }, (_, i) => `<line x1="0" y1="${i * 180}" x2="${w}" y2="${i * 180}" stroke="#120A05" stroke-width="3" opacity="0.5"/>`).join('')}
    <rect width="${w}" height="${h}" fill="url(#${id}-vignette)"/>`;
}

export function flour(id, w, h, seed = 5, n = 160) {
  const r = rng(seed);
  return `<g opacity="0.55">${Array.from({ length: n }, () => `<circle cx="${f(r() * w)}" cy="${f(r() * h)}" r="${f(0.8 + r() * 2.2)}" fill="#F7F1E6"/>`).join('')}</g>`;
}

export function garnish(id, items, seed = 9) {
  const r = rng(seed);
  return items.map(([kind, x, y, s]) => T[kind](id, r, x, y, s)).join('');
}

export function svgDoc(id, w, h, body, extraDefs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs(id)}
  <defs><radialGradient id="${id}-vignette" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.65"/></radialGradient>${extraDefs}</defs>
  ${body}</svg>`;
}

/* ---------- Bebidas ---------- */
export function bottleSVG(id, kind, x, y, s = 1) {
  const liquid = kind === 'guarana' ? '#3B1E0E' : kind === 'laranja' ? '#F39C12' : kind === 'agua' ? '#D6EEF8' : '#1A0C07';
  const label = kind === 'guarana' ? ['#1E8E3E', '#F4D03F', 'GUARANÁ'] : kind === 'agua' ? ['#2E86C1', '#fff', 'ÁGUA'] : ['#B3261E', '#fff', 'COLA'];
  const cap = kind === 'guarana' ? '#1E8E3E' : kind === 'agua' ? '#2E86C1' : '#B3261E';
  const W = 150 * s, H = 520 * s;
  return `<g transform="translate(${x} ${y})" filter="url(#${id}-bigshadow)">
    <rect x="${-W * 0.16}" y="${-H / 2 - 18 * s}" width="${W * 0.32}" height="${34 * s}" rx="${6 * s}" fill="${cap}"/>
    <path d="M${-W * 0.14} ${-H / 2 + 14 * s} L${-W * 0.14} ${-H * 0.3} C${-W * 0.5} ${-H * 0.2} ${-W * 0.5} ${-H * 0.14} ${-W * 0.5} ${-H * 0.05} L${-W * 0.5} ${H * 0.44} Q${-W * 0.5} ${H / 2} ${-W * 0.4} ${H / 2} L${W * 0.4} ${H / 2} Q${W * 0.5} ${H / 2} ${W * 0.5} ${H * 0.44} L${W * 0.5} ${-H * 0.05} C${W * 0.5} ${-H * 0.14} ${W * 0.5} ${-H * 0.2} ${W * 0.14} ${-H * 0.3} L${W * 0.14} ${-H / 2 + 14 * s} Z" fill="${liquid}" opacity="0.96"/>
    <rect x="${-W * 0.5}" y="${-H * 0.02}" width="${W}" height="${H * 0.26}" fill="${label[0]}"/>
    <text x="0" y="${H * 0.1}" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="${30 * s}" fill="${label[1]}">${label[2]}</text>
    <text x="0" y="${H * 0.18}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${22 * s}" fill="${label[1]}" opacity="0.9">2 LITROS</text>
    <rect x="${-W * 0.38}" y="${-H * 0.28}" width="${W * 0.1}" height="${H * 0.7}" rx="${W * 0.05}" fill="#fff" opacity="0.2"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${f(-W * 0.3 + ((i * 37) % 90) * s)}" cy="${f(H * 0.3 + ((i * 53) % 120) * s)}" r="${f(2 + (i % 3))}" fill="#fff" opacity="0.25"/>`).join('')}
  </g>`;
}

export function juiceSVG(id, x, y, s = 1) {
  const W = 190 * s, H = 300 * s;
  return `<g transform="translate(${x} ${y})" filter="url(#${id}-bigshadow)">
    <path d="M${-W / 2} ${-H / 2} L${W / 2} ${-H / 2} L${W * 0.4} ${H / 2} L${-W * 0.4} ${H / 2} Z" fill="#FFFFFF" opacity="0.35"/>
    <path d="M${-W * 0.47} ${-H * 0.36} L${W * 0.47} ${-H * 0.36} L${W * 0.4} ${H / 2 - 6 * s} L${-W * 0.4} ${H / 2 - 6 * s} Z" fill="#F5A623"/>
    <ellipse cx="0" cy="${-H * 0.36}" rx="${W * 0.47}" ry="${14 * s}" fill="#FFC857"/>
    <rect x="${-W * 0.36}" y="${-H * 0.3}" width="${W * 0.08}" height="${H * 0.7}" rx="${4 * s}" fill="#fff" opacity="0.35"/>
    <g transform="translate(${W * 0.42} ${-H * 0.42})"><circle r="${62 * s}" fill="#F39C12"/><circle r="${54 * s}" fill="#FFD27A"/>
      ${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="0" x2="${f(Math.cos((i * Math.PI) / 5) * 50 * s)}" y2="${f(Math.sin((i * Math.PI) / 5) * 50 * s)}" stroke="#F5B041" stroke-width="${3 * s}"/>`).join('')}</g>
    <rect x="${W * 0.1}" y="${-H * 0.85}" width="${12 * s}" height="${H * 0.7}" rx="${6 * s}" fill="#E74C3C" transform="rotate(12 ${W * 0.1} ${-H * 0.5})"/>
  </g>`;
}

/* ---------- Logo ---------- */
export function flame(x, y, s = 1, c1 = '#F2B705', c2 = '#E4572E') {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 -60 C 22 -30 38 -12 38 12 C 38 38 20 56 0 56 C -20 56 -38 38 -38 12 C -38 -6 -26 -18 -18 -26 C -16 -10 -8 -2 0 0 C -6 -22 -4 -42 0 -60Z" fill="${c2}"/>
    <path d="M2 -12 C 14 4 22 14 22 28 C 22 44 12 52 0 52 C -12 52 -22 44 -22 30 C -22 18 -14 10 -8 6 C -6 16 0 20 4 20 C 0 8 -2 -2 2 -12Z" fill="${c1}"/>
  </g>`;
}

export function logoSVG(size = 1024, name = 'Fornalha', fontSize = 210) {
  // Pensado para aparecer pequeno (avatar da loja): chama grande e nome legível.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <radialGradient id="lg" cx="50%" cy="35%" r="75%"><stop offset="0%" stop-color="#2A2420"/><stop offset="100%" stop-color="#14110F"/></radialGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#lg)"/>
    <rect x="40" y="40" width="944" height="944" rx="80" fill="none" stroke="#F2B705" stroke-width="12" opacity="0.9"/>
    ${flame(512, 330, 3.4)}
    <text x="512" y="720" text-anchor="middle" font-family="Bitstream Charter, Caladea, serif" font-weight="700" font-size="${fontSize}" fill="#FFF4E0">${name}</text>
    <rect x="262" y="774" width="500" height="92" rx="46" fill="#B3261E"/>
    <text x="512" y="838" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="60" letter-spacing="14" fill="#FFF4E0">PIZZARIA</text>
  </svg>`;
}


/* ---------- Estilo "foto de estúdio" (fundo claro, pá de metal, perspectiva) ---------- */

/** Fundo branco-acinzentado de estúdio, com a mesa um pouco mais clara. */
export function studioBG(id, w, h) {
  return `<defs>
      <linearGradient id="${id}-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9EDF3"/><stop offset="1" stop-color="#DDE3EB"/></linearGradient>
      <linearGradient id="${id}-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4F6F9"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
      <radialGradient id="${id}-spot" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#${id}-wall)"/>
    <path d="M0 ${h * 0.3} L${w} ${h * 0.27} L${w} ${h} L0 ${h} Z" fill="url(#${id}-table)"/>
    <rect width="${w}" height="${h}" fill="url(#${id}-spot)"/>`;
}

/** Pizza redonda em cima da pá de metal, vista de lado (como foto de cardápio). */
export function studioPizza(id, flavor, seed, w = 1000, h = 1000) {
  const cx = w * 0.47, cy = h * 0.53, R = w * 0.4, k = 0.74;
  return `${studioBG(id, w, h)}
    <defs>
      <linearGradient id="${id}-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F4F7"/><stop offset=".45" stop-color="#B9C0C9"/><stop offset=".7" stop-color="#E6E9ED"/><stop offset="1" stop-color="#9AA3AE"/></linearGradient>
      <linearGradient id="${id}-handle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEF1F4"/><stop offset=".5" stop-color="#A9B1BB"/><stop offset="1" stop-color="#7D8691"/></linearGradient>
      <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E2A25A"/><stop offset=".6" stop-color="#C47F3A"/><stop offset="1" stop-color="#9A5C26"/></linearGradient>
    </defs>
    <ellipse cx="${cx}" cy="${cy + R * k * 0.28}" rx="${R * 1.12}" ry="${R * k * 0.95}" fill="#5C6670" opacity="0.28" filter="url(#${id}-blur20)"/>
    <g transform="rotate(-12 ${cx + R} ${cy - R * 0.2})">
      <rect x="${cx + R * 0.85}" y="${cy - R * 0.32}" width="${w}" height="${R * 0.16}" rx="${R * 0.08}" fill="url(#${id}-handle)"/>
    </g>
    <ellipse cx="${cx}" cy="${cy + 10}" rx="${R * 1.06}" ry="${R * k * 1.06}" fill="url(#${id}-steel)"/>
    <ellipse cx="${cx}" cy="${cy + R * 0.09}" rx="${R}" ry="${R * k}" fill="url(#${id}-side)"/>
    <ellipse cx="${cx}" cy="${cy + R * 0.09}" rx="${R}" ry="${R * k}" fill="#000" filter="url(#${id}-char)" opacity="0.45"/>
    <g transform="translate(${cx} ${cy}) scale(1 ${k})">${pizzaSVG(id, flavor, R, seed, { board: false })}</g>`;
}

/** Garrafa PET genérica (sem marca), centrada em (x, y). */
export function petBottle(id, { liquid, liquidDark, cap, label, labelDark, text, sub, textColor = '#fff', size = '2L', clear = false }, x, y, s = 1) {
  const W = 230 * s, H = 760 * s, k = `${id}${text.replace(/\W/g, '')}`;
  const body = `M${-W * 0.13} ${-H / 2 + 40 * s} L${-W * 0.13} ${-H * 0.34} C${-W * 0.52} ${-H * 0.24} ${-W * 0.5} ${-H * 0.18} ${-W * 0.5} ${-H * 0.08}
    L${-W * 0.5} ${H * 0.36} C${-W * 0.5} ${H * 0.42} ${-W * 0.46} ${H * 0.44} ${-W * 0.42} ${H * 0.46} L${-W * 0.36} ${H / 2} L${-W * 0.12} ${H * 0.47} L0 ${H / 2} L${W * 0.12} ${H * 0.47} L${W * 0.36} ${H / 2} L${W * 0.42} ${H * 0.46}
    C${W * 0.46} ${H * 0.44} ${W * 0.5} ${H * 0.42} ${W * 0.5} ${H * 0.36} L${W * 0.5} ${-H * 0.08} C${W * 0.5} ${-H * 0.18} ${W * 0.52} ${-H * 0.24} ${W * 0.13} ${-H * 0.34} L${W * 0.13} ${-H / 2 + 40 * s} Z`;
  const drops = Array.from({ length: 70 }, (_, i) => {
    const a = (i * 97) % 100 / 100, b = (i * 61) % 100 / 100;
    const px = (-0.46 + a * 0.92) * W, py = (-0.28 + b * 0.74) * H, r0 = (2 + (i % 4) * 1.6) * s;
    return `<g opacity="${0.35 + (i % 3) * 0.15}"><circle cx="${f(px)}" cy="${f(py)}" r="${f(r0)}" fill="#fff" opacity="0.35"/><circle cx="${f(px - r0 * 0.3)}" cy="${f(py - r0 * 0.3)}" r="${f(r0 * 0.35)}" fill="#fff"/></g>`;
  }).join('');
  return `<g transform="translate(${x} ${y})">
    <defs>
      <linearGradient id="${k}-liq" x1="0" x2="1"><stop offset="0" stop-color="${liquidDark}"/><stop offset=".35" stop-color="${liquid}"/><stop offset=".65" stop-color="${liquid}"/><stop offset="1" stop-color="${liquidDark}"/></linearGradient>
      <linearGradient id="${k}-lab" x1="0" x2="1"><stop offset="0" stop-color="${labelDark}"/><stop offset=".3" stop-color="${label}"/><stop offset=".7" stop-color="${label}"/><stop offset="1" stop-color="${labelDark}"/></linearGradient>
      <linearGradient id="${k}-gloss" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".22" stop-color="#fff" stop-opacity=".55"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity="0"/><stop offset=".86" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="${k}-clip"><path d="${body}"/></clipPath>
    </defs>
    <ellipse cx="0" cy="${H / 2 + 6 * s}" rx="${W * 0.6}" ry="${16 * s}" fill="#000" opacity="0.22" filter="url(#${id}-blur8)"/>
    <rect x="${-W * 0.17}" y="${-H / 2 - 4 * s}" width="${W * 0.34}" height="${48 * s}" rx="${8 * s}" fill="${cap}"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${f(-W * 0.15 + i * W * 0.05)}" y="${-H / 2}" width="${f(W * 0.02)}" height="${40 * s}" fill="#000" opacity=".15"/>`).join('')}
    <rect x="${-W * 0.19}" y="${-H / 2 + 42 * s}" width="${W * 0.38}" height="${10 * s}" rx="${4 * s}" fill="${cap}" opacity=".8"/>
    <g clip-path="url(#${k}-clip)">
      <rect x="${-W}" y="${-H}" width="${W * 2}" height="${H * 2}" fill="${clear ? '#E9F4F8' : `url(#${k}-liq)`}" opacity="${clear ? 0.65 : 0.97}"/>
      ${clear ? '' : `<rect x="${-W}" y="${-H}" width="${W * 2}" height="${H * 0.62}" fill="#fff" opacity="0.18"/>`}
      ${Array.from({ length: 5 }, (_, i) => `<path d="M${-W * 0.5} ${f(-H * 0.2 + i * H * 0.08)} Q0 ${f(-H * 0.17 + i * H * 0.08)} ${W * 0.5} ${f(-H * 0.2 + i * H * 0.08)}" stroke="#000" stroke-opacity=".12" stroke-width="${3 * s}" fill="none"/>`).join('')}
      ${Array.from({ length: 4 }, (_, i) => `<path d="M${-W * 0.5} ${f(H * 0.28 + i * H * 0.04)} Q0 ${f(H * 0.31 + i * H * 0.04)} ${W * 0.5} ${f(H * 0.28 + i * H * 0.04)}" stroke="#000" stroke-opacity=".12" stroke-width="${3 * s}" fill="none"/>`).join('')}
      <rect x="${-W}" y="${-H * 0.02}" width="${W * 2}" height="${H * 0.26}" fill="url(#${k}-lab)"/>
      <rect x="${-W}" y="${-H * 0.02}" width="${W * 2}" height="${6 * s}" fill="#fff" opacity=".35"/>
      <rect x="${-W}" y="${H * 0.24 - 6 * s}" width="${W * 2}" height="${6 * s}" fill="#000" opacity=".2"/>
      <text x="0" y="${H * 0.085}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${15 * s}" letter-spacing="${3 * s}" fill="${textColor}" opacity=".85">${sub}</text>
      <text x="0" y="${H * 0.165}" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="${(text.length > 5 ? 36 : 46) * s}" fill="${textColor}">${text}</text>
      <text x="0" y="${H * 0.215}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="${17 * s}" fill="${textColor}" opacity=".9">${size}</text>
      ${drops}
      <rect x="${-W / 2}" y="${-H}" width="${W}" height="${H * 2}" fill="url(#${k}-gloss)"/>
    </g>
  </g>`;
}

/** Card de bebida: faixa colorida com o nome na vertical, tamanho embaixo e a garrafa no fundo branco. */
export function drinkCard(id, { band, bandDark, name, size, bottle }) {
  const W = 1000, H = 1000, bw = 230;
  const lines = name.split('\n');
  const fs = lines.length > 1 ? 74 : 92;
  return svgDoc(id, W, H, `<rect width="${W}" height="${H}" fill="#fff"/>
    <radialGradient id="${id}-wb" cx="62%" cy="50%" r="60%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#F1F3F5"/></radialGradient>
    <rect x="${bw}" width="${W - bw}" height="${H}" fill="url(#${id}-wb)"/>
    <rect width="${bw}" height="${H * 0.76}" fill="${band}"/>
    <rect y="${H * 0.76 + 14}" width="${bw}" height="${H * 0.24 - 14}" fill="${bandDark}"/>
    <g transform="translate(${bw / 2 + (lines.length > 1 ? fs * 0.45 : fs * 0.36)} ${H * 0.38}) rotate(-90)">
      ${lines.map((l, i) => `<text x="0" y="${i * fs * 1.02 - (lines.length - 1) * fs * 0.51}" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="${fs}" fill="#fff" transform="scale(0.82 1)" letter-spacing="1">${l}</text>`).join('')}
    </g>
    <text x="${bw / 2}" y="${H * 0.905}" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="${size.length > 4 ? 62 : size.length > 3 ? 78 : 96}" fill="#fff">${size}</text>
    ${bottle(id, 615, 505)}`);
}

/** Banner largo "vantagens de pedir pelo site" (fundo vermelho texturizado). */
export function perksBanner(id, perks, W = 2000, H = 430) {
  const icon = {
    cupom: `<path d="M-22 -14h44v8a6 6 0 0 0 0 12v8h-44v-8a6 6 0 0 0 0-12z" fill="none" stroke="#FFF4E0" stroke-width="4"/><text x="0" y="7" text-anchor="middle" font-family="Inter" font-weight="900" font-size="18" fill="#FFF4E0">%</text>`,
    combo: `<rect x="-20" y="-6" width="18" height="24" rx="3" fill="none" stroke="#FFF4E0" stroke-width="4"/><path d="M-16 -6l2-10h8l2 10" fill="none" stroke="#FFF4E0" stroke-width="4"/><path d="M4 18 L14 -16 L24 18Z" fill="none" stroke="#FFF4E0" stroke-width="4" stroke-linejoin="round"/>`,
    pix: `<path d="M0 -20 L20 0 L0 20 L-20 0Z" fill="none" stroke="#FFF4E0" stroke-width="4" stroke-linejoin="round"/><path d="M-9 0 L0 -9 L9 0 L0 9Z" fill="#FFF4E0"/>`,
    whats: `<path d="M-18 -16h36a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-18l-12 9v-9h-6a4 4 0 0 1-4-4v-20a4 4 0 0 1 4-4z" fill="none" stroke="#FFF4E0" stroke-width="4" stroke-linejoin="round"/>`,
    moto: `<circle cx="-14" cy="12" r="8" fill="none" stroke="#FFF4E0" stroke-width="4"/><circle cx="16" cy="12" r="8" fill="none" stroke="#FFF4E0" stroke-width="4"/><path d="M-14 12h10l8-14h8l4 14M-2 -2h8M8 -12h6" fill="none" stroke="#FFF4E0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  const r = rng(77);
  const speck = Array.from({ length: 900 }, () => `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(0.6 + r() * 1.8)}" fill="${r() > 0.5 ? '#fff' : '#7A140F'}" opacity="${f(0.08 + r() * 0.18)}"/>`).join('');
  const tall = H / W > 0.35;
  if (tall) {
    // Versão do carrossel da loja: a loja escreve o título e o subtítulo embaixo à esquerda,
    // então a arte deixa esse canto livre (pizza à direita e selos no alto).
    return svgDoc(id, W, H, `<rect width="${W}" height="${H}" fill="#E5403A"/>
      <rect width="${W}" height="${H}" fill="#000" filter="url(#${id}-grain)" opacity="0.25"/>${speck}
      <g transform="translate(${W - H * 0.42} ${H * 0.56})">${pizzaSVG(id, 'calabresa', H * 0.6, 88, { board: false })}</g>
      <g transform="translate(60 70)">
        <rect width="330" height="56" rx="28" fill="#FFF4E0"/>
        <text x="165" y="38" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="28" fill="#C0302A" letter-spacing="2">SÓ PELO SITE</text>
      </g>`);
  }
  const cx = tall ? W * 0.66 : W * 0.5;
  const titleY = tall ? 40 : 0;
  const perkRow = ([ic, txt], i) => `<g transform="translate(0 ${i * 62})"><g transform="translate(22 0)">${icon[ic]}</g>
        <g transform="translate(62 0) scale(0.8 1)"><text y="14" font-family="Inter Display, Inter" font-weight="900" font-size="40" fill="#FFF4E0">${txt}</text></g></g>`;
  return svgDoc(id, W, H, `<rect width="${W}" height="${H}" fill="#E5403A"/>
    <rect width="${W}" height="${H}" fill="#000" filter="url(#${id}-grain)" opacity="0.25"/>${speck}
    <g transform="translate(${tall ? H * 0.32 : H * 0.5} ${H * 0.5})">${pizzaSVG(id, 'calabresa', tall ? H * 0.56 : H * 0.62, 88, { board: false })}</g>
    <g transform="translate(${cx} ${titleY})">
      <rect x="-290" y="80" width="580" height="54" fill="#FFF4E0"/>
      <g transform="scale(0.82 1)"><text x="0" y="119" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="36" fill="#C0302A">PEDINDO PELO NOSSO SITE VOCÊ TEM</text></g>
      <g transform="scale(0.78 1)">
        <text x="0" y="246" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="132" fill="none" stroke="#FFF4E0" stroke-width="4" letter-spacing="2">VANTAGENS</text>
        <text x="0" y="372" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="132" fill="#FFF4E0" letter-spacing="2">EXCLUSIVAS</text>
      </g>
    </g>
    ${tall
      ? `<g transform="translate(${cx - 300} 500)">${perks.slice(0, 3).map(perkRow).join('')}</g>`
      : `<g transform="translate(${W * 0.69} ${H * 0.5 - (perks.length - 1) * 31})">${perks.map(perkRow).join('')}</g>`}`);
}
