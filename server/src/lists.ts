// Einkaufsliste und eigene Listen. Die Einkaufsliste gibt es immer. Im Chat („schreib Milch auf die Einkaufsliste“)
// laufen Änderungen über Aktionen mit „Rückgängig“; in der Listen-Ansicht wird direkt abgehakt.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ListItem, StellaList } from '@stella/shared';
import { HttpError } from './auth.ts';
import { db, newId, now } from './db.ts';

type ItemRow = { id: string; text: string; qty: string | null; done: number; added_via: string; created_at: string };
const toListItem = (r: ItemRow): ListItem => ({ id: r.id, text: r.text, qty: r.qty, done: !!r.done, addedVia: r.added_via, createdAt: r.created_at });

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Die Einkaufsliste – wird beim ersten Zugriff angelegt. */
export function shoppingListId(userId: string): string {
  const row = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'shopping'").get(userId) as { id: string } | undefined;
  if (row) return row.id;
  const id = newId();
  db.prepare("INSERT INTO lists (id, user_id, name, kind, created_at) VALUES (?, ?, 'Einkaufsliste', 'shopping', ?)").run(id, userId, now());
  return id;
}

function ownedList(userId: string, listId: string) {
  return db.prepare('SELECT id, name, kind FROM lists WHERE user_id = ? AND id = ?').get(userId, listId) as { id: string; name: string; kind: string } | undefined;
}

export function getList(userId: string, listId: string): StellaList | null {
  const l = ownedList(userId, listId);
  if (!l) return null;
  // offene zuerst (neueste oben), erledigte darunter
  const items = (db.prepare('SELECT * FROM list_items WHERE list_id = ? ORDER BY done, CASE WHEN done = 0 THEN created_at END DESC, done_at DESC LIMIT 300').all(listId) as ItemRow[]).map(toListItem);
  return { id: l.id, name: l.name, kind: l.kind === 'shopping' ? 'shopping' : 'custom', items };
}

export function allLists(userId: string): StellaList[] {
  shoppingListId(userId);
  const ids = db.prepare("SELECT id FROM lists WHERE user_id = ? ORDER BY kind = 'shopping' DESC, created_at").all(userId) as { id: string }[];
  return ids.map((r) => getList(userId, r.id)!);
}

export function openItems(userId: string): ListItem[] {
  return getList(userId, shoppingListId(userId))!.items.filter((i) => !i.done);
}

/** Neue Einträge – was schon offen auf der Liste steht, wird nicht doppelt angelegt. Gibt die neuen Ids und die Übersprungenen zurück. */
export function addListItems(userId: string, listId: string, items: { text: string; qty?: string | null }[], via = 'chat'): { created: ListItem[]; skipped: string[] } {
  const open = new Set((db.prepare('SELECT text FROM list_items WHERE list_id = ? AND done = 0').all(listId) as { text: string }[]).map((r) => norm(r.text)));
  const created: ListItem[] = [];
  const skipped: string[] = [];
  const insert = db.prepare('INSERT INTO list_items (id, list_id, text, qty, done, added_via, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)');
  db.transaction(() => {
    for (const it of items) {
      const text = it.text.trim().slice(0, 80);
      if (!text) continue;
      if (open.has(norm(text))) { skipped.push(text); continue; }
      open.add(norm(text));
      const id = newId();
      // jede Zeile bekommt einen eigenen Zeitstempel, damit die Reihenfolge stimmt
      insert.run(id, listId, text, it.qty?.trim().slice(0, 30) || null, via, new Date(Date.now() + created.length).toISOString());
      created.push(toListItem(db.prepare('SELECT * FROM list_items WHERE id = ?').get(id) as ItemRow));
    }
  })();
  return { created, skipped };
}

export function removeListItems(userId: string, ids: string[]) {
  const del = db.prepare('DELETE FROM list_items WHERE id = ? AND list_id IN (SELECT id FROM lists WHERE user_id = ?)');
  for (const id of ids) del.run(id, userId);
}

/** Abhaken (oder wieder öffnen). Gibt zurück, was vorher galt – für „Rückgängig“. */
export function setListItemsDone(userId: string, ids: string[], done: boolean): { id: string; done: boolean }[] {
  const prev: { id: string; done: boolean }[] = [];
  const get = db.prepare('SELECT li.done FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ? AND l.user_id = ?');
  const set = db.prepare('UPDATE list_items SET done = ?, done_at = ? WHERE id = ?');
  for (const id of ids) {
    const row = get.get(id, userId) as { done: number } | undefined;
    if (!row) continue;
    prev.push({ id, done: !!row.done });
    set.run(done ? 1 : 0, done ? now() : null, id);
  }
  return prev;
}

/** Welche offenen Einträge sind gemeint? „Milch“ trifft „2 Liter Milch“ und „Milch“, nicht „Milchschnitte“ aus Versehen. */
export function matchOpenItems(userId: string, names: string[]): { matched: ListItem[]; missing: string[] } {
  const open = openItems(userId);
  const matched: ListItem[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const n = norm(name);
    const hit = open.find((i) => !matched.includes(i) && (norm(i.text) === n || norm(i.text).split(' ').includes(n) || n.split(' ').includes(norm(i.text))));
    if (hit) matched.push(hit); else missing.push(name);
  }
  return { matched, missing };
}

export function clearDone(userId: string, listId: string): number {
  if (!ownedList(userId, listId)) return 0;
  return db.prepare('DELETE FROM list_items WHERE list_id = ? AND done = 1').run(listId).changes;
}

// ---------- Routen (Listen-Ansicht) ----------

export function registerListRoutes(api: FastifyInstance) {
  api.get('/api/lists', async (req) => ({ lists: allLists(req.user.id) }));

  api.post('/api/lists/:id/items', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const list = ownedList(req.user.id, req.params.id);
    if (!list) throw new HttpError(404, 'Liste nicht gefunden');
    const text = typeof b.text === 'string' ? b.text : '';
    if (!text.trim()) throw new HttpError(400, 'Was soll auf die Liste?');
    const { created } = addListItems(req.user.id, list.id, [{ text, qty: typeof b.qty === 'string' ? b.qty : null }], 'app');
    return { list: getList(req.user.id, list.id), created };
  });

  api.patch('/api/list-items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = db.prepare('SELECT li.id, li.list_id AS listId FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ? AND l.user_id = ?').get(req.params.id, req.user.id) as { id: string; listId: string } | undefined;
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
    if (typeof b.done === 'boolean') setListItemsDone(req.user.id, [row.id], b.done);
    if (typeof b.text === 'string' && b.text.trim()) db.prepare('UPDATE list_items SET text = ? WHERE id = ?').run(b.text.trim().slice(0, 80), row.id);
    if (b.qty !== undefined) db.prepare('UPDATE list_items SET qty = ? WHERE id = ?').run(typeof b.qty === 'string' && b.qty.trim() ? b.qty.trim().slice(0, 30) : null, row.id);
    return { list: getList(req.user.id, row.listId) };
  });

  api.delete('/api/list-items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const row = db.prepare('SELECT li.list_id AS listId FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ? AND l.user_id = ?').get(req.params.id, req.user.id) as { listId: string } | undefined;
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
    removeListItems(req.user.id, [req.params.id]);
    return { list: getList(req.user.id, row.listId) };
  });

  api.post('/api/lists/:id/clear-done', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!ownedList(req.user.id, req.params.id)) throw new HttpError(404, 'Liste nicht gefunden');
    return { removed: clearDone(req.user.id, req.params.id), list: getList(req.user.id, req.params.id) };
  });
}
