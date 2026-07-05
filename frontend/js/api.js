/**
 * Couche d'accès au backend ARV (FastAPI local).
 *
 * Le backend local proxifie l'API d'inférence distante (Azure) : le front ne
 * parle qu'à ce backend, ce qui évite tout problème de CORS et centralise
 * l'adaptation de la réponse. La prédiction renvoie déjà la heatmap (data URL),
 * il n'y a donc qu'un seul appel par analyse.
 */
export const BASE_URL = "http://127.0.0.1:8000";

/** Construit un FormData incluant l'image et les métadonnées patient. */
function buildForm(file, meta = {}) {
    const form = new FormData();
    form.append("file", file);
    if (meta.age != null && meta.age !== "") form.append("age", meta.age);
    if (meta.sex) form.append("sex", meta.sex);
    if (meta.orientation) form.append("orientation", meta.orientation);
    return form;
}

/** Vérifie que le backend local répond (indicateur de connexion). */
export async function checkHealth() {
    try {
        const r = await fetch(`${BASE_URL}/health`, { cache: "no-store" });
        return r.ok;
    } catch {
        return false;
    }
}

/**
 * Analyse complète via le proxy backend -> API distante.
 * Renvoie le contrat JSON adapté (anomalie, confiance, score, heatmap…).
 */
export async function predict(file, meta = {}) {
    const res = await fetch(`${BASE_URL}/predict`, { method: "POST", body: buildForm(file, meta) });
    if (!res.ok) {
        // Le backend renvoie un message explicite (timeout Azure, API injoignable…).
        let detail = `Analyse échouée (${res.status})`;
        try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
        throw new Error(detail);
    }
    return res.json();
}
