/**
 * Orchestrateur de la station de travail clinique ARV.
 *
 * Enchaîne : import image -> pipeline d'inférence -> bascule vers l'espace de
 * travail 2 colonnes (visionneuse + synthèse) -> actions (audit, compte-rendu).
 */
import { checkHealth, cropImage, predict, heatmap } from "./api.js";
import { MedicalViewer } from "./viewer.js";
import { buildReportHtml, exportJson, exportPdf } from "./report.js";
import { refreshAudit } from "./audit.js";

/* --------------------------------------------------------------------------- */
/*  Références DOM                                                              */
/* --------------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);

const els = {
    // Vues
    intake: $("#intake"),
    workspace: $("#workspace"),
    // Import
    dropZone: $("#drop-zone"),
    fileInput: $("#file-input"),
    // Métadonnées patient
    age: $("#age"),
    sex: $("#sex"),
    orientation: () => document.querySelector("input[name='orientation']:checked"),
    metaError: $("#meta-error"),
    // Overlay traitement
    processing: $("#processing"),
    procTimer: $("#proc-timer"),
    // Viewer
    viewerRoot: $("#viewer"),
    brightness: $("#brightness"),
    contrast: $("#contrast"),
    heatToggle: $("#heat-toggle"),
    heatOpacity: $("#heat-opacity"),
    compareBtn: $("#compare-btn"),
    invertBtn: $("#invert-btn"),
    fullscreenBtn: $("#fullscreen-btn"),
    resetView: $("#reset-view"),
    // Synthèse
    verdictBadge: $("#verdict-badge"),
    verdictLabel: $("#verdict-label"),
    confValue: $("#conf-value"),
    confFill: $("#conf-fill"),
    differential: $("#differential"),
    evidenceList: $("#evidence-list"),
    justification: $("#justification"),
    recoBlock: $("#reco-block"),
    recoList: $("#reco-list"),
    // Actions
    validateBtn: $("#validate-btn"),
    newExamBtn: $("#new-exam-btn"),
    // Connexion
    connDot: $("#conn-dot"),
    connLabel: $("#conn-label"),
    // Audit
    auditBtn: $("#audit-btn"),
    auditModal: $("#audit-modal"),
    auditBody: $("#audit-body"),
    // Compte-rendu
    reportModal: $("#report-modal"),
    reportBody: $("#report-body"),
    exportJsonBtn: $("#export-json"),
    exportPdfBtn: $("#export-pdf"),
};

/* --------------------------------------------------------------------------- */
/*  État de session                                                            */
/* --------------------------------------------------------------------------- */
const state = {
    file: null,
    pendingFile: null,   // fichier déposé en attente d'un contexte clinique complet
    result: null,
    meta: {},
    viewer: null,
    procInterval: null,
};

const SEVERITY = {
    normal: { label: "Normal", cls: "sev-normal" },
    watch: { label: "À surveiller", cls: "sev-watch" },
    alert: { label: "Alerte clinique", cls: "sev-alert" },
};

/* --------------------------------------------------------------------------- */
/*  Initialisation                                                             */
/* --------------------------------------------------------------------------- */
function init() {
    state.viewer = new MedicalViewer(els.viewerRoot);
    bindIntake();
    bindMetaValidation();
    bindViewerControls();
    bindShortcuts();
    bindActions();
    bindModals();
    pollConnection();
}

/* --------------------------------------------------------------------------- */
/*  Import (drag & drop + sélection)                                           */
/* --------------------------------------------------------------------------- */
function bindIntake() {
    els.dropZone.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

    els.dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        els.dropZone.classList.add("dragover");
    });
    els.dropZone.addEventListener("dragleave", () =>
        els.dropZone.classList.remove("dragover"));
    els.dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        els.dropZone.classList.remove("dragover");
        handleFile(e.dataTransfer.files[0]);
    });
}

function collectMeta() {
    const orientation = els.orientation();
    return {
        age: els.age.value || null,
        sex: els.sex.value || null,
        orientation: orientation ? orientation.value : null,
    };
}

/** Contexte clinique obligatoire : vérifie âge, sexe et incidence. */
function validateMeta(meta) {
    els.age.classList.toggle("input-invalid", !meta.age);
    els.sex.classList.toggle("input-invalid", !meta.sex);
    document.querySelector(".radio-row").classList.toggle("radio-invalid", !meta.orientation);

    const ok = Boolean(meta.age && meta.sex && meta.orientation);
    els.metaError.classList.toggle("hidden", ok);
    return ok;
}

/**
 * Efface le marquage d'erreur au fil de la saisie et relance automatiquement
 * l'analyse dès que le contexte est complété (si un fichier était en attente).
 */
