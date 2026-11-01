// Schreibt die übersetzten Begründungstexte (Kamera, Fotos, Bewegung, Mikrofon, Standort) als InfoPlist.strings für das Xcode-Projekt
// (ios/Resources/<sprache>.lproj/InfoPlist.strings). Im .swiftpm bleiben sie englisch (Package.swift).
//   npx tsx scripts/gen-infoplist.ts          schreiben
//   npx tsx scripts/gen-infoplist.ts --check  nur prüfen (CI)
// Der Standort-Text nennt nur, wofür Stella ihn wirklich nutzt (Apple-Richtlinie 5.1.1).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LOCALES, type Locale } from '../shared/src/index.ts';

type Key = 'NSCameraUsageDescription' | 'NSPhotoLibraryUsageDescription' | 'NSMotionUsageDescription' | 'NSMicrophoneUsageDescription' | 'NSLocationWhenInUseUsageDescription';

const TEXTS: Record<Locale, Record<Key, string>> = {
  en: {
    NSCameraUsageDescription: 'Take photos of worksheets and notebook entries so Stella can read them.',
    NSPhotoLibraryUsageDescription: 'Choose photos of worksheets for Stella.',
    NSMotionUsageDescription: 'Stella counts your steps for your daily goal.',
    NSMicrophoneUsageDescription: 'Stella records your voice messages so you do not have to type.',
    NSLocationWhenInUseUsageDescription: 'Stella uses your location only while you use the app: to show shops and pharmacies nearby for your errands, to find restaurants and prepare reservations, and to add weather and local news to your morning briefing. Your exact location is not stored.',
  },
  de: {
    NSCameraUsageDescription: 'Fotografiere Arbeitsblätter und Hefteinträge, damit Stella sie lesen kann.',
    NSPhotoLibraryUsageDescription: 'Wähle Fotos von Arbeitsblättern für Stella aus.',
    NSMotionUsageDescription: 'Stella zählt deine Schritte für dein Tagesziel.',
    NSMicrophoneUsageDescription: 'Stella nimmt deine Sprachnachrichten auf, damit du nicht tippen musst.',
    NSLocationWhenInUseUsageDescription: 'Stella nutzt deinen Standort nur, während du die App benutzt: um Läden und Apotheken in der Nähe für deine Erledigungen zu zeigen, Restaurants zu finden und Reservierungen vorzubereiten und um Wetter und lokale News in dein Morgen-Briefing zu holen. Dein genauer Standort wird nicht gespeichert.',
  },
  es: {
    NSCameraUsageDescription: 'Haz fotos de hojas de ejercicios y apuntes para que Stella pueda leerlos.',
    NSPhotoLibraryUsageDescription: 'Elige fotos de hojas de ejercicios para Stella.',
    NSMotionUsageDescription: 'Stella cuenta tus pasos para tu meta diaria.',
    NSMicrophoneUsageDescription: 'Stella graba tus mensajes de voz para que no tengas que escribir.',
    NSLocationWhenInUseUsageDescription: 'Stella usa tu ubicación solo mientras usas la app: para mostrar tiendas y farmacias cercanas para tus recados, encontrar restaurantes y preparar reservas, y añadir el tiempo y noticias locales a tu resumen matinal. Tu ubicación exacta no se guarda.',
  },
  fr: {
    NSCameraUsageDescription: 'Prends en photo des feuilles d’exercices et des notes de cahier pour que Stella puisse les lire.',
    NSPhotoLibraryUsageDescription: 'Choisis des photos de feuilles d’exercices pour Stella.',
    NSMotionUsageDescription: 'Stella compte tes pas pour ton objectif du jour.',
    NSMicrophoneUsageDescription: 'Stella enregistre tes messages vocaux pour que tu n’aies pas à écrire.',
    NSLocationWhenInUseUsageDescription: 'Stella utilise ta position uniquement pendant que tu utilises l’app : pour montrer les magasins et pharmacies à proximité pour tes courses, trouver des restaurants et préparer des réservations, et ajouter la météo et les infos locales à ton briefing du matin. Ta position exacte n’est pas enregistrée.',
  },
  it: {
    NSCameraUsageDescription: 'Fotografa fogli di esercizi e appunti del quaderno così Stella può leggerli.',
    NSPhotoLibraryUsageDescription: 'Scegli foto di fogli di esercizi per Stella.',
    NSMotionUsageDescription: 'Stella conta i tuoi passi per il tuo obiettivo giornaliero.',
    NSMicrophoneUsageDescription: 'Stella registra i tuoi messaggi vocali così non devi scrivere.',
    NSLocationWhenInUseUsageDescription: 'Stella usa la tua posizione solo mentre usi l’app: per mostrare negozi e farmacie vicini per le tue commissioni, trovare ristoranti e preparare prenotazioni, e aggiungere meteo e notizie locali al tuo briefing del mattino. La tua posizione esatta non viene salvata.',
  },
  'pt-BR': {
    NSCameraUsageDescription: 'Fotografe folhas de exercícios e anotações do caderno para a Stella poder lê-las.',
    NSPhotoLibraryUsageDescription: 'Escolha fotos de folhas de exercícios para a Stella.',
    NSMotionUsageDescription: 'A Stella conta seus passos para a sua meta diária.',
    NSMicrophoneUsageDescription: 'A Stella grava suas mensagens de voz para você não precisar digitar.',
    NSLocationWhenInUseUsageDescription: 'A Stella usa sua localização apenas enquanto você usa o app: para mostrar lojas e farmácias por perto para seus recados, encontrar restaurantes e preparar reservas, e incluir clima e notícias locais no seu resumo da manhã. Sua localização exata não é guardada.',
  },
  tr: {
    NSCameraUsageDescription: 'Stella okuyabilsin diye çalışma kâğıtlarının ve defter notlarının fotoğrafını çek.',
    NSPhotoLibraryUsageDescription: 'Stella için çalışma kâğıtlarının fotoğraflarını seç.',
    NSMotionUsageDescription: 'Stella günlük hedefin için adımlarını sayar.',
    NSMicrophoneUsageDescription: 'Stella, yazmak zorunda kalmaman için sesli mesajlarını kaydeder.',
    NSLocationWhenInUseUsageDescription: 'Stella konumunu yalnızca uygulamayı kullandığın sürece kullanır: işlerin için yakındaki dükkânları ve eczaneleri göstermek, restoran bulup rezervasyon hazırlamak ve sabah özetine hava durumu ile yerel haberleri eklemek için. Tam konumun saklanmaz.',
  },
  pl: {
    NSCameraUsageDescription: 'Rób zdjęcia kart pracy i notatek z zeszytu, żeby Stella mogła je czytać.',
    NSPhotoLibraryUsageDescription: 'Wybieraj zdjęcia kart pracy dla Stelli.',
    NSMotionUsageDescription: 'Stella liczy twoje kroki na potrzeby dziennego celu.',
    NSMicrophoneUsageDescription: 'Stella nagrywa twoje wiadomości głosowe, żeby nie trzeba było pisać.',
    NSLocationWhenInUseUsageDescription: 'Stella używa twojej lokalizacji tylko wtedy, gdy korzystasz z aplikacji: aby pokazać pobliskie sklepy i apteki przy sprawunkach, znaleźć restauracje i przygotować rezerwacje oraz dodać pogodę i lokalne wiadomości do porannego briefingu. Twoja dokładna lokalizacja nie jest zapisywana.',
  },
};

const lproj = (l: Locale) => new URL(`../ios/Resources/${l}.lproj/InfoPlist.strings`, import.meta.url);
const render = (l: Locale) => `/* ERZEUGT von scripts/gen-infoplist.ts – nicht von Hand ändern. */\n${(Object.entries(TEXTS[l]) as [Key, string][]).map(([k, v]) => `"${k}" = "${v.replace(/"/g, '\\"')}";`).join('\n')}\n`;

if (process.argv.includes('--check')) {
  const stale = LOCALES.filter((l) => !existsSync(lproj(l)) || readFileSync(lproj(l), 'utf8') !== render(l));
  if (stale.length) { console.error(`InfoPlist.strings nicht aktuell (${stale.join(', ')}). Bitte \`npx tsx scripts/gen-infoplist.ts\` ausführen und committen.`); process.exit(1); }
  console.log('InfoPlist.strings sind aktuell.');
} else {
  for (const l of LOCALES) { mkdirSync(new URL(`../ios/Resources/${l}.lproj/`, import.meta.url), { recursive: true }); writeFileSync(lproj(l), render(l)); }
  console.log(`geschrieben: ios/Resources/*.lproj/InfoPlist.strings (${LOCALES.length} Sprachen)`);
}
