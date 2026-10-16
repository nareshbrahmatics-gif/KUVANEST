import * as MediaLibrary from "expo-media-library";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import * as Network from "expo-network";
import * as Battery from "expo-battery";
import { api, loadToken } from "./api";

export const BACKUP_TASK = "kuvanest-camera-backup";
const BATCH = 25;

export const getBackupState = async () => ({
  enabled: (await SecureStore.getItemAsync("kn_backup_on")) === "1",
  last: Number((await SecureStore.getItemAsync("kn_backup_last")) || 0),
  lastRun: Number((await SecureStore.getItemAsync("kn_backup_ran")) || 0),
  wifiOnly: (await SecureStore.getItemAsync("kn_backup_wifi")) !== "0",
  chargingOnly: (await SecureStore.getItemAsync("kn_backup_charge")) === "1",
});

export const setBackupOption = (key, on) => SecureStore.setItemAsync(key === "wifiOnly" ? "kn_backup_wifi" : "kn_backup_charge", on ? "1" : "0");

// Returns a reason string when conditions block backup, otherwise null.
export async function blockedReason({ wifiOnly, chargingOnly }) {
  if (wifiOnly) {
    const net = await Network.getNetworkStateAsync();
    if (net.type !== Network.NetworkStateType.WIFI && net.type !== Network.NetworkStateType.ETHERNET) return "Waiting for Wi-Fi";
  }
  if (chargingOnly) {
    const b = await Battery.getBatteryStateAsync();
    if (b !== Battery.BatteryState.CHARGING && b !== Battery.BatteryState.FULL) return "Waiting for charger";
  }
  return null;
}

const listeners = new Set();
let progress = { running: false, done: 0, total: 0, failed: 0 };
const emit = (p) => { progress = { ...progress, ...p }; listeners.forEach((fn) => fn(progress)); };
export const subscribeProgress = (fn) => { listeners.add(fn); fn(progress); return () => listeners.delete(fn); };

const pending = async (last, first) => MediaLibrary.getAssetsAsync({
  mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
  sortBy: [[MediaLibrary.SortBy.creationTime, true]],
  createdAfter: last || undefined,
  first,
});

// Uploads photos/videos created after the last synced one, oldest first, so an interrupted run resumes cleanly.
// Foreground runs drain everything; background runs do one batch (OS time limits).
export async function runBackup({ force = false, background = false } = {}) {
  if (progress.running) return 0;
  const st = await getBackupState();
  if (!st.enabled || !(await loadToken())) return 0;
  if (!force && (await blockedReason(st))) return 0;
  if (!(await MediaLibrary.getPermissionsAsync()).granted) return 0;
  let last = st.last;
  let done = 0, failed = 0;
  const first = await pending(last, BATCH);
  if (!first.assets.length) { emit({ running: false, done: 0, total: 0, failed: 0 }); return 0; }
  emit({ running: true, done: 0, total: first.totalCount, failed: 0 });
  let page = first;
  try {
    while (page.assets.length) {
      for (const a of page.assets) {
        if (!force && (await blockedReason(st))) return done;
        const info = await MediaLibrary.getAssetInfoAsync(a);
        const form = new FormData();
        form.append("files", { uri: info.localUri || a.uri, name: a.filename, type: a.mediaType === "video" ? "video/mp4" : "image/jpeg" });
        form.append("auto", "true");
        try {
          await api("/files/upload", { method: "POST", form });
          done++;
        } catch (e) {
          if (/Storage full/i.test(e.message)) return done;
          failed++;
        }
        last = a.creationTime;
        await SecureStore.setItemAsync("kn_backup_last", String(last));
        emit({ done, failed });
      }
      if (background) break;
      page = await pending(last, BATCH);
      emit({ total: done + failed + page.totalCount });
    }
  } finally {
    await SecureStore.setItemAsync("kn_backup_ran", String(Date.now()));
    emit({ running: false });
  }
  return done;
}

TaskManager.defineTask(BACKUP_TASK, async () => {
  try {
    await runBackup({ background: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setBackupEnabled(on) {
  if (on) {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) throw new Error("Allow photo access to turn on automatic backup.");
    if (!(await SecureStore.getItemAsync("kn_backup_last"))) await SecureStore.setItemAsync("kn_backup_last", String(Date.now() - 30 * 864e5));
    await SecureStore.setItemAsync("kn_backup_on", "1");
    if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 15 });
    }
  } else {
    await SecureStore.setItemAsync("kn_backup_on", "0");
    if (await TaskManager.isTaskRegisteredAsync(BACKUP_TASK)) await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
  }
}
