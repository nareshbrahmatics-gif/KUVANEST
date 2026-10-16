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

// Uploads photos/videos created after the last synced one, oldest first, so an interrupted run resumes cleanly.
export async function runBackup({ force = false } = {}) {
  const st = await getBackupState();
  const { enabled, last } = st;
  if (!enabled || !(await loadToken())) return 0;
  if (!force && (await blockedReason(st))) return 0;
  const perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) return 0;
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    createdAfter: last || undefined,
    first: BATCH,
  });
  let done = 0;
  for (const a of page.assets) {
    const info = await MediaLibrary.getAssetInfoAsync(a);
    const uri = info.localUri || a.uri;
    const form = new FormData();
    form.append("files", { uri, name: a.filename, type: a.mediaType === "video" ? "video/mp4" : "image/jpeg" });
    form.append("auto", "true");
    try {
      await api("/files/upload", { method: "POST", form });
    } catch (e) {
      if (/Storage full/i.test(e.message)) break;
      continue;
    }
    await SecureStore.setItemAsync("kn_backup_last", String(a.creationTime));
    done++;
  }
  await SecureStore.setItemAsync("kn_backup_ran", String(Date.now()));
  return done;
}

TaskManager.defineTask(BACKUP_TASK, async () => {
  try {
    await runBackup();
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
