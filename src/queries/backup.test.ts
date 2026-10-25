// Backup and restore of what the person entered (Pulse+), on the in-memory Store.
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { LoggedEntryRow } from "@/data/store";
import type { Profile } from "@/data/types";
import { applyBackup, BACKUP_FORMAT, BackupError, buildBackup, parseBackup } from "./backup";
import { ensureDefaultTags } from "./journal";
import { exportFile } from "./settings";
import type { QueryCtx } from "./ctx";

const PROFILE: Profile = { birthDate: "1990-06-15", sex: "male", maxHr: 188, heightCm: 175, timeZone: "Asia/Kolkata", name: "K", photo: "file:///avatar/1.jpg", sleepGoal: { hours: 8, method: "manual" } };
const EXTRA = { settings: { "pulse.goals": '{"steps":9000}', "pulse.hc.changesToken": "secret-ish", "pulse.theme": "dark" }, photo: "BASE64JPEG", createdAt: "2026-10-25T12:00:00.000Z", app: "Pulse+ test" };

const log = (id: string, type: string, ts: number, source: "pulse" | "health_connect" = "pulse"): LoggedEntryRow => ({ id, type, ts, day: "2026-10-20", data: { v: id }, createdAt: ts, source });

async function filled() {
  const store = new MemoryStore();
  await store.setProfile(PROFILE);
  await ensureDefaultTags(store);
  await store.insertJournalTags([{ tag: "cold_shower", label: "Cold shower", isDefault: false, hidden: false, position: 99 }]);
  const tags = await store.journalTags();
  await store.setJournal({ day: "2026-10-20", tag: tags[0].tag, value: 1 });
  await store.setJournal({ day: "2026-10-21", tag: "cold_shower", value: 0 });
  await store.addLoggedEntries([log("w1", "hydration-log", 1_800_000_000), log("m1", "moods", 1_800_000_100), log("hc1", "nutrition-log", 1_800_000_200, "health_connect")]);
  // More than loggedEntries' default page of 50.
  await store.addLoggedEntries(Array.from({ length: 60 }, (_, i) => log(`n${i}`, "nutrition-log", 1_700_000_000 + i)));
  await store.putCoachChat("c1", "Sleep question", [{ role: "user", parts: [{ type: "text", text: "hi" }] }], 1_800_000_300);
  return store;
}

describe("buildBackup", () => {
  it("holds everything entered by hand, and nothing imported or secret", async () => {
    const b = await buildBackup(await filled(), EXTRA);
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.profile).toMatchObject({ birthDate: "1990-06-15", maxHr: 188, sleepGoal: { hours: 8, method: "manual" } });
    expect(b.profile).not.toHaveProperty("photo");
    expect(b.photo).toBe("BASE64JPEG");
    expect(b.journal.entries).toHaveLength(2);
    expect(b.journal.behaviours.some((t) => t.tag === "cold_shower" && !t.isDefault)).toBe(true);
    expect(b.logs.map((l) => l.id)).not.toContain("hc1");
    expect(b.logs).toHaveLength(62);
    expect(b.coachChats).toEqual([{ id: "c1", title: "Sleep question", updatedAt: 1_800_000_300, messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] }]);
    expect(b.settings).toEqual({ "pulse.goals": '{"steps":9000}', "pulse.theme": "dark" });
  });
});

