import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { newId } from './db.ts';

const dir = path.join(config.dataDir, 'files');
export const FILE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function filePath(id: string): string | null {
  const safe = id.replace(/[^a-f0-9-]/g, '');
  for (const ext of Object.keys(FILE_TYPES)) {
    const p = path.join(dir, `${safe}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

export function saveFile(data: Buffer, ext: keyof typeof FILE_TYPES | string): string {
  if (!FILE_TYPES[ext]) throw new Error('Dateityp nicht erlaubt');
  const id = newId();
  writeFileSync(path.join(dir, `${id}.${ext}`), data);
  return id;
}

/** data:image/jpeg;base64,... → gespeicherte Datei */
export function saveDataUrl(dataUrl: string): string {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('Ungültiges Bild');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return saveFile(Buffer.from(m[2], 'base64'), ext);
}
