/**
 * The pictures of the sample media library (M35.9, decision 22): small coffee scenes drawn as inline SVG data URIs, so
 * the sample needs no image files and no network. These are images (content), not styles — their colours are part of
 * the picture, like the pixels of a photo.
 */

/** The aspect of a picture: its drawing size (the file's real pixel size is in the data). */
export type SampleArtAspect = 'landscape' | 'portrait' | 'square' | 'wide';

const SIZES: Readonly<Record<SampleArtAspect, readonly [number, number]>> = {
  landscape: [600, 400],
  portrait: [400, 500],
  square: [500, 500],
  wide: [640, 360],
};

export function svgDataUri(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function picture(aspect: SampleArtAspect, body: string): string {
  const [w, h] = SIZES[aspect];
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`);
}

/** A small deterministic random source, so every scene looks the same on every load. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function gradient(id: string, from: string, to: string, vertical = true): string {
  const end = vertical ? 'x2="0" y2="1"' : 'x2="1" y2="0"';
  return `<defs><linearGradient id="${id}" x1="0" y1="0" ${end}><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`;
}

function bean(x: number, y: number, r: number, rotate: number, color: string): string {
  const crease = `M${r1(-r * 0.78)} 0 C ${r1(-r * 0.3)} ${r1(r * 0.28)} ${r1(r * 0.3)} ${r1(-r * 0.28)} ${r1(r * 0.78)} 0`;
  return (
    `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${Math.round(rotate)})">` +
    `<ellipse rx="${r1(r)}" ry="${r1(r * 0.68)}" fill="${color}"/>` +
    `<ellipse cx="${r1(-r * 0.25)}" cy="${r1(-r * 0.3)}" rx="${r1(r * 0.45)}" ry="${r1(r * 0.18)}" fill="#ffffff" opacity="0.12"/>` +
    `<path d="${crease}" stroke="#1f0f06" stroke-width="${r1(r * 0.14)}" fill="none" stroke-linecap="round"/></g>`
  );
}

function scatter(aspect: SampleArtAspect, seed: number, count: number, size: number, colors: readonly string[]): string {
  const [w, h] = SIZES[aspect];
  const next = random(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(next() * colors.length)];
    out += bean(next() * w, next() * h, size * (0.8 + next() * 0.4), next() * 180, color);
  }
  return out;
}

/** Roasted beans filling the frame. */
export function beans(aspect: SampleArtAspect, seed: number, roast: 'light' | 'medium' | 'dark' = 'medium'): string {
  const [w, h] = SIZES[aspect];
  const tones = {
    light: ['#a0632f', '#b07038', '#8f5528'],
    medium: ['#6b3a1c', '#7a4421', '#5a2f16'],
    dark: ['#3a1e0f', '#2e170b', '#46240f'],
  }[roast];
  return picture(
    aspect,
    `${gradient('g', '#3b2416', '#1d110a')}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      scatter(aspect, seed, Math.round((w * h) / 2600), 30, tones) +
      scatter(aspect, seed + 7, Math.round((w * h) / 5200), 34, tones),
  );
}

/** A latte with a rosetta, from above, on a wooden table. */
export function latte(aspect: SampleArtAspect, wood = '#9a6b45'): string {
  const [w, h] = SIZES[aspect];
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.3;
  let planks = '';
  for (let x = 0; x < w; x += 70) {
    planks += `<rect x="${x}" width="2" height="${h}" fill="#000000" opacity="0.12"/>`;
  }
  let leaves = '';
  for (let i = 0; i < 6; i++) {
    const y = cy + r * 0.45 - i * r * 0.17;
    const rx = r * (0.42 - i * 0.05);
    leaves += `<ellipse cx="${r1(cx)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(r * 0.07)}" fill="#f4e6d2"/>`;
  }
  return picture(
    aspect,
    `<rect width="${w}" height="${h}" fill="${wood}"/>${planks}` +
      `<circle cx="${cx}" cy="${cy}" r="${r1(r * 1.45)}" fill="#efe9e1"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 1.38)}" fill="#e2dbd1"/>` +
      `<rect x="${r1(cx + r * 0.95)}" y="${r1(cy - r * 0.12)}" width="${r1(r * 0.55)}" height="${r1(r * 0.24)}" rx="${r1(r * 0.12)}" fill="#f6f2ec"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r1(r * 1.05)}" fill="#f6f2ec"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 0.9)}" fill="#a8693a"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r1(r * 0.86)}" fill="#b97a45"/>${leaves}` +
      `<path d="M${cx} ${r1(cy - r * 0.6)} L${cx} ${r1(cy + r * 0.6)}" stroke="#f4e6d2" stroke-width="${r1(r * 0.04)}"/>` +
      `<circle cx="${cx}" cy="${r1(cy - r * 0.55)}" r="${r1(r * 0.12)}" fill="#f4e6d2"/>`,
  );
}

