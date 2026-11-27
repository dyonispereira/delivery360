/* eslint-disable */
// Gera as imagens da loja modelo em apps/web/public/vitrine/fornalha/.
// Uso (na raiz do repositório): node apps/web/scripts/vitrine/render.mjs [filtro]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pizzaSVG, longPizzaSVG, woodBG, flour, garnish, svgDoc, bottleSVG, juiceSVG, logoSVG, flame, BRAND } from './art.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../public/vitrine/fornalha');
mkdirSync(OUT, { recursive: true });

/* ---------- Produtos (quadrados 1000x1000) ---------- */
const sideGarnish = [
  ['basil', 70, 90, 1.1], ['basil', 930, 900, 1.2], ['cherry', 900, 110, 1.3], ['cherry', 950, 190, 1.1], ['basil', 120, 930, 0.9],
];
function productPizza(flavor, seed) {
  const id = 'p';
  return svgDoc(id, 1000, 1000, `${woodBG(id, 1000, 1000)}${flour(id, 1000, 1000, seed)}
    <g transform="translate(500 505)">${pizzaSVG(id, flavor, 420, seed)}</g>
    ${garnish(id, sideGarnish, seed)}`);
}

function productLong(flavors, label, seed) {
  const id = 'l';
  return svgDoc(id, 1000, 1000, `${woodBG(id, 1000, 1000)}${flour(id, 1000, 1000, seed)}
    <g transform="translate(500 500) rotate(-12) scale(0.62)">${longPizzaSVG(id, flavors, 1500, 560, seed)}</g>
    ${garnish(id, [['basil', 90, 120, 1.2], ['cherry', 880, 860, 1.4], ['basil', 900, 930, 1]], seed)}
    ${label ? `<g transform="translate(500 930)"><rect x="-150" y="-36" width="300" height="60" rx="30" fill="#1D1A17" opacity="0.85"/><text y="6" text-anchor="middle" font-family="Inter" font-weight="800" font-size="30" fill="#FFF4E0" letter-spacing="3">${label}</text></g>` : ''}`);
}

/** Arte de promoção: produto + selo de preço (como as lojas fazem no Instagram). */
function promoArt(inner, { tag, title, price, old }) {
  // Os cantos superior esquerdo (selo de desconto) e inferior direito (botão +) ficam livres para a loja.
  const id = 'q';
  const [int, cents] = price.split(',');
  const big = int.length > 2;
  return svgDoc(id, 1000, 1000, `${woodBG(id, 1000, 1000)}
    ${inner}
    <g transform="translate(960 40)">
      <rect x="-330" width="330" height="74" rx="14" fill="${BRAND.gold}"/>
      <text x="-165" y="50" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="38" fill="#1D1A17" letter-spacing="1">${tag}</text>
      <text y="190" text-anchor="end" font-family="Inter Display, Inter" font-weight="900" font-size="80" fill="#fff" stroke="#1D1A17" stroke-width="10" paint-order="stroke">${title[0]}</text>
      <text y="274" text-anchor="end" font-family="Inter Display, Inter" font-weight="900" font-size="80" fill="${BRAND.gold}" stroke="#1D1A17" stroke-width="10" paint-order="stroke">${title[1] ?? ''}</text>
    </g>
    <g transform="translate(300 815) rotate(-6)">
      ${old ? `<rect x="-150" y="-178" width="300" height="56" rx="12" fill="#1D1A17" opacity="0.85"/><text y="-136" text-anchor="middle" font-family="Inter" font-weight="700" font-size="38" fill="#fff">de R$ ${old}</text><line x1="-118" y1="-149" x2="118" y2="-149" stroke="#fff" stroke-width="5"/>` : ''}
      <rect x="-250" y="-105" width="500" height="215" rx="28" fill="${BRAND.red}" stroke="#fff" stroke-width="8"/>
      <text y="-52" text-anchor="middle" font-family="Inter" font-weight="800" font-size="34" fill="#FFF4E0" letter-spacing="4">POR APENAS</text>
      <text x="-215" y="66" font-family="Inter Display, Inter" font-weight="900" font-size="42" fill="#FFF4E0">R$</text>
      <text x="${big ? 10 : 20}" y="80" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="${big ? 118 : 132}" fill="#fff">${int}</text>
      <text x="${big ? 132 : 112}" y="32" font-family="Inter Display, Inter" font-weight="900" font-size="58" fill="#fff">,${cents}</text>
    </g>`);
}

