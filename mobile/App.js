import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, FlatList, Alert, SafeAreaView, StyleSheet, Switch, AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { api, loadToken, saveToken, fileSource, fmtBytes } from "./src/api";
import { runBackup, setBackupEnabled, getBackupState } from "./src/backup";

const C = { blue: "#1F94C8", yellow: "#E5AA16", folder: "#FEF9E7", text: "#202124", muted: "#5F6368", bg: "#F7F7F7" };
const TABS = ["Home", "Photos", "Files", "Transfer", "Account"];

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = async () => {
    try { const d = await api("/auth/login", { method: "POST", body: { email, password } }); await saveToken(d.token); onLogin(d.user); }
    catch (e) { Alert.alert("Sign in failed", e.message); }
  };
  return (
    <View style={s.center}>
      <View style={s.logo}><Image source={require("./assets/icon.png")} style={{ width: 48, height: 48 }} /></View>
      <Text style={s.h1}>Welcome to KuvaNest</Text>
      <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={s.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity style={s.yellowBtn} onPress={submit}><Text style={s.btnText}>Sign in</Text></TouchableOpacity>
    </View>
  );
}

async function pickAndUpload(onDone) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return Alert.alert("Permission needed", "Allow photo access to back up photos.");
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true });
  if (r.canceled) return;
  const form = new FormData();
  r.assets.forEach((a, i) => form.append("files", { uri: a.uri, name: a.fileName || `photo_${i}.jpg`, type: a.mimeType || "image/jpeg" }));
  form.append("auto", "true");
  try { await api("/files/upload", { method: "POST", form }); Alert.alert("Backed up", `${r.assets.length} item(s) uploaded`); onDone?.(); }
  catch (e) { Alert.alert("Upload failed", e.message); }
}

