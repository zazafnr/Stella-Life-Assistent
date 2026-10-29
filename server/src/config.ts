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
  },
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

if (!config.secret || config.secret.length < 16) {
  console.warn('⚠️  STELLA_SECRET fehlt oder ist zu kurz – gespeicherte Zugangsdaten sind dann nicht sicher verschlüsselt.');
}
