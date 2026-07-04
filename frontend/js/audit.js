/**
 * Panneau "Performance & Audit IA" (pour le jury).
 * Affiche les métriques du modèle, la latence temps réel et le journal SQLite.
 */
import { getMetrics, getAuditLogs, getAuditStats } from "./api.js";

/** Rafraîchit l'intégralité du panneau d'audit. */
export async function refreshAudit(container) {
    const [metrics, logsResp, stats] = await Promise.all([
        getMetrics().catch(() => null),
        getAuditLogs(50).catch(() => ({ logs: [] })),
        getAuditStats().catch(() => null),
    ]);

    const metricsHtml = metrics ? `
        <div class="audit-metrics">
            <div class="metric"><span>${(metrics.accuracy * 100).toFixed(0)}%</span>Accuracy</div>
            <div class="metric"><span>${(metrics.macro_f1 * 100).toFixed(0)}%</span>Macro-F1</div>
            <div class="metric"><span>${(metrics.sensitivity * 100).toFixed(0)}%</span>Sensibilité</div>
            <div class="metric"><span>${(metrics.auc_roc * 100).toFixed(0)}%</span>AUC-ROC</div>
        </div>
        <p class="audit-model">${metrics.model_name} · Entrée ${metrics.input_shape} · ${metrics.dataset}</p>
    ` : `<p class="audit-offline">Métriques indisponibles (backend hors ligne).</p>`;

    const statsHtml = stats ? `
        <div class="audit-session">
            <div><b>${stats.total_inferences}</b> inférences</div>
            <div><b>${stats.avg_time_ms} ms</b> latence moy.</div>
            <div><b>${stats.avg_confidence}%</b> confiance moy.</div>
        </div>` : "";

    const rows = (logsResp.logs || []).map((l) => `
        <tr>
            <td><span class="sev-dot sev-${l.severity || "none"}"></span></td>
            <td>${new Date(l.timestamp).toLocaleTimeString("fr-FR")}</td>
            <td class="ellipsis" title="${l.filename || ""}">${l.filename || "—"}</td>
            <td>${l.predicted_class}</td>
            <td>${l.confidence}%</td>
            <td>${l.inference_time_ms ? l.inference_time_ms.toFixed(0) + " ms" : "—"}</td>
        </tr>`).join("");

    const tableHtml = rows ? `
        <table class="audit-table">
            <thead><tr><th></th><th>Heure</th><th>Fichier</th><th>Conclusion</th><th>Conf.</th><th>Latence</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : `<p class="audit-empty">Aucune inférence enregistrée pour cette session.</p>`;

    container.innerHTML = `
        <h4 class="audit-title">Métriques du modèle</h4>
        ${metricsHtml}
        <h4 class="audit-title">Session courante</h4>
        ${statsHtml}
        <h4 class="audit-title">Journal de traçabilité (SQLite)</h4>
        ${tableHtml}`;
}
