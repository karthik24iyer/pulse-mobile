// Backup and restore of everything the person enters by hand (Pulse+): the profile and its photo, the Journal's
// behaviours and answers, the entries logged in Pulse (water, food, weight, body fat, SpO2, moods, symptoms, cycle),
// the coach's chats, and the device settings they chose (Dashboard, Goals, Weekly plan, nutrition targets,
// notifications, language, theme, breathing and workout logs, the coach's setup). Nothing read from Health Connect is
// in it: a new install re-imports that. The coach's API key stays out (it lives in the keystore, and a backup file is
// not a place for secrets).
//
// Restoring merges: every row in the file is added, or overwrites the row with the same key (a journal answer's day
// and behaviour, a log entry's or chat's id); nothing already on the phone is deleted. It also reads the Journal export
// of Pulse Mobile (Your data › Journal › JSON: `{ behaviours, entries }`), so answers move over from the original app.
//
// Plain TypeScript over the Store, so the tests run in Node; src/actions/backup.ts does the files and the settings.
import type { LoggedEntryRow, Store, JournalTagRow } from "@/data/store";
import type { JournalEntry, Profile } from "@/data/types";
import { LOG_TYPES } from "./_lib";

export const BACKUP_FORMAT = "pulse-backup";
export const BACKUP_VERSION = 1;

/** The device settings a backup carries: the person's own choices only (no sync tokens, caches or markers). */
export const BACKUP_SETTING_KEYS = [
  "pulse.dashboard",
  "pulse.goals",
  "pulse.weeklyPlan",
  "pulse.nutrition.targets",
  "pulse.background.settings",
  "pulse.language",
  "pulse.theme",
  "pulse.breathe.log",
  "pulse.workout.log",
  "pulse.breathe.haptics",
  "pulse.workout.haptics",
  "pulse.coach.setup",
  "pulse.update.check",
] as const;

export type BackupChat = { id: string; title: string; updatedAt: number; messages: unknown[] };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO time the file was made, and the app that made it. */
  createdAt: string;
  app: string;
  /** Without `photo` (the file URI is this phone's); the photo itself is `photo`, base64 JPEG. */
  profile: Omit<Profile, "photo"> | null;
  photo: string | null;
  journal: { behaviours: JournalTagRow[]; entries: JournalEntry[] };
  /** Entries logged in Pulse (source "pulse"); Health Connect's come back with the next sync. */
  logs: LoggedEntryRow[];
  coachChats: BackupChat[];
  settings: Record<string, string>;
};

export class BackupError extends Error {
  constructor(public code: "not_json" | "not_backup" | "newer_version" | "empty") {
    super(code);
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isTag = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;
const isAnswer = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const LOG_TYPE_SET = new Set<string>(LOG_TYPES);
/** loggedEntries' limit that means every entry (its default is 50). */
const ALL = 1_000_000_000;

/** Everything entered by hand, from the store, plus the settings and photo the caller read. */
export async function buildBackup(
  store: Store,
  extra: { settings: Record<string, string | null>; photo: string | null; createdAt: string; app: string },
): Promise<Backup> {
  const [profile, behaviours, entries, logs] = await Promise.all([store.getProfile(), store.journalTags(), store.allJournal(), store.loggedEntries(Number.MIN_SAFE_INTEGER, ALL)]);
  const chats: BackupChat[] = [];
  let before: { updatedAt: number; id: string } | undefined;
  for (;;) {
    const page = await store.coachChats(50, before);
    for (const c of page) chats.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: (await store.coachChatMessages(c.id)) ?? [] });
    if (page.length < 50) break;
    const last = page[page.length - 1];
    before = { updatedAt: last.updatedAt, id: last.id };
  }
  let ownProfile: Omit<Profile, "photo"> | null = null;
  if (profile) {
    const { photo: _photo, ...rest } = profile;
    ownProfile = rest;
  }
  const settings: Record<string, string> = {};
  for (const k of BACKUP_SETTING_KEYS) {
    const v = extra.settings[k];
    if (typeof v === "string") settings[k] = v;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: extra.createdAt,
    app: extra.app,
    profile: ownProfile,
    photo: extra.photo,
    journal: {
      behaviours,
      entries: [...entries].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)),
    },
    logs: logs.filter((l) => l.source === "pulse").sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)),
    coachChats: chats,
    settings,
  };
}

/** Behaviour rows from either format, keeping only well-formed ones; positions follow the file's order when absent. */
function behavioursOf(xs: unknown): JournalTagRow[] {
  if (!Array.isArray(xs)) return [];
  const out: JournalTagRow[] = [];
  xs.forEach((x, i) => {
    if (!isObj(x) || !isTag(x.tag)) return;
    const label = typeof x.label === "string" && x.label.trim() ? x.label.slice(0, 64) : x.tag;
    // A backup's rows carry isDefault; Pulse Mobile's journal export says custom.
    const isDefault = typeof x.isDefault === "boolean" ? x.isDefault : typeof x.custom === "boolean" ? !x.custom : false;
    const position = typeof x.position === "number" && Number.isFinite(x.position) ? x.position : i;
    out.push({ tag: x.tag, label, isDefault, hidden: x.hidden === true, position });
  });
  return out;
}

