/**
 * Couche d'accès au backend ARV (FastAPI).
 * Un seul point de configuration : BASE_URL.
 */
export const BASE_URL = "http://127.0.0.1:8000";

/** Construit un FormData incluant l'image et les métadonnées patient facultatives. */
function buildForm(file, meta = {}) {
    const form = new FormData();
    form.append("file", file);
    if (meta.age != null && meta.age !== "") form.append("age", meta.age);
    if (meta.sex) form.append("sex", meta.sex);
    if (meta.orientation) form.append("orientation", meta.orientation);
    return form;
}

/** Vérifie que le backend répond (utilisé pour l'indicateur de connexion). */
export async function checkHealth() {
    try {
        const r = await fetch(`${BASE_URL}/health`, { cache: "no-store" });
        return r.ok;
    } catch {
        return false;
    }
}

/** Recadrage 320x320 -> Blob PNG (prévisualisation). */
export async function cropImage(file) {
    const res = await fetch(`${BASE_URL}/crop`, { method: "POST", body: buildForm(file) });
    if (!res.ok) throw new Error(`Crop échoué (${res.status})`);
    return res.blob();
}

/** Inférence complète -> contrat JSON d'aide à la décision. */
export async function predict(file, meta = {}) {
    const res = await fetch(`${BASE_URL}/predict`, { method: "POST", body: buildForm(file, meta) });
    if (!res.ok) throw new Error(`Analyse échouée (${res.status})`);
    return res.json();
}

/** Cartographie IA (Grad-CAM) -> Blob PNG superposé. */
export async function heatmap(file) {
    const res = await fetch(`${BASE_URL}/heatmap`, { method: "POST", body: buildForm(file) });
    if (!res.ok) throw new Error(`Heatmap échouée (${res.status})`);
    return res.blob();
}

/** Métriques du modèle (panneau d'audit). */
export async function getMetrics() {
    const res = await fetch(`${BASE_URL}/metrics`);
    return res.json();
}

/** Journal de traçabilité SQLite. */
export async function getAuditLogs(limit = 50) {
    const res = await fetch(`${BASE_URL}/audit/logs?limit=${limit}`);
    return res.json();
}

/** Statistiques agrégées de session. */
export async function getAuditStats() {
    const res = await fetch(`${BASE_URL}/audit/stats`);
    return res.json();
}