function drinkArt(kind) {
  const id = 'd';
  const body = kind === 'laranja' ? juiceSVG(id, 500, 560, 1.6) : bottleSVG(id, kind, 500, 520, 1.45);
  return svgDoc(id, 1000, 1000, `<rect width="1000" height="1000" fill="#F4E9D8"/>
    <radialGradient id="dg" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#FFF8EC"/><stop offset="100%" stop-color="#E6D3B5"/></radialGradient>
    <rect width="1000" height="1000" fill="url(#dg)"/>
    <ellipse cx="500" cy="920" rx="300" ry="40" fill="#000" opacity="0.15" filter="url(#${id}-blur20)"/>
    ${body}
    ${kind !== 'agua' ? Array.from({ length: 7 }, (_, i) => `<rect x="${130 + (i % 4) * 230}" y="${790 + (i % 2) * 70}" width="54" height="54" rx="8" fill="#DFF3FA" opacity="0.7" transform="rotate(${i * 17} ${157 + (i % 4) * 230} ${817 + (i % 2) * 70})"/>`).join('') : ''}`);
}

function comboArt() {
  const id = 'c';
  return svgDoc(id, 1000, 1000, `${woodBG(id, 1000, 1000)}${flour(id, 1000, 1000, 4)}
    <g transform="translate(330 380)">${pizzaSVG(id, 'calabresa', 290, 41)}</g>
    <g transform="translate(560 640)">${pizzaSVG(id, 'frango', 290, 42)}</g>
    ${bottleSVG(id, 'cola', 860, 420, 1.05)}
    <g transform="translate(40 40)"><rect width="370" height="74" rx="14" fill="${BRAND.gold}"/><text x="185" y="50" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="36" fill="#1D1A17">COMBO FAMÍLIA</text></g>`);
}

/* ---------- Capa, banners e cardápio ---------- */
function cover() {
  const id = 'v';
  return svgDoc(id, 1800, 600, `${woodBG(id, 1800, 600)}${flour(id, 1800, 600, 8, 300)}
    <g transform="translate(1380 330)">${pizzaSVG(id, 'margherita', 360, 7)}</g>
    <g transform="translate(1010 520)">${pizzaSVG(id, 'pepperoni', 220, 8)}</g>
    ${garnish(id, [['basil', 760, 90, 1.3], ['cherry', 830, 140, 1.4], ['basil', 1720, 80, 1.1]], 3)}
    <rect width="1800" height="600" fill="url(#cv)"/>
    <linearGradient id="cv" x1="0" x2="1"><stop offset="0%" stop-color="#120B07" stop-opacity="0.92"/><stop offset="55%" stop-color="#120B07" stop-opacity="0.35"/><stop offset="100%" stop-color="#120B07" stop-opacity="0"/></linearGradient>
    ${flame(150, 300, 1.2)}
    <text x="240" y="250" font-family="Inter Display, Inter" font-weight="900" font-size="96" fill="#FFF4E0">A PIZZA QUE</text>
    <text x="240" y="352" font-family="Inter Display, Inter" font-weight="900" font-size="96" fill="${BRAND.gold}">O BAIRRO PEDE</text>
    <text x="244" y="420" font-family="Inter" font-weight="600" font-size="36" fill="#FFF4E0" opacity="0.85">Massa de fermentação natural • forno a lenha</text>`);
}

function tape(w, y, rot, text) {
  const step = text.length * 27 + 40;
  const items = Array.from({ length: Math.ceil((w + 400) / step) }, (_, i) => `<text x="${i * step}" y="44" font-family="Inter Display, Inter" font-weight="900" font-size="40" fill="#1D1A17">${text}</text>`).join('');
  return `<g transform="translate(-100 ${y}) rotate(${rot})"><rect width="${w + 400}" height="62" fill="${BRAND.gold}"/>
    <g>${items}</g></g>`;
}

