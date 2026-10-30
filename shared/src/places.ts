// Läden und Orte für Erledigungen: Welches Wort gehört zu welchem Geschäft, und wie heißt es in OpenStreetMap?
// „Blumen für meine Frau kaufen“ → Blumenladen (shop=florist). Unbekannte Wörter schlägt der Server über Groq vor.

export interface PlaceRef {
  category: string;
  label: string;
}

export interface PlaceKind extends PlaceRef {
  /** Mehrzahl für Überschriften: „Blumenläden in der Nähe“ */
  plural: string;
  emoji: string;
  /** OpenStreetMap-Tag */
  tag: string;
  /** Wörter (kleingeschrieben, ohne Umlaut-Unterschied), die auf dieses Geschäft hindeuten – auch als Wortanfang */
  words: string[];
}

export const PLACE_KINDS: PlaceKind[] = [
  { category: 'florist', label: 'Blumenladen', plural: 'Blumenläden', emoji: '🌸', tag: 'shop=florist', words: ['blume', 'blumen', 'strauss', 'rosen', 'tulpen'] },
  { category: 'pharmacy', label: 'Apotheke', plural: 'Apotheken', emoji: '💊', tag: 'amenity=pharmacy', words: ['apotheke', 'medikament', 'tabletten', 'hustensaft', 'nasenspray', 'rezept'] },
  { category: 'supermarket', label: 'Supermarkt', plural: 'Supermärkte', emoji: '🛒', tag: 'shop=supermarket', words: ['supermarkt', 'lebensmittel', 'einkaufen', 'getränke'] },
  { category: 'bakery', label: 'Bäckerei', plural: 'Bäckereien', emoji: '🥐', tag: 'shop=bakery', words: ['bäcker', 'baecker', 'brot', 'semmel', 'gebäck', 'gebaeck', 'brötchen', 'broetchen', 'kipferl', 'kuchen', 'torte'] },
  { category: 'chemist', label: 'Drogerie', plural: 'Drogerien', emoji: '🧴', tag: 'shop=chemist', words: ['drogerie', 'shampoo', 'zahnpasta', 'duschgel', 'waschmittel', 'deo', 'zahnbürste', 'zahnbuerste'] },
  { category: 'post', label: 'Postamt', plural: 'Postämter', emoji: '📮', tag: 'amenity=post_office', words: ['postamt', 'post', 'paket', 'päckchen', 'paeckchen', 'briefmarke'] },
  { category: 'fuel', label: 'Tankstelle', plural: 'Tankstellen', emoji: '⛽', tag: 'amenity=fuel', words: ['tanken', 'tankstelle', 'benzin', 'diesel'] },
  { category: 'diy', label: 'Baumarkt', plural: 'Baumärkte', emoji: '🔨', tag: 'shop=doityourself', words: ['baumarkt', 'schrauben', 'dübel', 'duebel', 'werkzeug', 'farbe', 'glühbirne', 'gluehbirne'] },
  { category: 'electronics', label: 'Elektronikgeschäft', plural: 'Elektronikgeschäfte', emoji: '🔌', tag: 'shop=electronics', words: ['elektronik', 'ladekabel', 'kabel', 'batterien', 'akku', 'handyhülle', 'handyhuelle'] },
  { category: 'tobacco', label: 'Trafik', plural: 'Trafiken', emoji: '📰', tag: 'shop=tobacco', words: ['trafik', 'zeitung', 'tabak', 'lotto'] },
];

export const placeKind = (category: string): PlaceKind | undefined => PLACE_KINDS.find((k) => k.category === category);

const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Welches Geschäft passt zu diesem Satz? Das erste passende Wort zählt (auch als Wortanfang: „Blumenstrauß“ → Blumen). */
export function placeFor(text: string): PlaceRef | null {
  const tokens = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    for (const k of PLACE_KINDS) {
      if (k.words.some((w) => { const f = fold(w); return token === f || (f.length >= 5 && token.startsWith(f)); })) return { category: k.category, label: k.label };
    }
  }
  return null;
}
