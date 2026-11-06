// Beide Web-Apps aus einem Server: Host `students.…` → Studenten-App, sonst die normale Stella-App.
// Pfade: config.webDist (web/dist) und config.studentsWebDist (editions/students/web/dist bzw. STELLA_STUDENTS_WEB_DIR).

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { requestEdition } from './editions/registry.ts';

export interface WebRoots { life: string; students: string }

/** Service Worker & HTML immer frisch, gehashte Assets ewig cachen */
const setCacheHeaders = (res: { setHeader(name: string, value: string): void }, filePath: string) =>
  res.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');

/** Datei unter `root` für einen URL-Pfad – nur innerhalb von `root`, sonst null */
export function fileFor(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]!); } catch { return null; }
  const rel = path.posix.normalize(`/${decoded}`).replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return null;
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) return null;
  try { return statSync(abs).isFile() ? rel : null; } catch { return null; }
}

/**
 * Registriert die Auslieferung (Wurzel-Pfade außerhalb von /api). Fehlt die Studenten-App, antwortet der students-Host mit 503,
 * statt die normale App unter dem falschen Namen zu zeigen. Fehlt die normale App, wird nichts registriert (nur API).
 */
export async function registerWebApps(app: FastifyInstance, roots: WebRoots): Promise<void> {
  const haveLife = existsSync(roots.life);
  const haveStudents = existsSync(roots.students);
  if (!haveLife && !haveStudents) return;
  await app.register(fastifyStatic, { root: haveLife ? roots.life : roots.students, serve: false, cacheControl: false, setHeaders: setCacheHeaders });

  const send = (req: FastifyRequest, reply: FastifyReply, root: string | null) => {
    if (!root) return reply.code(503).type('text/plain; charset=utf-8').send('Stella for Students is not installed on this server.');
    const rel = fileFor(root, req.url) ?? 'index.html';
    return reply.sendFile(rel, root);
  };
  const rootFor = (req: FastifyRequest) => (requestEdition(req) === 'students' ? (haveStudents ? roots.students : null) : (haveLife ? roots.life : null));

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: 'Nicht gefunden' });
    return send(req, reply, rootFor(req));
  });
  // „/“ und alle Datei-Pfade laufen über den Not-Found-Handler; die Startseite explizit, damit sie nicht im 404-Pfad landet
  app.get('/', (req, reply) => send(req, reply, rootFor(req)));
}