function bindMetaValidation() {
    const onEdit = () => {
        const meta = collectMeta();
        if (meta.age) els.age.classList.remove("input-invalid");
        if (meta.sex) els.sex.classList.remove("input-invalid");
        if (meta.orientation) document.querySelector(".radio-row").classList.remove("radio-invalid");

        if (meta.age && meta.sex && meta.orientation) {
            els.metaError.classList.add("hidden");
            if (state.pendingFile) {
                const file = state.pendingFile;
                state.pendingFile = null;
                handleFile(file);
            }
        }
    };
    els.age.addEventListener("input", onEdit);
    els.sex.addEventListener("change", onEdit);
    document.querySelectorAll("input[name='orientation']")
        .forEach((r) => r.addEventListener("change", onEdit));
}

/** Point d'entrée du pipeline : validation, animation, appels backend. */
async function handleFile(file) {
    if (!file) return;

    const ok = /\.(png|jpe?g|webp|dcm)$/i.test(file.name) || file.type.startsWith("image/");
    if (!ok) {
        alert("Format non supporté. Utilisez PNG, JPG, WEBP ou DICOM (.dcm).");
        return;
    }

    state.meta = collectMeta();

    // Le contexte clinique doit être renseigné avant toute analyse.
    if (!validateMeta(state.meta)) {
        state.pendingFile = file;          // repris dès que le contexte est complété
        els.fileInput.value = "";          // autorise une re-sélection du même fichier
        els.metaError.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
    }

    state.file = file;
    state.pendingFile = null;

    startProcessing();
    try {
        // Appels parallèles : recadrage (prévisualisation), heatmap et inférence.
        const [cropBlob, heatBlob, result] = await Promise.all([
            cropImage(file),
            heatmap(file),
            predict(file, state.meta),
        ]);

        state.result = result;
        state.viewer.setBaseImage(URL.createObjectURL(cropBlob));
        state.viewer.setHeatImage(URL.createObjectURL(heatBlob));
        renderSynthesis(result);
        stopProcessing(true);
    } catch (err) {
        console.error(err);
        stopProcessing(false);
        alert("Échec de l'analyse. Vérifiez que le backend est lancé (port 8000).\n" + err.message);
    }
}

/* --------------------------------------------------------------------------- */
/*  Indicateur de traitement temps réel                                        */
/* --------------------------------------------------------------------------- */
function startProcessing() {
    els.processing.classList.add("active");
    const t0 = performance.now();
    els.procInterval = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        els.procTimer.textContent = s.toFixed(1) + " s";
    }, 60);
}

function stopProcessing(success) {
    clearInterval(state.procInterval);
    els.processing.classList.remove("active");
    if (success) {
        els.intake.classList.add("hidden");
        els.workspace.classList.remove("hidden");
    }
}

/* --------------------------------------------------------------------------- */
/*  Colonne de droite : synthèse clinique                                      */
/* --------------------------------------------------------------------------- */
function renderSynthesis(result) {
    const sev = SEVERITY[result.severity] || SEVERITY.watch;

    els.verdictBadge.textContent = sev.label;
    els.verdictBadge.className = "verdict-badge " + sev.cls;
    els.verdictLabel.textContent = result.predicted_class;

    // Animation de la jauge de confiance.
    // On repart de 0 puis on fixe la cible via setTimeout pour déclencher la
    // transition CSS de façon fiable (rAF est suspendu si l'onglet est masqué).
    els.confValue.textContent = result.confidence + " %";
    els.confFill.className = "conf-fill " + sev.cls;
    els.confFill.style.width = "0%";
    setTimeout(() => { els.confFill.style.width = result.confidence + "%"; }, 40);

    renderDifferential(result);

    els.evidenceList.innerHTML = result.visual_evidence
        .map((e) => `<li>${e}</li>`).join("");

    els.justification.textContent = result.justification;

    if (result.recommendations && result.recommendations.length) {
        els.recoBlock.classList.remove("hidden");
        els.recoList.innerHTML = result.recommendations.map((r) => `<li>${r}</li>`).join("");
    } else {
        els.recoBlock.classList.add("hidden");
    }
}

/* --------------------------------------------------------------------------- */
/*  Contrôles de la visionneuse                                                */
/* --------------------------------------------------------------------------- */
function bindViewerControls() {
    els.brightness.addEventListener("input", (e) =>
        state.viewer.setBrightness(+e.target.value));
    els.contrast.addEventListener("input", (e) =>
        state.viewer.setContrast(+e.target.value));
    els.heatOpacity.addEventListener("input", (e) =>
        state.viewer.setHeatOpacity(+e.target.value / 100));

    // Boutons de mode : chacun bascule un état et sa classe .active.
    els.heatToggle.addEventListener("click", () => {
        const on = els.heatToggle.classList.toggle("active");
        state.viewer.toggleHeatmap(on);
        // Activer la cartographie sort du mode comparateur (exclusifs).
        if (on && state.viewer.compareOn) setCompare(false);
    });

    els.compareBtn.addEventListener("click", () => setCompare(!state.viewer.compareOn));

    els.invertBtn.addEventListener("click", () => {
        const on = els.invertBtn.classList.toggle("active");
        state.viewer.setInvert(on);
    });

    els.fullscreenBtn.addEventListener("click", () => state.viewer.toggleFullscreen());

    els.resetView.addEventListener("click", resetViewer);
}

