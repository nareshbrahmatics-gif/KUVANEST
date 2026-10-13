import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, withCredentials: true });

export const fileUrl = (id, download) => `${API}/files/${id}/content${download ? "?download=1" : ""}`;

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return "Something went wrong. Please try again.";
};

export const fmtBytes = (b = 0) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b >= 100 ? 0 : 1)} ${u[i]}`;
};

export const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

export const downloadFile = (id) => {
  const a = document.createElement("a");
  a.href = fileUrl(id, true);
  document.body.appendChild(a);
  a.click();
  a.remove();
};
