// Was ein Edition-Plugin vom Kern benutzen darf – und nichts anderes.
//
// Ein Plugin (z. B. das aus Stella-for-Students) importiert vom Kern **nur Typen**. Alles, was zur Laufzeit gebraucht wird,
// reicht der Server beim Laden als `PluginApi` herein (`export default (api: PluginApi) => EditionPlugin`). So gibt es
// genau eine Datenbank, einen Scheduler und einen Satz Module – auch dann, wenn das Plugin aus einem anderen Ordner
// (Submodul) geladen wird und dort eine gespiegelte Kopie des Kerns liegt.

import { t as translate } from '@stella/shared';
import { getSecret, HttpError, setSecret } from './auth.ts';
import { config } from './config.ts';
import { addMessage, createItem, db, enqueueJob, getItem, getUser, listItems, notifyOnce, updateItem, updateUserSettings } from './db.ts';
import { perform, record, levelFor } from './actions.ts';
import { complete } from './llm.ts';
import { tr } from './locale.ts';
import { notify } from './channels/deliver.ts';
import { assertPublicUrl, fetchText } from './news/net.ts';
import { addItem, changeItem } from './planner.ts';

export type { EditionPlugin, PluginTool, PluginToolContext, Lesson, PluginMigration } from './editions/registry.ts';
export type { User, UserSettings } from './db.ts';
export type { ActionType, ActionParams, Performed } from './actions.ts';
export type { Lagebild, DayContext, Busy, Interval } from './context.ts';
export type { ToolDef, LlmMessage } from './llm-types.ts';

export const pluginApi = {
  db,
  config,
  HttpError,
  getUser, updateUserSettings,
  addMessage,
  createItem, updateItem, getItem, listItems,
  /** Eintrag mit Erinnerungen anlegen/ändern (statt `createItem`/`updateItem`) */
  addItem, changeItem,
  /** Aktionen mit Rechte-Stufe, Karte und Rückgängig */
  perform, record, levelFor,
  notify, notifyOnce,
  /** KI-Aufruf mit Kosten-Router; für private Inhalte immer `private: true` */
  complete,
  getSecret, setSecret,
  /** Text aus dem Sprachkatalog in der Sprache der Nutzerin */
  tr, t: translate,
  enqueueJob,
  /** Abruf fremder Adressen mit Schutz vor dem internen Netz – für jede Adresse, die Nutzer:innen eintragen können (ICS-Abo!) */
  assertPublicUrl, fetchText,
};

export type PluginApi = typeof pluginApi;
