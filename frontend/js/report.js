/**
 * Génération du compte-rendu clinique structuré.
 * Produit le HTML de la modale de synthèse et gère les exports JSON / PDF (impression).
 */

const SEVERITY_LABEL = {
    normal: "Normal",
    watch: "À surveiller",
    alert: "Alerte",
};

/** Métadonnées patient courantes (renseignées dans le formulaire). */
function patientLine(meta) {
    const parts = [];
    if (meta.age) parts.push(`${meta.age} ans`);
    if (meta.sex) parts.push(meta.sex === "female" ? "Femme" : "Homme");
    if (meta.orientation) parts.push(meta.orientation);
    return parts.length ? parts.join(" · ") : "Non renseigné";
}

/** Construit le corps HTML de la modale de compte-rendu. */
export function buildReportHtml(result, meta, filename) {
    const date = new Date().toLocaleString("fr-FR");

    const scoreLine = [
        result.score_anomalie != null ? `Score d'anomalie : <b>${Number(result.score_anomalie).toFixed(2)}</b>` : "",
        result.seuil_utilise != null ? `Seuil : <b>${Number(result.seuil_utilise).toFixed(2)}</b>` : "",
        result.strategie ? `Stratégie : <b>${result.strategie}</b>` : "",
    ].filter(Boolean).join(" · ");

    return `
    <div class="report-doc">
        <div class="report-head">
            <div>
                <h2>Compte-rendu X-DIAG</h2>
                <p class="report-sub">Détection assistée d'anomalies sur radiographie thoracique</p>
            </div>
            <div class="report-meta">
                <div><span>Date</span>${date}</div>
                <div><span>Fichier</span>${filename || "—"}</div>
                <div><span>Patient</span>${patientLine(meta)}</div>
            </div>
        </div>

        <div class="report-verdict sev-${result.severity}">
            <div class="report-verdict-main">
                <span class="report-badge">${SEVERITY_LABEL[result.severity] || "Résultat"}</span>
                <strong>${result.predicted_class}</strong>
            </div>
            <div class="report-conf">Confiance : <b>${result.confidence}%</b></div>
        </div>

        ${scoreLine ? `<p class="report-scoreline">${scoreLine}</p>` : ""}

        ${result.alerte ? `<section>
            <h3>Conduite recommandée</h3>
            <p>${result.alerte}</p>
        </section>` : ""}

        <div class="report-warning">${result.avertissement || result.warning || ""}</div>

        <div class="report-sign">
            <div>Médecin radiologue : ______________________</div>
            <div>Signature / Validation : ______________________</div>
        </div>
    </div>`;
}

/** Exporte le compte-rendu au format JSON (téléchargement). */
export function exportJson(result, meta, filename) {
    const payload = {
        generated_at: new Date().toISOString(),
        source_file: filename,
        patient: meta,
        assessment: result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compte-rendu-ARV-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/** Ouvre le dialogue d'impression / export PDF du navigateur sur le compte-rendu. */
export function exportPdf(reportHtml) {
    const win = window.open("", "_blank", "width=820,height=1000");
    win.document.write(`
        <html lang="fr"><head><meta charset="utf-8">
        <title>Compte-rendu ARV</title>
        <style>
            body { font-family: system-ui, sans-serif; color: #1e293b; padding: 40px; }
            h2 { margin: 0 0 4px; } h3 { margin: 20px 0 6px; color: #0369a1; }
            .report-sub { color: #64748b; margin: 0; }
            .report-meta { font-size: 13px; color: #475569; margin-top: 12px; }
            .report-meta span { display: inline-block; width: 60px; color: #94a3b8; }
            .report-verdict { padding: 16px; border-radius: 12px; margin: 20px 0;
                              background: #f1f5f9; border-left: 6px solid #0ea5e9; }
            .report-verdict.sev-alert { border-color: #f59e0b; background: #fffbeb; }
            .report-verdict.sev-watch { border-color: #eab308; background: #fefce8; }
            .report-verdict.sev-normal { border-color: #22c55e; background: #f0fdf4; }
            .report-badge { display: inline-block; font-size: 12px; text-transform: uppercase;
                            letter-spacing: 1px; color: #0369a1; }
            .report-verdict strong { display: block; font-size: 22px; margin-top: 4px; }
            .report-warning { margin: 24px 0; padding: 14px; border-radius: 10px;
                              background: #fef3c7; color: #92400e; font-weight: 600; }
            .report-sign { margin-top: 40px; display: flex; justify-content: space-between;
                           font-size: 14px; color: #475569; }
            ul { margin: 6px 0; padding-left: 20px; } li { margin: 3px 0; }
        </style></head><body>${reportHtml}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
}
