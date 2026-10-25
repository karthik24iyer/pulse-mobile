// Backup and restore (Pulse+, Your data › Backup): everything entered by hand as one JSON file through the share
// sheet, and back from a file picked with the document picker (a Pulse+ backup, or Pulse Mobile's Journal JSON export).
// The rows and the format are src/queries/backup.ts; this file does the files, the device settings and the rescore.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { i18n } from "@/i18n/config";
import { applyBackup, BACKUP_SETTING_KEYS, BackupError, buildBackup, parseBackup, type RestoreSummary } from "@/queries/backup";
import { APP_VERSION } from "@/queries/settings";
import { appState, appStore, dataChanged, refresh, saveProfile, setPhoto } from "@/state/app";
import type { ActionResult } from "./journal";
import { photoBase64, savePhotoBase64 } from "./photo";

const today = () => new Date().toISOString().slice(0, 10);

/** Builds the backup and opens the share sheet with it ("pulse-backup-<date>.json"). */
export async function shareBackup(): Promise<ActionResult> {
  try {
    const store = appStore();
    const pairs = await AsyncStorage.multiGet([...BACKUP_SETTING_KEYS]);
    const photoUri = appState().profile?.photo ?? null;
    const backup = await buildBackup(store, {
      settings: Object.fromEntries(pairs),
      photo: photoUri ? await photoBase64(photoUri) : null,
      createdAt: new Date().toISOString(),
      app: `Pulse+ ${APP_VERSION}`,
    });
    const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: i18n.t("errors:export.sharingUnavailable") };
    const name = `pulse-backup-${today()}.json`;
    const out = new File(Paths.cache, name);
    out.create({ overwrite: true });
    out.write(JSON.stringify(backup, null, 2));
    await Sharing.shareAsync(out.uri, { mimeType: "application/json", dialogTitle: name });
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: i18n.t("errors:export.failed") };
  }
}

/**
 * Picks a file and restores it: rows merged into the store, settings written, the photo saved, the profile (kept in
 * this phone's time zone) saved, then the scores rerun so Journal insights include the restored answers. Null data when
 * the picker was cancelled.
 */
export async function restoreBackup(): Promise<ActionResult<RestoreSummary | null>> {
  let text: string;
  try {
    const [DocumentPicker, { File }] = await Promise.all([import("expo-document-picker"), import("expo-file-system")]);
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "*/*"], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return { ok: true, data: null };
    text = await new File(r.assets[0].uri).text();
  } catch {
    return { ok: false, error: i18n.t("errors:backup.unreadable") };
  }
  try {
    const backup = parseBackup(text);
    const summary = await applyBackup(appStore(), backup);
    const settings = Object.entries(backup.settings);
    if (settings.length) await AsyncStorage.multiSet(settings);
    const current = appState().profile;
    if (backup.profile && current) {
      const photo = backup.photo ? savePhotoBase64(backup.photo) : null;
      // saveProfile reruns the scores (the restored birth date, sex, max HR or sleep goal can move them).
      await saveProfile({ ...current, ...backup.profile, timeZone: current.timeZone, photo: current.photo ?? null });
      if (photo) await setPhoto(photo);
    } else {
      dataChanged();
      void refresh();
    }
    return { ok: true, data: summary };
  } catch (e) {
    if (e instanceof BackupError) return { ok: false, error: i18n.t(`errors:backup.${e.code}`) };
    return { ok: false, error: i18n.t("errors:backup.failed") };
  }
}