/** A kraft coffee bag with a label. */
export function bag(aspect: SampleArtAspect, bg: string, label: string): string {
  const [w, h] = SIZES[aspect];
  const bw = w * 0.5;
  const bh = h * 0.72;
  const x = (w - bw) / 2;
  const y = h * 0.16;
  return picture(
    aspect,
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
      `<ellipse cx="${w / 2}" cy="${r1(y + bh + 6)}" rx="${r1(bw * 0.6)}" ry="12" fill="#000000" opacity="0.15"/>` +
      `<path d="M${r1(x)} ${r1(y + 30)} L${r1(x + bw)} ${r1(y + 30)} L${r1(x + bw - 8)} ${r1(y + bh)} L${r1(x + 8)} ${r1(y + bh)} Z" fill="#c49a6c"/>` +
      `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(bw)}" height="34" fill="#b38a5e"/>` +
      `<rect x="${r1(x)}" y="${r1(y + 30)}" width="${r1(bw)}" height="6" fill="#000000" opacity="0.12"/>` +
      `<rect x="${r1(x + bw * 0.14)}" y="${r1(y + bh * 0.32)}" width="${r1(bw * 0.72)}" height="${r1(bh * 0.42)}" rx="6" fill="${label}"/>` +
      `<circle cx="${r1(w / 2)}" cy="${r1(y + bh * 0.42)}" r="${r1(bw * 0.09)}" fill="#ffffff" opacity="0.9"/>` +
      `<rect x="${r1(x + bw * 0.26)}" y="${r1(y + bh * 0.54)}" width="${r1(bw * 0.48)}" height="8" rx="4" fill="#ffffff" opacity="0.9"/>` +
      `<rect x="${r1(x + bw * 0.32)}" y="${r1(y + bh * 0.61)}" width="${r1(bw * 0.36)}" height="6" rx="3" fill="#ffffff" opacity="0.6"/>`,
  );
}

/** A cold brew bottle. */
export function bottle(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  const cx = w / 2;
  return picture(
    aspect,
    `${gradient('g', '#d8e6ea', '#a9c3cb')}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<path d="M${cx - 22} ${h * 0.12} h44 v40 q50 30 50 90 v${h * 0.55} q0 14 -14 14 h-116 q-14 0 -14 -14 v-${h * 0.55} q0 -60 50 -90 z" fill="#2b1a10"/>` +
      `<rect x="${cx - 24}" y="${h * 0.08}" width="48" height="26" rx="4" fill="#1a1f24"/>` +
      `<rect x="${cx - 58}" y="${h * 0.48}" width="116" height="${h * 0.22}" rx="4" fill="#f2ebe0"/>` +
      `<rect x="${cx - 38}" y="${h * 0.54}" width="76" height="10" rx="5" fill="#b5652b"/>` +
      `<rect x="${cx - 28}" y="${h * 0.6}" width="56" height="6" rx="3" fill="#6b5a4a"/>` +
      `<rect x="${cx + 34}" y="${h * 0.3}" width="8" height="${h * 0.5}" rx="4" fill="#ffffff" opacity="0.18"/>`,
  );
}

/** Ripe coffee cherries between leaves. */
export function cherries(aspect: SampleArtAspect, seed: number): string {
  const [w, h] = SIZES[aspect];
  const next = random(seed);
  let leaves = '';
  for (let i = 0; i < 14; i++) {
    const x = next() * w;
    const y = next() * h;
    leaves += `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(60 + next() * 40)}" ry="${r1(18 + next() * 10)}" transform="rotate(${Math.round(next() * 180)} ${r1(x)} ${r1(y)})" fill="${next() > 0.5 ? '#2f5d34' : '#3f7444'}"/>`;
  }
  let fruit = '';
  for (let c = 0; c < 5; c++) {
    const x = w * (0.15 + next() * 0.7);
    const y = h * (0.2 + next() * 0.6);
    for (let i = 0; i < 6; i++) {
      const color = ['#b3261e', '#c8401f', '#d9752a', '#8e1c1a'][Math.floor(next() * 4)];
      const cx = x + (next() - 0.5) * 50;
      const cy = y + (next() - 0.5) * 40;
      fruit += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(11 + next() * 5)}" fill="${color}"/><circle cx="${r1(cx - 4)}" cy="${r1(cy - 4)}" r="3" fill="#ffffff" opacity="0.35"/>`;
    }
  }
  return picture(aspect, `<rect width="${w}" height="${h}" fill="#1f3a22"/>${leaves}${fruit}`);
}