describe("restore", () => {
  it("round-trips into an empty phone", async () => {
    const text = JSON.stringify(await buildBackup(await filled(), EXTRA));
    const fresh = new MemoryStore();
    await fresh.setProfile({ ...PROFILE, name: null, photo: null });
    await ensureDefaultTags(fresh);
    const b = parseBackup(text);
    const s = await applyBackup(fresh, b);
    expect(s).toMatchObject({ answers: 2, logs: 62, chats: 1, settings: 2, profile: true, photo: true });
    expect(await fresh.allJournal()).toHaveLength(2);
    expect((await fresh.journalTags()).some((t) => t.tag === "cold_shower")).toBe(true);
    expect(await fresh.loggedEntries(0, 1000)).toHaveLength(62);
    expect(await fresh.coachChatMessages("c1")).toHaveLength(1);
    expect(b.profile?.name).toBe("K");
  });

  it("merges: never deletes what the phone already has; the file wins on the same key", async () => {
    const phone = new MemoryStore();
    await phone.setProfile(PROFILE);
    await ensureDefaultTags(phone);
    await phone.insertJournalTags([{ tag: "cold_shower", label: "Cold shower", isDefault: false, hidden: false, position: 99 }]);
    await phone.setJournal({ day: "2026-10-21", tag: "cold_shower", value: 1 });
    await phone.setJournal({ day: "2026-10-22", tag: "cold_shower", value: 1 });
    await phone.addLoggedEntries([log("keep", "weight", 1_800_000_500)]);
    await applyBackup(phone, parseBackup(JSON.stringify(await buildBackup(await filled(), EXTRA))));
    const answers = await phone.allJournal();
    expect(answers.find((e) => e.day === "2026-10-21")?.value).toBe(0);
    expect(answers.find((e) => e.day === "2026-10-22")?.value).toBe(1);
    expect((await phone.loggedEntries(0, 1000)).some((l) => l.id === "keep")).toBe(true);
  });

  it("reads Pulse Mobile's Journal JSON export, including custom behaviours", async () => {
    const source = await filled();
    const ctx: QueryCtx = { store: source, profile: PROFILE, timeZone: PROFILE.timeZone, today: "2026-10-25", now: 1_800_000_000, sync: { lastSyncTs: null, firstDay: null, lastError: null } };
    const file = await exportFile(ctx, "journal", "json");
    const b = parseBackup(file.body);
    expect(b.journal.entries).toHaveLength(2);
    expect(b.profile).toBeNull();
    expect(b.logs).toEqual([]);
    const fresh = new MemoryStore();
    await ensureDefaultTags(fresh);
    await applyBackup(fresh, b);
    expect(await fresh.allJournal()).toEqual(expect.arrayContaining([{ day: "2026-10-21", tag: "cold_shower", value: 0 }]));
    expect((await fresh.journalTags()).find((t) => t.tag === "cold_shower")?.label).toBe("Cold shower");
  });

  it("an answer whose behaviour is unknown gets one, so it is never lost", async () => {
    const fresh = new MemoryStore();
    await applyBackup(fresh, parseBackup(JSON.stringify({ behaviours: [], entries: [{ day: "2026-10-01", behaviour: "sauna", label: "Sauna", answer: 1 }] })));
    expect((await fresh.journalTags()).map((t) => t.tag)).toContain("sauna");
    expect(await fresh.allJournal()).toEqual([{ day: "2026-10-01", tag: "sauna", value: 1 }]);
  });

  it("leaves malformed rows out and refuses what isn't a backup", () => {
    const b = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, journal: { behaviours: [], entries: [{ day: "2026-02-31", tag: "x", value: 1 }, { day: "2026-02-01", tag: "x", value: 1.5 }, { day: "2026-02-01", tag: "x", value: 2 }] }, logs: [{ id: "a", type: "not-a-type", ts: 1, day: "2026-02-01" }] }));
    expect(b.journal.entries).toEqual([{ day: "2026-02-01", tag: "x", value: 2 }]);
    expect(b.logs).toEqual([]);
    const code = (text: string) => {
      try {
        parseBackup(text);
        return null;
      } catch (e) {
        return e instanceof BackupError ? e.code : "other";
      }
    };
    expect(code("{nope")).toBe("not_json");
    expect(code("[1,2]")).toBe("not_backup");
    expect(code(JSON.stringify({ hello: 1 }))).toBe("not_backup");
    expect(code(JSON.stringify({ format: BACKUP_FORMAT, version: 99 }))).toBe("newer_version");
    expect(code(JSON.stringify({ behaviours: [], entries: [] }))).toBe("empty");
  });
});
