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
  /** "Mit Google anmelden" für Gmail – OAuth-Client aus der Google Cloud Console */
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  },
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

if (!config.secret || config.secret.length < 16) {
  console.warn('⚠️  STELLA_SECRET fehlt oder ist zu kurz – gespeicherte Zugangsdaten sind dann nicht sicher verschlüsselt.');
}
