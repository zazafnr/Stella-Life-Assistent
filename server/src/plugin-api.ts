// Was ein Edition-Plugin vom Kern benutzen darf – und nichts anderes.
//
// Ein Plugin (z. B. das aus Stella-for-Students) importiert vom Kern **nur Typen**. Alles, was zur Laufzeit gebraucht wird,
// reicht der Server beim Laden als `PluginApi` herein (`export default (api: PluginApi) => EditionPlugin`). So gibt es
// genau eine Datenbank, einen Scheduler und einen Satz Module – auch dann, wenn das Plugin aus einem anderen Ordner
// (Submodul) geladen wird und dort eine gespiegelte Kopie des Kerns liegt.

import { t as translate } from '@stella/shared';
import { deleteSecret, getSecret, hasSecret, HttpError, requireOwner, setSecret } from './auth.ts';
import { config } from './config.ts';
import { addAttachment, addMessage, addReminder, createItem, db, enqueueJob, getItem, getItemByExternalId, getUser, listItems, newId, notifyOnce, now, updateItem, updateUserSettings } from './db.ts';
import { perform, record, levelFor } from './actions.ts';
import { complete } from './llm.ts';
import { dayFor, tr, userLocale, userTerms, voiceOf } from './locale.ts';
import { pushToUser } from './push.ts';
import { mailerConfigured, sendTemplateMail } from './mailer.ts';
import { filePath, saveFile } from './files.ts';
import { consumeQuota } from './billing.ts';
import { resolveTier } from './router.ts';
import { hasFeature, isSchool } from './profile.ts';
import { toHhmm, toMin } from './context.ts';
import { notify } from './channels/deliver.ts';
import { assertPublicUrl, fetchText } from './news/net.ts';
import { addItem, bookFor, bookForItem, changeItem } from './planner.ts';

export type { EditionPlugin, PluginTool, PluginToolContext, Lesson, PluginMigration } from './editions/registry.ts';
export type { User, UserSettings, BookProvider, BookConfig, NewItem } from './db.ts';
export type { ContentPart } from './llm-types.ts';
export type { ActionType, ActionParams, Performed } from './actions.ts';
export type { Lagebild, DayContext, Busy, Interval } from './context.ts';
export type { ToolDef, LlmMessage } from './llm-types.ts';

export const pluginApi = {
  db,
  config,
  HttpError,
  getUser, updateUserSettings,
  now, newId,
  addAttachment, addReminder, getItemByExternalId,
  addMessage,
  createItem, updateItem, getItem, listItems,
  /** Eintrag mit Erinnerungen anlegen/ändern (statt `createItem`/`updateItem`) */
  addItem, changeItem, bookFor, bookForItem,
  /** Aktionen mit Rechte-Stufe, Karte und Rückgängig */
  perform, record, levelFor,
  notify, notifyOnce,
  /** KI-Aufruf mit Kosten-Router; für private Inhalte immer `private: true` */
  complete,
  getSecret, setSecret, hasSecret, deleteSecret, requireOwner,
  /** Sprache, Begriffe und Ton der Nutzerin */
  userLocale, userTerms, voiceOf, dayFor,
  pushToUser, mailerConfigured, sendTemplateMail,
  saveFile, filePath,
  /** Abo-Kontingent und Modellwahl (Profi-Aufgaben) */
  consumeQuota, resolveTier,
  hasFeature, isSchool,
  toMin, toHhmm,
  /** Text aus dem Sprachkatalog in der Sprache der Nutzerin */
  tr, t: translate,
  enqueueJob,
  /** Abruf fremder Adressen mit Schutz vor dem internen Netz – für jede Adresse, die Nutzer:innen eintragen können (ICS-Abo!) */
  assertPublicUrl, fetchText,
};

export type PluginApi = typeof pluginApi;