/** A coffee farm on hills under the sky. */
export function farm(aspect: SampleArtAspect, sky: readonly [string, string], sun = '#ffd27a'): string {
  const [w, h] = SIZES[aspect];
  let rows = '';
  for (let i = 0; i < 9; i++) {
    const y = h * 0.62 + i * 14;
    rows += `<path d="M0 ${r1(y)} Q ${w / 2} ${r1(y - 40)} ${w} ${r1(y + 6)}" stroke="#244d2a" stroke-width="7" stroke-dasharray="10 8" fill="none"/>`;
  }
  return picture(
    aspect,
    `${gradient('g', sky[0], sky[1])}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<circle cx="${w * 0.75}" cy="${h * 0.3}" r="${h * 0.09}" fill="${sun}"/>` +
      `<path d="M0 ${h * 0.55} Q ${w * 0.25} ${h * 0.32} ${w * 0.5} ${h * 0.5} T ${w} ${h * 0.42} V ${h} H0 Z" fill="#6b8f5a"/>` +
      `<path d="M0 ${h * 0.68} Q ${w * 0.35} ${h * 0.5} ${w * 0.7} ${h * 0.64} T ${w} ${h * 0.6} V ${h} H0 Z" fill="#4c7a45"/>${rows}` +
      `<path d="M0 ${h * 0.86} Q ${w * 0.5} ${h * 0.76} ${w} ${h * 0.88} V ${h} H0 Z" fill="#355f34"/>`,
  );
}

/** A pour-over: kettle, dripper and carafe. */
export function pourOver(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  const cx = w * 0.55;
  return picture(
    aspect,
    `<rect width="${w}" height="${h}" fill="#ece6dc"/><rect y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="#d6cbbb"/>` +
      `<path d="M${cx - 70} ${h * 0.6} h140 l-12 ${h * 0.22} h-116 z" fill="#ffffff" opacity="0.55" stroke="#9aa5ad" stroke-width="3"/>` +
      `<path d="M${cx - 66} ${h * 0.72} h132 l-6 ${h * 0.1} h-120 z" fill="#5a3218"/>` +
      `<path d="M${cx - 60} ${h * 0.38} h120 l-40 ${h * 0.18} h-40 z" fill="#f7f4ef" stroke="#c9c1b4" stroke-width="3"/>` +
      `<rect x="${cx - 75}" y="${h * 0.36}" width="150" height="8" rx="4" fill="#e3dccf"/>` +
      `<path d="M${w * 0.08} ${h * 0.2} h${w * 0.2} v${h * 0.2} h-${w * 0.2} z" fill="#2f3438"/>` +
      `<path d="M${w * 0.28} ${h * 0.24} C ${w * 0.4} ${h * 0.12} ${cx - 10} ${h * 0.14} ${cx - 4} ${h * 0.3}" stroke="#2f3438" stroke-width="7" fill="none"/>` +
      `<path d="M${cx - 4} ${h * 0.3} L${cx - 2} ${h * 0.4}" stroke="#c7a27c" stroke-width="3"/>`,
  );
}

/** Grinder burrs, close up. */
export function burrs(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.42;
  let teeth = '';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const a2 = a + 0.5;
    teeth += `<path d="M${r1(cx + Math.cos(a) * r * 0.35)} ${r1(cy + Math.sin(a) * r * 0.35)} L${r1(cx + Math.cos(a2) * r * 0.95)} ${r1(cy + Math.sin(a2) * r * 0.95)}" stroke="#5d656b" stroke-width="5"/>`;
  }
  return picture(
    aspect,
    `<rect width="${w}" height="${h}" fill="#1e2226"/><circle cx="${cx}" cy="${cy}" r="${r1(r)}" fill="#9aa4ab"/>${teeth}` +
      `<circle cx="${cx}" cy="${cy}" r="${r1(r * 0.3)}" fill="#3a4045"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 0.12)}" fill="#14171a"/>` +
      scatter(aspect, 3, 6, 10, ['#5a2f16', '#6b3a1c']),
  );
}

