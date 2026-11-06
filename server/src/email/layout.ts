// E-Mail-Grundgerüst im Stil der Marke: schwarzer Kopf, ruhiger Himmel als Bild, weiße Karte, schwarzer Knopf.
// Tabellen-Layout mit Inline-CSS (600 px), Knopf mit Outlook-Rückfall (VML), helle und dunkle Variante,
// unsichtbarer Vorschautext, immer eine Textversion. Keine schwere Abhängigkeit (kein MJML), keine Emojis, keine SVG (Gmail).

import { config } from '../config.ts';
import { t, type Locale } from '@stella/shared';

const FONT = "'Geist', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Nur http(s)-Adressen und mailto: in Links und Bildern zulassen */
export const safeUrl = (u: string) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : '#');

export interface EmailCard { title: string; text: string; icon?: string }

export interface EmailParts {
  locale: Locale;
  /** Produktname im Kopf und Fuß (Standard „Stella“) */
  product?: string;
  /** unsichtbarer Vorschautext in der Postfach-Liste */
  preheader: string;
  /** Name der Bilddatei ohne Endung (web/public/mail/<name>.png) und Alt-Text */
  hero: { image: string; alt: string };
  title: string;
  /** Absätze als reiner Text (wird escaped); `{{b}}…{{/b}}` ergibt fett */
  body: string[];
  button?: { label: string; url: string };
  /** Code groß in Mono-Schrift, z. B. 482913 */
  code?: { label?: string; value: string };
  /** Karten mit kleinem Symbol (Willkommen) bzw. grauer Kasten (Stella hat X getan) */
  cards?: EmailCard[];
  /** zweiter, schwacher Knopf (z. B. „Rückgängig machen“) */
  secondary?: { label: string; url: string; note?: string };
  /** Hinweis unter der Karte, z. B. „Der Link gilt 15 Minuten.“ */
  note?: string;
  /** „Du bekommst diese Mail, weil …“ */
  reason: string;
  /** Antwort-Text von Stella, schon als sicheres HTML (aus markdown.ts) */
  richHtml?: string;
  /** Klartext-Fassung von richHtml */
  richText?: string;
}

const inlineBold = (s: string) => escapeHtml(s).replace(/\{\{b\}\}([\s\S]*?)\{\{\/b\}\}/g, '<strong style="font-weight:600">$1</strong>');
const stripBold = (s: string) => s.replace(/\{\{\/?b\}\}/g, '');

export function mailAssetUrl(name: string) { return `${config.mail.assetsUrl.replace(/\/$/, '')}/${name}.png`; }