function Home({ user, open }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => api("/home").then(setD).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const st = d.storage;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>Namaste, {user.name.split(" ")[0]}</Text>
      <View style={s.storage}>
        <Text style={s.overline}>YOUR PERSONAL STORAGE</Text>
        <Text style={s.big}>{fmtBytes(st.used)}</Text>
        <Text style={{ color: "#fff" }}>of {fmtBytes(st.quota)} used · {fmtBytes(st.available)} available</Text>
      </View>
      <TouchableOpacity style={s.yellowBtn} onPress={() => pickAndUpload(load)}><Text style={s.btnText}>Back up photos</Text></TouchableOpacity>
      <Text style={s.h2}>My Folders</Text>
      <View style={s.grid}>
        {d.folders.map((f) => (
          <TouchableOpacity key={f.folder_id} style={s.folder} onPress={() => open(f)}>
            <View style={s.folderIcon} /><Text style={s.folderName}>{f.name}</Text><Text style={s.muted}>{f.count} items</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Photos() {
  const [items, setItems] = useState([]);
  useEffect(() => { api("/photos").then(setItems).catch(() => {}); }, []);
  return (
    <FlatList data={items} numColumns={3} keyExtractor={(p) => p.file_id} contentContainerStyle={{ padding: 2 }}
      renderItem={({ item }) => <Image source={fileSource(item.file_id)} style={s.photo} />}
      ListEmptyComponent={<Text style={[s.muted, s.pad]}>No photos yet.</Text>} />
  );
}

function Files({ folder, setFolder }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/browse${folder ? `?folder_id=${folder.folder_id}` : ""}`).then(setD).catch(() => {}); }, [folder]);
  if (!d) return null;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>{d.folder?.name || "My Files"}</Text>
      {folder && <TouchableOpacity onPress={() => setFolder(null)}><Text style={{ color: C.blue, marginBottom: 12 }}>‹ All files</Text></TouchableOpacity>}
      {d.folders.map((f) => <TouchableOpacity key={f.folder_id} style={s.row} onPress={() => setFolder(f)}><View style={s.folderIconSm} /><Text style={s.rowText}>{f.name}</Text></TouchableOpacity>)}
      {d.files.map((f) => <View key={f.file_id} style={s.row}><Text style={s.rowText}>{f.name}</Text><Text style={s.muted}>{fmtBytes(f.size)}</Text></View>)}
    </ScrollView>
  );
}

const Transfer = () => (
  <View style={s.pad}>
    <Text style={s.h1}>Move to KuvaNest</Text>
    <Text style={s.muted}>Upload Google Takeout, iCloud, Dropbox, OneDrive or Azure ZIP archives from the KuvaNest web app. Large archive upload from mobile is coming in a later release.</Text>
  </View>
);

function AutoBackup() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => getBackupState().then(setSt);
  useEffect(() => { refresh(); }, []);
  const toggle = async (on) => { try { await setBackupEnabled(on); refresh(); } catch (e) { Alert.alert("Backup", e.message); } };
  const now = async () => { setBusy(true); const n = await runBackup(); setBusy(false); refresh(); Alert.alert("Backup", n ? `${n} new item(s) backed up` : "Everything is already backed up"); };
  if (!st) return null;
  return (
    <View style={s.card}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.folderName}>Automatic photo backup</Text>
        <Switch value={st.enabled} onValueChange={toggle} trackColor={{ true: C.blue }} />
      </View>
      <Text style={[s.muted, { marginTop: 6 }]}>New camera photos and videos are uploaded when you open the app, and in the background whenever your phone allows it (usually every 15+ minutes on Wi-Fi/charging).</Text>
      {st.lastRun ? <Text style={[s.muted, { marginTop: 6 }]}>Last backup: {new Date(st.lastRun).toLocaleString("en-IN")}</Text> : null}
      {st.enabled && <TouchableOpacity style={s.yellowBtn} onPress={now} disabled={busy}><Text style={s.btnText}>{busy ? "Backing up…" : "Back up now"}</Text></TouchableOpacity>}
    </View>
  );
}

function Account({ user, onLogout }) {
  return (
    <View style={s.pad}>
      <Text style={s.h1}>{user.name}</Text><Text style={s.muted}>{user.email} · {user.plan_id} plan</Text>
      <AutoBackup />
      <TouchableOpacity style={[s.yellowBtn, { backgroundColor: C.bg, marginTop: 24 }]} onPress={onLogout}><Text style={s.btnText}>Log out</Text></TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("Home");
  const [folder, setFolder] = useState(null);
  useEffect(() => { loadToken().then((t) => (t ? api("/auth/me").then(setUser).catch(() => setUser(null)) : setUser(null))); }, []);
  useEffect(() => {
    if (!user) return;
    runBackup().catch(() => {});
    const sub = AppState.addEventListener("change", (st) => st === "active" && runBackup().catch(() => {}));
    return () => sub.remove();
  }, [user]);
  const logout = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); await saveToken(null); setUser(null); };
  if (user === undefined) return <View style={s.center} />;
  if (!user) return <Login onLogin={setUser} />;
  const screens = {
    Home: <Home user={user} open={(f) => { setFolder(f); setTab("Files"); }} />, Photos: <Photos />,
    Files: <Files folder={folder} setFolder={setFolder} />, Transfer: <Transfer />, Account: <Account user={user} onLogout={logout} />,
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>{screens[tab]}</View>
      <View style={s.tabs}>
        {TABS.map((t) => <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}><Text style={[s.tabText, tab === t && { color: C.blue }]}>{t}</Text></TouchableOpacity>)}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  pad: { padding: 20 },
  logo: { width: 72, height: 72, borderRadius: 18, backgroundColor: C.blue, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  h1: { fontSize: 28, fontWeight: "800", color: C.text, marginBottom: 16 },
  h2: { fontSize: 18, fontWeight: "700", color: C.text, marginVertical: 16 },
  muted: { color: C.muted, fontSize: 13 },
  input: { height: 52, borderRadius: 14, backgroundColor: C.bg, paddingHorizontal: 16, marginBottom: 12, fontSize: 16 },
  yellowBtn: { height: 52, borderRadius: 14, backgroundColor: C.yellow, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnText: { fontWeight: "700", fontSize: 16, color: C.text },
  storage: { backgroundColor: C.text, borderRadius: 16, padding: 20, marginBottom: 12 },
  overline: { color: "#7CCBEF", fontWeight: "700", fontSize: 11, letterSpacing: 2 },
  big: { color: "#fff", fontSize: 36, fontWeight: "800", marginVertical: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  folder: { width: "48%", backgroundColor: C.folder, borderColor: "#F3E2B4", borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  folderIcon: { width: 56, height: 42, borderRadius: 8, backgroundColor: C.yellow, marginBottom: 12 },
  folderIconSm: { width: 32, height: 24, borderRadius: 5, backgroundColor: C.yellow, marginRight: 12 },
  folderName: { fontWeight: "700", fontSize: 16, color: C.text },
  photo: { width: "33%", aspectRatio: 1, margin: "0.15%" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderColor: "#eee" },
  rowText: { flex: 1, fontSize: 15, color: C.text },
  card: { backgroundColor: C.bg, borderRadius: 16, padding: 16, marginTop: 20 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderColor: "#eee", paddingVertical: 6 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, marginHorizontal: 2 },
  tabActive: { backgroundColor: "#E8F4FA" },
  tabText: { fontSize: 12, fontWeight: "600", color: C.muted },
});