function banner(kind) {
  const id = 'b';
  const W = 1600, H = 700;
  let art = '';
  if (kind === 'black') {
    art = `<rect width="${W}" height="${H}" fill="#0E0E0E"/>
      ${tape(W, 70, -6, 'BLACK FRIDAY ★')}${tape(W, 600, 5, 'OFERTAS DA SEMANA ★')}
      <g transform="translate(1110 390) rotate(-14) scale(0.52)">${longPizzaSVG(id, ['pepperoni', 'calabresa', 'frango'], 1500, 560, 12)}</g>
      <g transform="translate(1330 170) rotate(10)"><circle r="120" fill="${BRAND.red}" stroke="#fff" stroke-width="8"/>
        <text y="-20" text-anchor="middle" font-family="Inter" font-weight="800" font-size="30" fill="#fff">ATÉ</text>
        <text y="48" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="84" fill="#fff">40%</text>
        <text y="88" text-anchor="middle" font-family="Inter" font-weight="800" font-size="26" fill="#fff">OFF</text></g>`;
  } else if (kind === 'terca') {
    art = `${woodBG(id, W, H)}${flour(id, W, H, 2, 200)}
      <g transform="translate(1030 360)">${pizzaSVG(id, 'quatroqueijos', 260, 31)}</g>
      <g transform="translate(1330 380)">${pizzaSVG(id, 'portuguesa', 260, 32)}</g>
      <g transform="translate(1180 120) rotate(-6)"><rect x="-210" y="-58" width="420" height="116" rx="58" fill="${BRAND.gold}"/>
        <text y="22" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="64" fill="#1D1A17">TERÇA EM DOBRO</text></g>`;
  } else if (kind === 'frete') {
    art = `<rect width="${W}" height="${H}" fill="${BRAND.red}"/>
      <g opacity="0.12">${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 173) % W}" cy="${(i * 97) % H}" r="${30 + (i % 5) * 12}" fill="#fff"/>`).join('')}</g>
      <g transform="translate(1180 380)">${pizzaSVG(id, 'calabresa', 300, 51)}</g>
      <g transform="translate(1180 380)"><rect x="-330" y="-330" width="660" height="660" rx="30" fill="none" stroke="#FFF4E0" stroke-width="10" stroke-dasharray="40 26" opacity="0.6"/></g>`;
  } else if (kind === 'primeira') {
    art = `${woodBG(id, W, H)}
      <g transform="translate(1200 370)">${pizzaSVG(id, 'margherita', 320, 61)}</g>
      <g transform="translate(1420 150) rotate(12)"><rect x="-130" y="-60" width="260" height="120" rx="20" fill="#fff"/>
        <text y="-8" text-anchor="middle" font-family="Inter" font-weight="800" font-size="28" fill="${BRAND.red}">1º PEDIDO</text>
        <text y="44" text-anchor="middle" font-family="Inter Display, Inter" font-weight="900" font-size="56" fill="${BRAND.red}">10% OFF</text></g>`;
  }
  return svgDoc(id, W, H, art);
}

/** Cardápio para Instagram/impressão (1080x1350). */
function menuPoster(items) {
  const id = 'm';
  const rows = items.map(([name, desc, price], i) => {
    const y = 420 + i * 82;
    return `<text x="90" y="${y}" font-family="Inter Display, Inter" font-weight="800" font-size="38" fill="#FFF4E0">${name}</text>
      <text x="90" y="${y + 34}" font-family="Inter" font-size="24" fill="#E8D9C2" opacity="0.85">${desc}</text>
      <line x1="${120 + name.length * 21}" y1="${y - 10}" x2="840" y2="${y - 10}" stroke="#E8D9C2" stroke-width="2" stroke-dasharray="3 9" opacity="0.5"/>
      <text x="990" y="${y}" text-anchor="end" font-family="Inter Display, Inter" font-weight="900" font-size="38" fill="${BRAND.gold}">R$ ${price}</text>`;
  }).join('');
  return svgDoc(id, 1080, 1350, `${woodBG(id, 1080, 1350)}
    <rect x="40" y="40" width="1000" height="1270" rx="30" fill="#140D08" opacity="0.82"/>
    <rect x="58" y="58" width="964" height="1234" rx="24" fill="none" stroke="${BRAND.gold}" stroke-width="3" opacity="0.7"/>
    ${flame(540, 150, 1.05)}
    <text x="540" y="290" text-anchor="middle" font-family="Bitstream Charter, Caladea, serif" font-weight="700" font-size="104" fill="#FFF4E0">Fornalha</text>
    <text x="540" y="345" text-anchor="middle" font-family="Inter" font-weight="700" font-size="26" letter-spacing="5" fill="${BRAND.gold}">CARDÁPIO • PIZZAS GRANDES (8 FATIAS)</text>
    ${rows}
    <text x="540" y="1270" text-anchor="middle" font-family="Inter" font-weight="700" font-size="28" fill="#FFF4E0" opacity="0.9">Peça pelo site: borda recheada a partir de R$ 9 • entrega no bairro</text>`);
}

/* ---------- Lista ---------- */
const PIZZAS = {
  calabresa: 11, margherita: 12, mussarela: 13, frango: 14, portuguesa: 15, pepperoni: 16, quatroqueijos: 17, brocolis: 18, baiana: 19, bacon: 20, camarao: 21, chocolate: 22, banana: 23,
};
const jobs = [];
for (const [flavor, seed] of Object.entries(PIZZAS)) jobs.push([`pizza-${flavor}.webp`, 1000, 1000, () => productPizza(flavor, seed)]);
jobs.push(['meio-metro.webp', 1000, 1000, () => productLong(['calabresa', 'frango', 'margherita'], 'ATÉ 3 SABORES • 12 FATIAS', 5)]);
jobs.push(['pizza-metro.webp', 1000, 1000, () => productLong(['pepperoni', 'portuguesa', 'quatroqueijos', 'baiana'], '4 SABORES • 24 FATIAS', 6)]);
const promoPizza = (flavor, seed) => `<g transform="translate(560 520)">${pizzaSVG('q', flavor, 340, seed)}</g>`;
const promoLong = (fl, seed) => `<g transform="translate(540 540) rotate(-12) scale(0.56)">${longPizzaSVG('q', fl, 1500, 560, seed)}</g>`;
jobs.push(['promo-grande.webp', 1000, 1000, () => promoArt(promoPizza('pepperoni', 71), { tag: 'BLACK FRIDAY', title: ['PIZZA', 'GRANDE'], price: '75,90', old: '110,00' })]);
jobs.push(['promo-meio-metro.webp', 1000, 1000, () => promoArt(promoLong(['calabresa', 'frango', 'pepperoni'], 72), { tag: 'BLACK FRIDAY', title: ['MEIO', 'METRO'], price: '69,90', old: '118,00' })]);
jobs.push(['promo-metro.webp', 1000, 1000, () => promoArt(promoLong(['pepperoni', 'portuguesa', 'quatroqueijos', 'baiana'], 73), { tag: 'BLACK FRIDAY', title: ['PIZZA', 'METRO'], price: '129,90', old: '202,00' })]);
jobs.push(['combo-familia.webp', 1000, 1000, comboArt]);
for (const k of ['cola', 'guarana', 'agua', 'laranja']) jobs.push([`bebida-${k}.webp`, 1000, 1000, () => drinkArt(k)]);
jobs.push(['logo.png', 512, 512, () => logoSVG(512)]);
jobs.push(['capa.webp', 1800, 600, cover]);
for (const k of ['black', 'terca', 'frete', 'primeira']) jobs.push([`banner-${k}.webp`, 1600, 700, () => banner(k)]);
jobs.push(['cardapio-instagram.png', 1080, 1350, () => menuPoster([
  ['Calabresa', 'Calabresa artesanal, cebola roxa e azeitona', '59,90'],
  ['Margherita', 'Tomate, manjericão fresco e parmesão', '62,90'],
  ['Mussarela', 'Mussarela, orégano e azeitona', '54,90'],
  ['Frango com Catupiry', 'Frango desfiado e catupiry original', '66,90'],
  ['Portuguesa', 'Presunto, ovo, ervilha, cebola e azeitona', '66,90'],
  ['Pepperoni', 'Pepperoni fatiado fininho', '69,90'],
  ['Quatro Queijos', 'Mussarela, gorgonzola, catupiry e parmesão', '72,90'],
  ['Brócolis com Bacon', 'Brócolis, bacon crocante e tomate-cereja', '69,90'],
  ['Baiana', 'Calabresa, milho, pimenta e azeitona', '64,90'],
  ['Chocolate com Morango', 'Chocolate ao leite, morango e confeitos', '59,90'],
])]);

const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, w, h, make] of jobs) {
  if (only && !name.includes(only)) continue;
  const svg = make();
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${svg}</body></html>`);
  await page.waitForTimeout(50);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
  const file = join(OUT, name);
  if (name.endsWith('.webp')) {
    writeFileSync(file.replace(/\.webp$/, '.tmp.png'), png);
  } else writeFileSync(file, png);
  console.log('ok', name);
}
await browser.close();