/** A drum roaster with its hopper and chimney. */
export function roaster(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  const cx = w * 0.45;
  const cy = h * 0.58;
  const r = h * 0.26;
  return picture(
    aspect,
    `${gradient('g', '#3a2a22', '#17110e')}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<rect x="${cx + r * 0.6}" y="0" width="${r * 0.35}" height="${cy}" fill="#5b6268"/>` +
      `<path d="M${cx - r * 0.5} ${cy - r * 1.6} h${r} l-${r * 0.3} ${r * 0.6} h-${r * 0.4} z" fill="#8e979e"/>` +
      `<rect x="${cx - r * 1.3}" y="${cy - r * 1.05}" width="${r * 2.6}" height="${r * 2.1}" rx="${r * 0.2}" fill="#2c3136"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#a3262a"/><circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="#c9cfd3"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="#2b1a10"/>` +
      [-0.25, 0, 0.22, -0.1, 0.12].map((dx, i) => bean(cx + dx * r, cy + r * (0.25 - (i % 3) * 0.12), 9, i * 40, '#8a4a1d')).join('') +
      `<rect x="${cx - r * 1.6}" y="${cy + r * 1.05}" width="${r * 3.2}" height="${h}" fill="#4a4f54"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.8}" ry="${r * 1.4}" fill="#ff9a3c" opacity="0.08"/>`,
  );
}

/** Cups on a cupping table, from above. */
export function cupping(aspect: SampleArtAspect, table = '#d9cdbd'): string {
  const [w, h] = SIZES[aspect];
  let cups = '';
  const cols = 4;
  const rows = 2;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = (w / cols) * (c + 0.5);
      const y = (h / rows) * (r + 0.5);
      const rad = Math.min(w / cols, h / rows) * 0.3;
      cups += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(rad * 1.15)}" fill="#ffffff"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(rad)}" fill="${['#6a3b1d', '#7a4524', '#5b311a'][(c + r) % 3]}"/>`;
      cups += `<rect x="${r1(x + rad * 0.6)}" y="${r1(y + rad * 0.9)}" width="${r1(rad * 1.4)}" height="6" rx="3" transform="rotate(30 ${r1(x)} ${r1(y)})" fill="#b8bec2"/>`;
    }
  }
  return picture(aspect, `<rect width="${w}" height="${h}" fill="${table}"/>${cups}`);
}

/** Burlap sacks of green coffee. */
export function sacks(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  let out = '';
  const colors = ['#c2a878', '#b39966', '#cbb487'];
  for (let i = 0; i < 3; i++) {
    const x = w * (0.06 + i * 0.31);
    const sw = w * 0.3;
    out +=
      `<path d="M${r1(x)} ${h * 0.35} Q ${r1(x + sw / 2)} ${h * 0.22} ${r1(x + sw)} ${h * 0.35} L${r1(x + sw - 6)} ${h * 0.92} Q ${r1(x + sw / 2)} ${h * 0.98} ${r1(x + 6)} ${h * 0.92} Z" fill="${colors[i]}"/>` +
      `<circle cx="${r1(x + sw / 2)}" cy="${h * 0.6}" r="${r1(sw * 0.2)}" fill="none" stroke="#3d5a3a" stroke-width="5"/>` +
      `<rect x="${r1(x + sw * 0.25)}" y="${h * 0.76}" width="${r1(sw * 0.5)}" height="7" fill="#3d5a3a"/>`;
  }
  return picture(aspect, `<rect width="${w}" height="${h}" fill="#5c4a3a"/><rect y="${h * 0.9}" width="${w}" height="${h}" fill="#3e3127"/>${out}`);
}

/** The roastery building at dawn. */
export function dawn(aspect: SampleArtAspect): string {
  const [w, h] = SIZES[aspect];
  let windows = '';
  for (let i = 0; i < 8; i++) {
    windows += `<rect x="${w * 0.14 + i * w * 0.09}" y="${h * 0.62}" width="${w * 0.05}" height="${h * 0.08}" fill="${i % 3 === 0 ? '#3a3f45' : '#ffcf7a'}"/>`;
  }
  return picture(
    aspect,
    `${gradient('g', '#33507a', '#f2a65a')}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<circle cx="${w * 0.2}" cy="${h * 0.55}" r="${h * 0.12}" fill="#ffd9a0"/>` +
      `<path d="M${w * 0.1} ${h * 0.5} h${w * 0.8} v${h * 0.5} h-${w * 0.8} z" fill="#2a2522"/>` +
      `<path d="M${w * 0.1} ${h * 0.5} l${w * 0.2} -${h * 0.12} l${w * 0.2} ${h * 0.12} l${w * 0.2} -${h * 0.12} l${w * 0.2} ${h * 0.12} z" fill="#2a2522"/>` +
      `<rect x="${w * 0.78}" y="${h * 0.2}" width="${w * 0.04}" height="${h * 0.3}" fill="#2a2522"/>${windows}` +
      `<ellipse cx="${w * 0.82}" cy="${h * 0.14}" rx="${w * 0.06}" ry="${h * 0.04}" fill="#ffffff" opacity="0.3"/>` +
      `<ellipse cx="${w * 0.88}" cy="${h * 0.07}" rx="${w * 0.08}" ry="${h * 0.04}" fill="#ffffff" opacity="0.2"/>`,
  );
}

