// Konten gehören zu genau einer Edition. Wer sich auf der falschen Oberfläche anmeldet, bekommt 409 mit klarer Meldung
// und dem Link zur richtigen App – nie einen Zugang.

import { HttpError } from '../auth.ts';
import { config } from '../config.ts';
import type { User } from '../db.ts';
import { tr } from '../locale.ts';
import { requestEdition, type Edition } from './registry.ts';

export const editionUrl = (edition: Edition) => (edition === 'students' ? config.studentsUrl : config.publicUrl);

/** Wirft 409, wenn das Konto nicht zur Oberfläche gehört, auf der es sich anmeldet. */
export function assertEdition(user: Pick<User, 'edition' | 'settings'>, requested: Edition): void {
  if (user.edition === requested) return;
  throw new HttpError(409, tr(user as User, `auth.wrongEdition.${user.edition}`), {
    code: 'wrong_edition', edition: user.edition, url: editionUrl(user.edition),
  });
}

/** Kurzform für Routen: Oberfläche der Anfrage gegen das Konto prüfen. */
export const assertRequestEdition = (user: User, req: Parameters<typeof requestEdition>[0]) => assertEdition(user, requestEdition(req));
