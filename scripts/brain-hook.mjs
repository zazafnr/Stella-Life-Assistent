#!/usr/bin/env node
// SessionStart-Hook (siehe .claude/settings.json): verbindet jede Claude-Sitzung mit dem Projektgedächtnis
// „Stella-Brain“ (Obsidian-Vault, Repo zazafnr/Stella-Brain).
//
// 1. Vault suchen: $STELLA_BRAIN_DIR, sonst ein Ordner „Stella-Brain“ neben diesem Repo oder neben einem Ordner darüber
//    (lokal: Documents/Stella/Stella-Brain, auch aus Worktrees heraus).
// 2. Nicht gefunden → neben das Repo klonen (Cloud-Sitzungen). Gefunden → git pull.
// 3. Den Einstieg (tools/session-start.mjs des Vaults) ausgeben – das landet im Kontext von Claude.
// Darf die Sitzung nie aufhalten: Fehler werden nur gemeldet, Exit-Code immer 0.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const URL = 'https://github.com/zazafnr/Stella-Brain.git';
const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
const run = (cmd, args, cwd, timeout = 30_000) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout });

function find() {
  if (process.env.STELLA_BRAIN_DIR && existsSync(path.join(process.env.STELLA_BRAIN_DIR, '00 Start.md'))) return process.env.STELLA_BRAIN_DIR;
  let dir = REPO;
  for (;;) {
    const cand = path.join(path.dirname(dir), 'Stella-Brain');
    if (existsSync(path.join(cand, '00 Start.md'))) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let brain = find();
let note = '';
if (brain) {
  const r = run('git', ['pull', '--ff-only', '-q'], brain, 20_000);
  if (r.status !== 0) note = `(git pull im Vault ging nicht: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]} – Stand evtl. älter)`;
} else {
  const target = path.join(path.dirname(REPO), 'Stella-Brain');
  let r = run('git', ['clone', '-q', '--depth', '50', URL, target], path.dirname(REPO), 60_000);
  if (r.status !== 0) r = run('gh', ['repo', 'clone', 'zazafnr/Stella-Brain', target, '--', '-q', '--depth', '50'], path.dirname(REPO), 60_000);
  if (existsSync(path.join(target, '00 Start.md'))) brain = target;
  else note = `Klonen fehlgeschlagen: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`;
}

if (brain) {
  const r = run(process.execPath, [path.join(brain, 'tools', 'session-start.mjs'), ...(cloud ? ['--cloud'] : [])], brain);
  process.stdout.write(r.stdout || `Stella-Brain liegt unter ${brain} – Einstieg: 00 Start.md, Regeln: CLAUDE.md\n`);
  if (note) process.stdout.write(`\n${note}\n`);
} else {
  process.stdout.write(`Stella-Brain (Projektgedächtnis, ${URL}) ist in dieser Sitzung nicht erreichbar. ${note}
Arbeite normal mit dem Repo. Am Ende: was sich geändert hat als kurze Notiz in .brain-inbox/YYYY-MM-DD-thema.md
in diesem Repo mitcommitten (siehe .brain-inbox/README.md) – der Vault übernimmt sie automatisch.\n`);
}
process.exit(0);
