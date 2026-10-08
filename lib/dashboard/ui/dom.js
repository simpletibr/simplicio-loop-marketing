// Tiny DOM helpers. Data is only ever inserted as text, never as HTML.
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const svgNs = "http://www.w3.org/2000/svg";
export function svg(tag, attrs, ...children) {
  const node = document.createElementNS(svgNs, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, String(value));
  for (const child of children.flat()) if (child) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

export const fmtNumber = (value, digits = 0) => (value === null || value === undefined ? "sem dado" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value));
export const fmtDate = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "sem dado");
export function fmtAgo(iso, now = Date.now()) {
  if (!iso) return "sem dado";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}
export function fmtDelta(delta) {
  if (delta === null || delta === undefined) return "sem comparação";
  if (delta === 0) return "= vs semana passada";
  return `${delta > 0 ? "▲ +" : "▼ "}${fmtNumber(delta, 2)} vs semana passada`;
}

export const STAGE_LABEL = {
  prospect: "Coleta", script: "Roteiro", voice: "Voz", preview: "Prévia", qa: "QA", compliance: "Compliance",
  approval: "Aprovação", final: "Render final", scheduled: "Agendado", published: "Publicado", metrics: "Métricas",
};
export const NETWORK_LABEL = { tiktok: "TikTok", ig_reels: "Reels", yt_shorts: "Shorts" };
export const STATE_LABEL = { done: "ok", failed: "falhou", active: "em andamento", pending: "pendente" };
