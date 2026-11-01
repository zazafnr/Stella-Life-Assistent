// Abos und Limits. Startwerte stehen hier; der Owner kann sie ohne Deploy überschreiben (Einstellungen / Firmen-Dashboard).
// Quelle der Zahlen: docs/plan/stella-v3.md → „Kosten und Abos“. Keine Punkte, Serien oder Abzeichen – nur Grenzen und Funktionen.

export const PLAN_IDS = ['free', 'plus', 'pro', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);

export interface PlanLimits {
  /** KI-Nachrichten (Haiku) pro Tag: eine Nutzernachricht, die ein Modell braucht (Kurznotizen, Planer, Erinnerungen ohne KI zählen nicht) */
  aiMessagesPerDay: number;
  /** Profi-Aufgaben (Sonnet) pro Monat */
  proTasksPerMonth: number;
  /** Free: Profi-Aufgaben nur zum Lösen von Hausübungen */
  proTasksHomeworkOnly: boolean;
  /** Verbundene Postfächer (999 = unbegrenzt) */
  mailboxes: number;
  /** Meldungen im Morgen-Briefing */
  newsCount: number;
  newsFavorites: boolean;
  /** Bildschirmzeit-Ziele (iOS) */
  screenTime: boolean;
  /** Reservieren und Verfügbarkeit mit Websuche (zählt als Profi-Aufgabe) */
  webTasks: boolean;
  /** Vorrang bei Last, neue Funktionen früher */
  priority: boolean;
}

export interface Plan {
  id: PlanId;
  /** Preis pro Monat in Euro-Cent */
  priceCents: number;
  limits: PlanLimits;
}

export const UNLIMITED = 999;

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', priceCents: 0, limits: { aiMessagesPerDay: 15, proTasksPerMonth: 3, proTasksHomeworkOnly: true, mailboxes: 1, newsCount: 3, newsFavorites: false, screenTime: false, webTasks: false, priority: false } },
  plus: { id: 'plus', priceCents: 800, limits: { aiMessagesPerDay: 60, proTasksPerMonth: 15, proTasksHomeworkOnly: false, mailboxes: 2, newsCount: 5, newsFavorites: false, screenTime: true, webTasks: true, priority: false } },
  pro: { id: 'pro', priceCents: 1500, limits: { aiMessagesPerDay: 120, proTasksPerMonth: 40, proTasksHomeworkOnly: false, mailboxes: 4, newsCount: 5, newsFavorites: true, screenTime: true, webTasks: true, priority: false } },
  max: { id: 'max', priceCents: 3500, limits: { aiMessagesPerDay: 300, proTasksPerMonth: 150, proTasksHomeworkOnly: false, mailboxes: UNLIMITED, newsCount: 5, newsFavorites: true, screenTime: true, webTasks: true, priority: true } },
};

/** Überschreibungen (Teil der Limits je Abo) über die Startwerte legen */
export type PlanOverrides = Partial<Record<PlanId, Partial<PlanLimits> & { priceCents?: number }>>;

export function effectivePlan(id: PlanId, overrides: PlanOverrides = {}): Plan {
  const o = overrides[id] ?? {};
  const { priceCents, ...limits } = o;
  return { id, priceCents: priceCents ?? PLANS[id].priceCents, limits: { ...PLANS[id].limits, ...limits } };
}

/** Funktionen eines Abos als Liste (für die Vergleichstabelle) */
export function planFeatures(plan: Plan): string[] {
  const l = plan.limits;
  const out = [`ai_messages:${l.aiMessagesPerDay}`, `pro_tasks:${l.proTasksPerMonth}${l.proTasksHomeworkOnly ? ':homework' : ''}`, `mailboxes:${l.mailboxes}`, `news:${l.newsCount}${l.newsFavorites ? ':favorites' : ''}`, 'telegram', 'weather'];
  if (l.screenTime) out.push('screen_time');
  if (l.webTasks) out.push('web_tasks');
  if (l.priority) out.push('priority');
  return out;
}

/** Jahresabo: zwei Monate gratis */
export const yearlyPriceCents = (plan: Plan) => plan.priceCents * 10;