/**
 * The file's contents as a Backup: a Pulse+ backup, or Pulse Mobile's journal export (`{ behaviours, entries }` with
 * `{ day, behaviour, label, answer }` rows), which becomes a backup holding just the Journal. Malformed rows are left out.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("not_json");
  }
  if (!isObj(raw)) throw new BackupError("not_backup");

  if (raw.format !== BACKUP_FORMAT) {
    // Pulse Mobile's journal export.
    if (!Array.isArray(raw.entries) || !Array.isArray(raw.behaviours)) throw new BackupError("not_backup");
    const entries = raw.entries.flatMap((e): JournalEntry[] => (isObj(e) && isDay(e.day) && isTag(e.behaviour) && isAnswer(e.answer) ? [{ day: e.day, tag: e.behaviour, value: e.answer }] : []));
    const behaviours = behavioursOf(raw.behaviours);
    if (!entries.length && !behaviours.length) throw new BackupError("empty");
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: "", app: "pulse-journal-export", profile: null, photo: null, journal: { behaviours, entries }, logs: [], coachChats: [], settings: {} };
  }

  if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION) throw new BackupError("newer_version");
  const journal = isObj(raw.journal) ? raw.journal : {};
  const entries = (Array.isArray(journal.entries) ? journal.entries : []).flatMap((e): JournalEntry[] =>
    isObj(e) && isDay(e.day) && isTag(e.tag) && isAnswer(e.value) ? [{ day: e.day, tag: e.tag, value: e.value }] : [],
  );
  const logs = (Array.isArray(raw.logs) ? raw.logs : []).flatMap((l): LoggedEntryRow[] =>
    isObj(l) && typeof l.id === "string" && l.id && typeof l.type === "string" && LOG_TYPE_SET.has(l.type) && typeof l.ts === "number" && Number.isFinite(l.ts) && isDay(l.day)
      ? [{ id: l.id, type: l.type, ts: l.ts, day: l.day, data: l.data ?? null, createdAt: typeof l.createdAt === "number" ? l.createdAt : l.ts, source: "pulse" }]
      : [],
  );
  const coachChats = (Array.isArray(raw.coachChats) ? raw.coachChats : []).flatMap((c): BackupChat[] =>
    isObj(c) && typeof c.id === "string" && c.id && Array.isArray(c.messages)
      ? [{ id: c.id, title: typeof c.title === "string" ? c.title : "", updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0, messages: c.messages }]
      : [],
  );
  const settings: Record<string, string> = {};
  if (isObj(raw.settings)) for (const k of BACKUP_SETTING_KEYS) if (typeof raw.settings[k] === "string") settings[k] = raw.settings[k] as string;
  const p = raw.profile;
  const profile = isObj(p) && isDay(p.birthDate) && (p.sex === "male" || p.sex === "female") && typeof p.timeZone === "string" ? (p as Omit<Profile, "photo">) : null;
  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    app: typeof raw.app === "string" ? raw.app : "",
    profile,
    photo: typeof raw.photo === "string" && raw.photo ? raw.photo : null,
    journal: { behaviours: behavioursOf(journal.behaviours), entries },
    logs,
    coachChats,
    settings,
  };
}

export type RestoreSummary = { behaviours: number; answers: number; logs: number; chats: number; settings: number; profile: boolean; photo: boolean };

/**
 * Writes a backup's rows into the store (merging, never deleting) and marks the journal's days for rescoring. The
 * profile, the photo and the settings are the caller's to apply (they live outside the store).
 */
export async function applyBackup(store: Store, b: Backup): Promise<RestoreSummary> {
  const { behaviours, entries } = b.journal;
  // Behaviours first, so every answer's behaviour exists: new ones are added, then every one in the file takes its
  // hidden flag and place.
  if (behaviours.length) {
    await store.insertJournalTags(behaviours);
    await store.updateJournalTags(behaviours.map((t) => ({ tag: t.tag, hidden: t.hidden, position: t.position })));
  }
  // An answer whose behaviour the file doesn't list and the phone doesn't know gets a behaviour named after its key.
  const known = new Set((await store.journalTags()).map((t) => t.tag));
  const missing = [...new Set(entries.map((e) => e.tag).filter((t) => !known.has(t)))];
  if (missing.length) {
    const top = Math.max(-1, ...(await store.journalTags()).map((t) => t.position));
    await store.insertJournalTags(missing.map((tag, i) => ({ tag, label: tag, isDefault: false, hidden: false, position: top + 1 + i })));
  }
  for (const e of entries) await store.setJournal(e);
  const days = [...new Set(entries.map((e) => e.day))].sort();
  if (days.length) await store.markIntradayDirty(days);
  if (b.logs.length) await store.addLoggedEntries(b.logs.map((l) => ({ ...l, source: "pulse" })));
  for (const c of b.coachChats) await store.putCoachChat(c.id, c.title, c.messages, c.updatedAt);
  return {
    behaviours: behaviours.length + missing.length,
    answers: entries.length,
    logs: b.logs.length,
    chats: b.coachChats.length,
    settings: Object.keys(b.settings).length,
    profile: b.profile != null,
    photo: b.photo != null,
  };
}