/** A head-and-shoulders portrait. */
export function portrait(bg: string, skin: string, hair: string, shirt: string, long = false): string {
  const [w, h] = SIZES.portrait;
  const cx = w / 2;
  const longHair = long ? `<path d="M${cx - 78} ${h * 0.38} q-8 120 20 160 h116 q28 -40 20 -160 z" fill="${hair}"/>` : '';
  return picture(
    'portrait',
    `<rect width="${w}" height="${h}" fill="${bg}"/>${longHair}` +
      `<path d="M${cx - 150} ${h} q10 -150 150 -160 q140 10 150 160 z" fill="${shirt}"/>` +
      `<rect x="${cx - 26}" y="${h * 0.52}" width="52" height="60" fill="${skin}"/>` +
      `<ellipse cx="${cx}" cy="${h * 0.4}" rx="70" ry="86" fill="${skin}"/>` +
      `<path d="M${cx - 74} ${h * 0.38} q0 -110 74 -110 q74 0 74 110 q-20 -60 -74 -62 q-54 2 -74 62 z" fill="${hair}"/>`,
  );
}

/** Beans on a transparent background (a PNG cut-out). */
export function cutout(aspect: SampleArtAspect): string {
  return picture(aspect, scatter(aspect, 21, 18, 34, ['#6b3a1c', '#7a4421', '#5a2f16']));
}

/** The summer campaign banner, one per language. */
export function banner(headline: string, line: string, hue: 'warm' | 'cool'): string {
  const [w, h] = SIZES.wide;
  const [a, b] = hue === 'warm' ? ['#f6c26b', '#e0763c'] : ['#8fd0d8', '#3f8fa8'];
  return picture(
    'wide',
    `${gradient('g', a, b, false)}<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<circle cx="${w * 0.8}" cy="${h * 0.5}" r="${h * 0.38}" fill="#ffffff" opacity="0.2"/>` +
      `<path d="M${w * 0.73} ${h * 0.25} h${w * 0.14} l-${w * 0.015} ${h * 0.55} h-${w * 0.11} z" fill="#2b1a10"/>` +
      `<rect x="${w * 0.735}" y="${h * 0.42}" width="${w * 0.13}" height="${h * 0.16}" fill="#f2ebe0"/>` +
      `<text x="${w * 0.07}" y="${h * 0.45}" font-family="Inter, Arial, sans-serif" font-size="46" font-weight="700" fill="#2b1a10">${headline}</text>` +
      `<text x="${w * 0.07}" y="${h * 0.6}" font-family="Inter, Arial, sans-serif" font-size="22" fill="#2b1a10">${line}</text>`,
  );
}

/** The first page of the PDF price list. */
export function pdfPage(): string {
  const w = 420;
  const h = 594;
  let rows = '';
  for (let i = 0; i < 12; i++) {
    const y = 190 + i * 28;
    rows += `<rect x="40" y="${y}" width="${150 + ((i * 37) % 90)}" height="8" rx="2" fill="#9aa3ab"/><rect x="320" y="${y}" width="60" height="8" rx="2" fill="#6b747c"/>`;
    rows += `<rect x="40" y="${y + 16}" width="340" height="1" fill="#d5dade"/>`;
  }
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>` +
      `<rect width="${w}" height="110" fill="#2b1a10"/><circle cx="62" cy="55" r="20" fill="#b5652b"/>` +
      `<rect x="96" y="44" width="160" height="12" rx="3" fill="#f2ebe0"/><rect x="96" y="62" width="100" height="8" rx="3" fill="#c9b9a6"/>` +
      `<rect x="40" y="140" width="200" height="16" rx="3" fill="#2b1a10"/>${rows}</svg>`,
  );
}