/** Active/désactive le comparateur et synchronise les boutons (exclusif avec heatmap). */
function setCompare(on) {
    state.viewer.toggleCompare(on);
    els.compareBtn.classList.toggle("active", on);
    if (on) {
        els.heatToggle.classList.remove("active");
    } else {
        // Reflète l'état réel de la cartographie après sortie du comparateur.
        els.heatToggle.classList.toggle("active", state.viewer.heatOn);
    }
}

/** Réinitialise la visionneuse et l'état visuel des contrôles. */
function resetViewer() {
    state.viewer.reset();
    els.brightness.value = 100;
    els.contrast.value = 100;
    els.heatOpacity.value = 75;
    [els.heatToggle, els.compareBtn, els.invertBtn].forEach((b) =>
        b.classList.remove("active"));
}

/* --------------------------------------------------------------------------- */
/*  Diagnostic différentiel (distribution des probabilités du modèle)          */
/* --------------------------------------------------------------------------- */
function renderDifferential(result) {
    const scores = result.scores || {};
    // Tri décroissant, on garde les 4 hypothèses les plus probables.
    const top = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    els.differential.innerHTML = top.map(([label, pct], i) => `
        <div class="diff-row ${i === 0 ? "diff-top" : ""}">
            <div class="diff-label" title="${label}">${label}</div>
            <div class="diff-track"><div class="diff-bar" style="width:0%"></div></div>
            <div class="diff-pct">${pct}%</div>
        </div>`).join("");

    // Animation des barres après insertion dans le DOM.
    const bars = els.differential.querySelectorAll(".diff-bar");
    setTimeout(() => {
        bars.forEach((bar, i) => { bar.style.width = top[i][1] + "%"; });
    }, 60);
}

/* --------------------------------------------------------------------------- */
/*  Raccourcis clavier (confort de démonstration)                              */
/* --------------------------------------------------------------------------- */
function bindShortcuts() {
    window.addEventListener("keydown", (e) => {
        // On ignore la saisie dans les champs et quand une modale est ouverte.
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (document.querySelector(".modal.active")) return;
        if (els.workspace.classList.contains("hidden")) return;

        switch (e.key.toLowerCase()) {
            case "h": els.heatToggle.click(); break;
            case "c": els.compareBtn.click(); break;
            case "n": els.invertBtn.click(); break;
            case "f": els.fullscreenBtn.click(); break;
            case "r": resetViewer(); break;
        }
    });
}

/* --------------------------------------------------------------------------- */
/*  Actions médecin                                                            */
/* --------------------------------------------------------------------------- */
function bindActions() {
    els.newExamBtn.addEventListener("click", () => {
        els.workspace.classList.add("hidden");
        els.intake.classList.remove("hidden");
        els.fileInput.value = "";
        state.result = null;
        state.file = null;
    });

    els.validateBtn.addEventListener("click", openReport);
}

function openReport() {
    if (!state.result) return;
    const html = buildReportHtml(state.result, state.meta, state.file?.name);
    els.reportBody.innerHTML = html;
    els.reportModal.classList.add("active");

    els.exportJsonBtn.onclick = () =>
        exportJson(state.result, state.meta, state.file?.name);
    els.exportPdfBtn.onclick = () => exportPdf(html);
}

/* --------------------------------------------------------------------------- */
/*  Modales (audit + compte-rendu)                                             */
/* --------------------------------------------------------------------------- */
function bindModals() {
    els.auditBtn.addEventListener("click", async () => {
        els.auditModal.classList.add("active");
        els.auditBody.innerHTML = `<p class="audit-loading">Chargement…</p>`;
        await refreshAudit(els.auditBody);
    });

    // Fermeture générique : boutons [data-close] et clic sur le fond.
    document.querySelectorAll("[data-close]").forEach((btn) => {
        btn.addEventListener("click", () => {
            btn.closest(".modal").classList.remove("active");
        });
    });
    document.querySelectorAll(".modal").forEach((modal) => {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) modal.classList.remove("active");
        });
    });
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
            document.querySelectorAll(".modal.active")
                .forEach((m) => m.classList.remove("active"));
    });
}

/* --------------------------------------------------------------------------- */
/*  Indicateur de connexion backend                                            */
/* --------------------------------------------------------------------------- */
async function pollConnection() {
    const update = async () => {
        const online = await checkHealth();
        els.connDot.classList.toggle("online", online);
        els.connDot.classList.toggle("offline", !online);
        els.connLabel.textContent = online ? "Backend connecté" : "Backend hors ligne";
    };
    await update();
    setInterval(update, 5000);
}

/* --------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", init);