/** Knopf: normaler Link mit Polster, in Outlook ein VML-Rechteck */
function button(b: { label: string; url: string }, style: 'primary' | 'ghost' = 'primary') {
  const url = escapeHtml(safeUrl(b.url));
  const label = escapeHtml(b.label);
  if (style === 'ghost') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 0"><tr><td align="center">
<a href="${url}" class="btn-ghost" style="display:block;box-sizing:border-box;border:1.5px solid #D4D4D8;border-radius:14px;color:#09090B;font:600 15px/48px ${FONT};text-align:center;text-decoration:none;height:50px">${label}</a>
</td></tr></table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 6px"><tr><td align="center" class="btn-cell">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:52px;v-text-anchor:middle;width:536px" arcsize="27%" stroke="f" fillcolor="#09090B"><w:anchorlock/><center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" class="btn" style="display:block;box-sizing:border-box;background:#09090B;border-radius:14px;color:#FFFFFF;font:600 16px/52px ${FONT};text-align:center;text-decoration:none;height:52px;mso-hide:all">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

function codeBox(c: { label?: string; value: string }) {
  return `${c.label ? `<p class="muted" style="margin:20px 0 8px;font:400 14px/1.5 ${FONT};color:#71717A">${escapeHtml(c.label)}</p>` : ''}
<div class="codebox" style="margin:${c.label ? 0 : 20}px 0 6px;padding:16px 8px;border:1px solid #E4E4E7;border-radius:14px;background:#F4F4F5;text-align:center;font:500 28px/1.2 ${MONO};letter-spacing:.2em;color:#09090B;mso-line-height-rule:exactly;white-space:nowrap">${escapeHtml(c.value)}</div>`;
}

function cardHtml(c: EmailCard) {
  const icon = c.icon ? `<td width="48" valign="top" style="padding:0 14px 0 0"><img src="${escapeHtml(mailAssetUrl(c.icon))}" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px"></td>` : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="infocard" style="margin:10px 0;background:#F4F4F5;border-radius:14px"><tr><td style="padding:14px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${icon}<td valign="top">
<p class="ink" style="margin:0 0 2px;font:600 15px/1.4 ${FONT};color:#09090B">${inlineBold(c.title)}</p>
<p class="body" style="margin:0;font:400 14px/1.5 ${FONT};color:#3F3F46">${inlineBold(c.text)}</p></td></tr></table></td></tr></table>`;
}

export function renderEmail(p: EmailParts): { html: string; text: string } {
  const lang = p.locale;
  const hero = `<td bgcolor="#9CCBFF" style="background:#9CCBFF"><img src="${escapeHtml(mailAssetUrl(p.hero.image))}" width="600" alt="${escapeHtml(p.hero.alt)}" class="hero" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:#9CCBFF;color:#0F2A4A;font:400 14px/1.4 ${FONT}"></td>`;
  const legal = `<a href="${escapeHtml(config.mail.imprintUrl)}" style="color:#71717A">${escapeHtml(t(lang, 'email.footer.imprint'))}</a> · <a href="${escapeHtml(config.mail.privacyUrl)}" style="color:#71717A">${escapeHtml(t(lang, 'email.footer.privacy'))}</a>`;

  const html = `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(p.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }
  img { -ms-interpolation-mode: bicubic; }
  a { color: #09090B; }
  @media only screen and (max-width: 640px) {
    .container { width: 100% !important; }
    .pad { padding-left: 22px !important; padding-right: 22px !important; }
    .btn, .btn-ghost { width: 100% !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .outer { background: #000000 !important; }
    .card { background: #18181B !important; }
    .ink, h1 { color: #FAFAFA !important; }
    .body, p.body { color: #D4D4D8 !important; }
    .muted { color: #A1A1AA !important; }
    .infocard, .codebox { background: #27272A !important; border-color: #3F3F46 !important; color: #FAFAFA !important; }
    .btn { background: #FAFAFA !important; color: #09090B !important; }
    .btn-ghost { border-color: #52525B !important; color: #FAFAFA !important; }
    a { color: #FAFAFA !important; }
  }
</style>
</head>
<body class="outer" style="margin:0;padding:0;background:#F4F5F7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(p.preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="outer" style="background:#F4F5F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px;max-width:600px">
  <tr><td bgcolor="#09090B" style="background:#09090B;border-radius:18px 18px 0 0;padding:16px 24px" class="pad">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td valign="middle" style="font:600 18px/28px ${FONT};color:#FFFFFF"><img src="${escapeHtml(mailAssetUrl('star-white'))}" width="24" height="24" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:8px">${escapeHtml(p.product ?? 'Stella')}</td>
      <td align="right" valign="middle" style="font:500 10px/28px ${FONT};letter-spacing:.38em;color:#A1A1AA">EVOLSIOR</td>
    </tr></table>
  </td></tr>
  <tr>${hero}</tr>
  <tr><td class="card pad" style="background:#FFFFFF;padding:32px 36px 30px;border-radius:0 0 18px 18px">
    <h1 class="ink" style="margin:0 0 16px;font:600 26px/1.25 ${FONT};color:#09090B;letter-spacing:-.01em">${escapeHtml(p.title)}</h1>
    ${p.body.map((para) => `<p class="body" style="margin:0 0 14px;font:400 16px/1.55 ${FONT};color:#3F3F46">${inlineBold(para)}</p>`).join('\n    ')}
    ${p.richHtml ?? ''}
    ${p.cards?.map(cardHtml).join('\n') ?? ''}
    ${p.code ? codeBox(p.code) : ''}
    ${p.button ? button(p.button) : ''}
    ${p.secondary ? `${button(p.secondary, 'ghost')}${p.secondary.note ? `<p class="muted" style="margin:10px 0 0;font:400 13px/1.5 ${FONT};color:#71717A">${escapeHtml(p.secondary.note)}</p>` : ''}` : ''}
    ${p.note ? `<p class="muted" style="margin:18px 0 0;font:400 14px/1.5 ${FONT};color:#71717A">${inlineBold(p.note)}</p>` : ''}
  </td></tr>
  <tr><td class="pad" style="padding:20px 24px 8px;text-align:center">
    <p class="muted" style="margin:0 0 6px;font:500 12px/1.5 ${FONT};color:#71717A;letter-spacing:.02em">${escapeHtml(p.product ?? 'Stella')} by EVOLSIOR · Built to become</p>
    <p class="muted" style="margin:0 0 6px;font:400 12px/1.5 ${FONT};color:#71717A">${escapeHtml(config.mail.company)}</p>
    <p class="muted" style="margin:0 0 6px;font:400 12px/1.5 ${FONT};color:#71717A">${legal}</p>
    <p class="muted" style="margin:0;font:400 12px/1.5 ${FONT};color:#A1A1AA">${escapeHtml(p.reason)}</p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    p.title, '',
    ...p.body.flatMap((x) => [stripBold(x), '']),
    ...(p.richText ? [p.richText, ''] : []),
    ...(p.cards?.flatMap((c) => [`${stripBold(c.title)}: ${stripBold(c.text)}`]) ?? []), ...(p.cards?.length ? [''] : []),
    ...(p.code ? [...(p.code.label ? [`${p.code.label}:`] : []), `    ${p.code.value}`, ''] : []),
    ...(p.button ? [`${p.button.label}: ${p.button.url}`, ''] : []),
    ...(p.secondary ? [`${p.secondary.label}: ${p.secondary.url}`, ...(p.secondary.note ? [p.secondary.note] : []), ''] : []),
    ...(p.note ? [stripBold(p.note), ''] : []),
    '--', `${p.product ?? 'Stella'} by EVOLSIOR · Built to become`, config.mail.company,
    `${t(lang, 'email.footer.imprint')}: ${config.mail.imprintUrl} · ${t(lang, 'email.footer.privacy')}: ${config.mail.privacyUrl}`, p.reason,
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  return { html, text };
}
