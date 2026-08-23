/**
 * Generates the raster brand assets from the source SVGs in public/.
 *
 * Run with:  npm run gen:assets
 * The generated PNG/ICO files are committed so no build step depends on sharp.
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const RING = `<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#f59e0b"/><stop offset="52%" stop-color="#e11d48"/><stop offset="100%" stop-color="#4f46e5"/>
</linearGradient>`;
const SPADE_FILL = `<linearGradient id="sp" x1="0.5" y1="0" x2="0.5" y2="1">
  <stop offset="0%" stop-color="#fde68a"/><stop offset="100%" stop-color="#f59e0b"/>
</linearGradient>`;
const SPADE_D =
  'M32 11.5c0 0-19.5 15.6-19.5 26.1 0 6.7 4.8 10.7 9.7 10.7 3.7 0 6.6-1.9 8.1-4.3-.4 5.3-2.3 9.2-5.2 12h13.8c-2.9-2.8-4.8-6.7-5.2-12 1.5 2.4 4.4 4.3 8.1 4.3 4.9 0 9.7-4 9.7-10.7C51.5 27.1 32 11.5 32 11.5z';

/** Square app icon. `bleed` fills the whole tile (needed for maskable/apple). */
const icon = (bleed = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>${RING}${SPADE_FILL}</defs>
  <rect width="64" height="64" rx="${bleed ? 0 : 15}" fill="url(#ring)"/>
  <rect x="${bleed ? 5 : 3.5}" y="${bleed ? 5 : 3.5}" width="${bleed ? 54 : 57}" height="${bleed ? 54 : 57}" rx="${bleed ? 11 : 12}" fill="#020617"/>
  <path fill="url(#sp)" d="${SPADE_D}"/>
</svg>`;

/** 1200x630 social preview card. */
const og = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>${RING}${SPADE_FILL}
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#020617"/><stop offset="55%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1010" cy="120" r="230" fill="#4f46e5" opacity="0.14"/>
  <circle cx="150" cy="560" r="190" fill="#e11d48" opacity="0.12"/>

  <g transform="translate(96,150)">
    <rect width="150" height="150" rx="34" fill="url(#ring)"/>
    <rect x="8" y="8" width="134" height="134" rx="28" fill="#020617"/>
    <path transform="translate(19,19) scale(1.75)" fill="url(#sp)" d="${SPADE_D}"/>
  </g>

  <text x="286" y="222" fill="#ffffff" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="86" font-weight="800" letter-spacing="2">BHABHI</text>
  <rect x="286" y="248" width="156" height="38" rx="8" fill="#78350f" stroke="#b45309" stroke-width="2"/>
  <text x="306" y="275" fill="#fbbf24" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="3">ONLINE</text>
  <text x="286" y="344" fill="#e2e8f0" font-family="Arial, Helvetica, sans-serif" font-size="34">Real-time multiplayer Thulla &amp; Getaway</text>
  <text x="286" y="392" fill="#94a3b8" font-family="Arial, Helvetica, sans-serif" font-size="25">Play free with friends — voice chat, 3–8 players</text>

  <g font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#cbd5e1">
    <rect x="96"  y="470" width="312" height="62" rx="12" fill="#0b1220" stroke="#334155" stroke-width="2"/>
    <text x="124" y="509"><tspan fill="#fbbf24">&#9824;</tspan>  Server-authoritative</text>
    <rect x="432" y="470" width="204" height="62" rx="12" fill="#0b1220" stroke="#334155" stroke-width="2"/>
    <text x="460" y="509"><tspan fill="#34d399">&#9679;</tspan>  Voice chat</text>
    <rect x="660" y="470" width="204" height="62" rx="12" fill="#0b1220" stroke="#334155" stroke-width="2"/>
    <text x="688" y="509"><tspan fill="#60a5fa">&#9679;</tspan>  Free to play</text>
  </g>
</svg>`;

const png = (svg, size, out, h) =>
  sharp(Buffer.from(svg)).resize(size, h ?? size).png({ compressionLevel: 9 }).toFile(join(pub, out));

const run = async () => {
  const std = icon(false);
  const bleed = icon(true);

  await Promise.all([
    png(std, 16, 'favicon-16x16.png'),
    png(std, 32, 'favicon-32x32.png'),
    png(std, 48, 'favicon-48x48.png'),
    png(bleed, 180, 'apple-touch-icon.png'),
    png(bleed, 192, 'icon-192.png'),
    png(bleed, 512, 'icon-512.png'),
    sharp(Buffer.from(og())).resize(1200, 630).png({ compressionLevel: 9 }).toFile(join(pub, 'og-image.png')),
  ]);

  const ico = await pngToIco([
    join(pub, 'favicon-16x16.png'),
    join(pub, 'favicon-32x32.png'),
    join(pub, 'favicon-48x48.png'),
  ]);
  writeFileSync(join(pub, 'favicon.ico'), ico);

  console.log('generated brand assets:');
  for (const f of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png',
                   'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png']) {
    console.log(`  ${f.padEnd(24)} ${readFileSync(join(pub, f)).length.toLocaleString()} bytes`);
  }
};

run().catch(e => { console.error(e); process.exit(1); });
