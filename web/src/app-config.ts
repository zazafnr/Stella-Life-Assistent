// Muss in main.tsx als Allererstes importiert werden: legt fest, welche App das ist (Speicher-Schlüssel, Edition).
import { configureApp } from '@stella/web-core/app.ts';

configureApp({ edition: 'life', storagePrefix: 'stella', name: 'Stella' });
