// Meldungen zur selben Geschichte in eine Gruppe: normalisierte Titel-Wörter, Jaccard-Ähnlichkeit ≥ 0,5 innerhalb von 12 Stunden.

const STOP = new Set(['der', 'die', 'das', 'und', 'ein', 'eine', 'mit', 'von', 'für', 'auf', 'ist', 'im', 'in', 'zu', 'den', 'nach', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'les', 'des', 'une', 'del', 'los', 'las', 'por', 'con', 'che', 'per', 'una', 'uma', 'para', 'com', 'bir', 'için', 'oraz', 'jest', 'dla']);

export function titleWords(title: string): Set<string> {
  const words = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export const CLUSTER_THRESHOLD = 0.5;
export const CLUSTER_WINDOW_MS = 12 * 3600_000;

export interface Clusterable { id: string; title: string; publishedAt: number; clusterId: string }

/** Cluster-Id für eine neue Meldung: die einer ähnlichen Meldung der letzten 12 Stunden, sonst die eigene Id */
export function assignCluster(item: { id: string; title: string; publishedAt: number }, recent: Clusterable[]): string {
  const words = titleWords(item.title);
  let best: { id: string; score: number } | null = null;
  for (const r of recent) {
    if (Math.abs(r.publishedAt - item.publishedAt) > CLUSTER_WINDOW_MS) continue;
    const score = jaccard(words, titleWords(r.title));
    if (score >= CLUSTER_THRESHOLD && (!best || score > best.score)) best = { id: r.clusterId, score };
  }
  return best?.id ?? item.id;
}
