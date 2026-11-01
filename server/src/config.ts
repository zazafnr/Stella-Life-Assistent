import { mkdirSync } from 'node:fs';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.STELLA_DATA_DIR ?? path.join(import.meta.dirname, '../../data')),
  /** Öffentliche Adresse, z. B. https://stella.deinedomain.at – für Push & Shortcuts-Links */
  publicUrl: env.STELLA_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`,
  /** Schlüssel zum Verschlüsseln gespeicherter Passwörter (digi4school, E-Mail …) */
  secret: env.STELLA_SECRET ?? '',
  /** Nach dem ersten Konto weitere Registrierungen erlauben? */
  allowRegistration: env.STELLA_ALLOW_REGISTRATION === 'true',
  /** Sprache für Konten ohne eigene Einstellung (Standard Englisch; Tests setzen Deutsch) */
  defaultLocale: env.STELLA_DEFAULT_LOCALE ?? 'en',
  defaultTimeZone: env.STELLA_TIMEZONE ?? 'Europe/Vienna',
  openrouter: {
    apiKey: env.OPENROUTER_API_KEY ?? '',
    /** Bevorzugte Modelle, kommagetrennt. Leer = automatisch die besten kostenlosen wählen. */
    models: (env.STELLA_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    /** Modelle, die Bilder lesen können (HÜ-Seiten lösen). Leer = automatisch. */
    visionModels: (env.STELLA_VISION_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    /** nur ":free"-Modelle automatisch wählen */
    freeOnly: env.STELLA_FREE_ONLY !== 'false',
    baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    /**
     * Optional: stärkere (Bezahl-)Modelle nur für schwere Aufgaben – HÜs lösen, lange „Handle it“-Ketten,
     * Wochenplanung. Kommagetrennt, z. B. "google/gemini-2.5-flash". Zählen nicht zum Gratis-Tageslimit.
     */
    heavyModels: (env.STELLA_HEAVY_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    heavyVisionModels: (env.STELLA_HEAVY_VISION_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    /** Tageslimit für Gratis-Modelle: 50 ohne Guthaben, 1000 nach einmal 10 $ Aufladen */
    dailyLimit: Number(env.STELLA_LLM_DAILY_LIMIT ?? 50),
  },
  /** Groq: günstige, schnelle Modelle für Masse-Aufgaben (Mails einordnen, Titel, Extraktion) und Whisper für Sprache */
  groq: {
    apiKey: env.GROQ_API_KEY ?? '',
    baseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    /** Modellnamen nur hier, damit man sie tauschen kann */
    models: {
      classify: env.GROQ_MODEL_CLASSIFY ?? 'llama-3.1-8b-instant',
      title: env.GROQ_MODEL_TITLE ?? 'llama-3.1-8b-instant',
      extract: env.GROQ_MODEL_EXTRACT ?? 'llama-3.3-70b-versatile',
      transcribe: env.GROQ_MODEL_TRANSCRIBE ?? 'whisper-large-v3-turbo',
    },
  },
  /**
   * Claude (Anthropic): Haiku 5.5 für fast alles, Sonnet 5.5 nur für schwere Aufgaben (mit Kontingent).
   * Modellnamen und Preise stehen nur hier, damit man sie ohne Code-Änderung anpassen kann.
   */
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    /** leer = https://api.anthropic.com; zum Testen auf einen Mock-Server */
    baseUrl: env.ANTHROPIC_BASE_URL ?? '',
    models: {
      light: env.STELLA_CLAUDE_LIGHT ?? 'claude-haiku-5-5',
      heavy: env.STELLA_CLAUDE_HEAVY ?? 'claude-sonnet-5-5',
    },
    /** strict: true an den Werkzeugen (gültige Argumente garantiert) */
    strictTools: env.STELLA_CLAUDE_STRICT !== 'false',
    /** Pause vor dem einen Wiederholungsversuch bei 429/5xx */
    retryMs: Number(env.STELLA_CLAUDE_RETRY_MS ?? 1500),
  },
  /**
   * Preise in US-Dollar je 1 Mio. Tokens (Stand Oktober 2026). Haiku hat über 100 000 Prompt-Tokens
   * einen höheren Tarif (`long*`). Unbekannte Modelle kosten 0 und zählen nur die Tokens.
   */
  pricing: {
    models: {
      'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longInput: 0.5, longOutput: 2.5, longThreshold: 100_000 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    } as Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number; longInput?: number; longOutput?: number; longThreshold?: number }>,
    /** US-Dollar je Websuche des Claude-Server-Werkzeugs */
    webSearch: 0.01,
    /** Euro je Dollar für die Anzeige in Euro (Dashboard, Einstellungen) */
    eurPerUsd: Number(env.STELLA_EUR_PER_USD ?? 0.92),
  },
  /** "Mit Google anmelden" für Gmail – OAuth-Client aus der Google Cloud Console */
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  },
  /**
   * Funktions-Schalter. Finanzen ist vorerst ausgeblendet (Code, Tabellen und Tests bleiben):
   * mit STELLA_FEATURE_FINANCE=true wieder an.
   */
  features: {
    finance: env.STELLA_FEATURE_FINANCE === 'true',
  },
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

if (!config.secret || config.secret.length < 16) {
  console.warn('⚠️  STELLA_SECRET fehlt oder ist zu kurz – gespeicherte Zugangsdaten sind dann nicht sicher verschlüsselt.');
}
