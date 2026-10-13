import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export const API = Constants.expoConfig.extra.apiUrl;
let token = null;

export const loadToken = async () => (token = await SecureStore.getItemAsync("kn_token"));
export const saveToken = async (t) => { token = t; t ? await SecureStore.setItemAsync("kn_token", t) : await SecureStore.deleteItemAsync("kn_token"); };
export const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});
export const fileSource = (id) => ({ uri: `${API}/files/${id}/content`, headers: authHeaders() });

export async function api(path, { method = "GET", body, form } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Something went wrong");
  return data;
}

export const fmtBytes = (b = 0) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(1)} ${u[i]}`;
};
