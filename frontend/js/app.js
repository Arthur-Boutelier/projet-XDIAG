/**
 * Orchestrateur de la station de travail clinique X-DIAG.
 *
 * Enchaîne : import image -> analyse -> bascule vers l'espace de travail
 * 2 colonnes (visionneuse + synthèse) -> compte-rendu.
 */
import { checkHealth, predict } from "./api.js";
import { MedicalViewer } from "./viewer.js";
import { buildReportHtml, exportJson, exportPdf } from "./report.js";

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
    dropEmpty: $(".drop-empty"),
    dropPreview: $("#drop-preview"),
    previewImg: $("#preview-img"),
    previewName: $("#preview-name"),
    changeFile: $("#change-file"),
    analyzeBtn: $("#analyze-btn"),
    ctaHint: $("#cta-hint"),
    // Métadonnées patient
    age: $("#age"),
    sex: $("#sex"),
    view: () => document.querySelector("input[name='view']:checked"),
    incidence: () => document.querySelector("input[name='incidence']:checked"),
    incidenceField: $("#incidence-field"),
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
    scoreAnomalie: $("#score-anomalie"),
    seuilValue: $("#seuil-value"),
    strategieValue: $("#strategie-value"),
    alerteBlock: $("#alerte-block"),
    alerteText: $("#alerte-text"),
    disclaimerText: $("#disclaimer-text"),
    // Actions
    validateBtn: $("#validate-btn"),
    newExamBtn: $("#new-exam-btn"),
    // Connexion
    connDot: $("#conn-dot"),
    connLabel: $("#conn-label"),
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
    file: null,          // fichier sélectionné (aperçu affiché, analyse au clic)
    previewUrl: null,    // Object URL de l'aperçu, à révoquer quand on change
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
    updateCtaState();
}

/* --------------------------------------------------------------------------- */
/*  Import (drag & drop + sélection + aperçu)                                  */
/* --------------------------------------------------------------------------- */
function bindIntake() {
    // Clic sur la zone -> ouvrir le sélecteur, sauf si le clic vient du bouton
    // "Changer d'image" (il déclenchera lui-même l'ouverture ci-dessous).
    els.dropZone.addEventListener("click", (e) => {
        if (e.target.closest("#change-file")) return;
        els.fileInput.click();
    });
    els.fileInput.addEventListener("change", (e) => selectFile(e.target.files[0]));

    els.dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        els.dropZone.classList.add("dragover");
    });
    els.dropZone.addEventListener("dragleave", () =>
        els.dropZone.classList.remove("dragover"));
    els.dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        els.dropZone.classList.remove("dragover");
        selectFile(e.dataTransfer.files[0]);
    });

    // Changer d'image -> réinitialise l'aperçu et rouvre le sélecteur.
    els.changeFile.addEventListener("click", (e) => {
        e.stopPropagation();
        clearSelection();
        els.fileInput.click();
    });

    // Bouton principal : ne démarre l'analyse que si tout est prêt.
    els.analyzeBtn.addEventListener("click", runAnalysis);
}

/** Sélectionne un fichier : validation format, aperçu, mise à jour du CTA. */
function selectFile(file) {
    if (!file) return;

    const ok = /\.(png|jpe?g|webp|dcm)$/i.test(file.name) || file.type.startsWith("image/");
    if (!ok) {
        alert("Format non supporté. Utilisez PNG, JPG, WEBP ou DICOM (.dcm).");
        return;
    }

    // Nettoyage d'un éventuel aperçu précédent.
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);

    state.file = file;
    state.previewUrl = URL.createObjectURL(file);

    // Les fichiers DICOM n'ont pas d'aperçu navigateur natif : on masque l'img
    // et on affiche un pictogramme dans preview-meta.
    const isDicom = /\.dcm$/i.test(file.name);
    els.previewImg.style.display = isDicom ? "none" : "block";
    if (!isDicom) els.previewImg.src = state.previewUrl;
    els.previewName.textContent = file.name + (isDicom ? "  (DICOM — aperçu au lancement)" : "");

    els.dropEmpty.classList.add("hidden");
    els.dropPreview.classList.remove("hidden");
    els.dropZone.classList.add("has-file");

    updateCtaState();
}

/** Réinitialise la sélection courante (avant de choisir un autre fichier). */
function clearSelection() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = null;
    state.previewUrl = null;
    els.previewImg.removeAttribute("src");
    els.fileInput.value = "";
    els.dropEmpty.classList.remove("hidden");
    els.dropPreview.classList.add("hidden");
    els.dropZone.classList.remove("has-file");
    updateCtaState();
}

/**
 * Reflète l'état "prêt à analyser" sur le bouton principal :
 *   - inactif si pas de fichier ou contexte incomplet ;
 *   - actif dès que tout est en place ;
 *   - indice contextuel juste en dessous.
 */
function updateCtaState() {
    const meta = collectMeta();
    const metaOk = Boolean(meta.age && meta.sex && meta.orientation);
    const ready = state.file && metaOk;

    els.analyzeBtn.disabled = !ready;

    if (!state.file && !metaOk)
        els.ctaHint.textContent = "Sélectionnez une radiographie et renseignez le contexte clinique.";
    else if (!state.file)
        els.ctaHint.textContent = "Sélectionnez une radiographie pour lancer l'analyse.";
    else if (!metaOk)
        els.ctaHint.textContent = "Renseignez le contexte clinique (âge, sexe, incidence).";
    else
        els.ctaHint.textContent = "Prêt : cliquez sur « Lancer l'analyse ».";
}

/**
 * Assemble les métadonnées patient.
 * `orientation` est ce qu'attend l'API : "AP" | "PA" | "LATERAL".
 *   - Latéral : incidence AP/PA sans objet -> "LATERAL"
 *   - Frontal : orientation = l'incidence choisie ("AP" ou "PA")
 *   - Frontal sans incidence : orientation null -> validation en échec
 */
function collectMeta() {
    const view = els.view();
    const incidence = els.incidence();
    const viewVal = view ? view.value : null;         // "frontal" | "lateral" | null
    const incidenceVal = incidence ? incidence.value : null;

    let orientation = null;
    if (viewVal === "lateral") orientation = "LATERAL";
    else if (viewVal === "frontal" && incidenceVal) orientation = incidenceVal;

    return {
        age: els.age.value || null,
        sex: els.sex.value || null,
        view: viewVal,
        incidence: incidenceVal,
        orientation,
    };
}

/** Contexte clinique obligatoire : âge, sexe, vue, et incidence si frontal. */
function validateMeta(meta) {
    els.age.classList.toggle("input-invalid", !meta.age);
    els.age.closest(".age-input")?.classList.toggle("input-invalid", !meta.age);
    els.sex.classList.toggle("input-invalid", !meta.sex);
    document.querySelector("[data-radio='view']").classList.toggle("radio-invalid", !meta.view);
    // Incidence : requise uniquement si vue frontale.
    const needIncidence = meta.view === "frontal";
    document.querySelector("[data-radio='incidence']").classList.toggle(
        "radio-invalid", needIncidence && !meta.incidence
    );

    const ok = Boolean(meta.age && meta.sex && meta.orientation);
    els.metaError.classList.toggle("hidden", ok);
    return ok;
}

/** Masque la ligne d'incidence si la vue est latérale (ou pas encore choisie). */
function syncIncidenceVisibility() {
    const isFrontal = els.view()?.value === "frontal";
    els.incidenceField.classList.toggle("hidden", !isFrontal);
    if (!isFrontal) {
        // On décoche l'incidence si on quitte la vue frontale, pour éviter
        // qu'une valeur cachée traîne dans le formulaire.
        document.querySelectorAll("input[name='incidence']").forEach((r) => (r.checked = false));
    }
}

/**
 * Efface le marquage d'erreur au fil de la saisie et met à jour le bouton
 * principal (activé dès que le contexte est complet).
 */
function bindMetaValidation() {
    const onEdit = () => {
        const meta = collectMeta();
        if (meta.age) {
            els.age.classList.remove("input-invalid");
            els.age.closest(".age-input")?.classList.remove("input-invalid");
        }
        if (meta.sex) els.sex.classList.remove("input-invalid");
        if (meta.view) document.querySelector("[data-radio='view']").classList.remove("radio-invalid");
        if (meta.incidence)
            document.querySelector("[data-radio='incidence']").classList.remove("radio-invalid");
        if (meta.age && meta.sex && meta.orientation) els.metaError.classList.add("hidden");
        updateCtaState();
    };
    els.age.addEventListener("input", onEdit);
    els.sex.addEventListener("change", onEdit);

    // Changement de vue : on masque/affiche l'incidence puis on revalide.
    document.querySelectorAll("input[name='view']").forEach((r) => {
        r.addEventListener("change", () => { syncIncidenceVisibility(); onEdit(); });
    });
    document.querySelectorAll("input[name='incidence']")
        .forEach((r) => r.addEventListener("change", onEdit));

    // État initial : rien coché -> masquer l'incidence.
    syncIncidenceVisibility();

    // Boutons – / + du champ âge : incrément borné à [0, 150].
    document.querySelectorAll(".age-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const step = Number(btn.dataset.ageStep);
            const current = Number(els.age.value) || 0;
            const next = Math.max(0, Math.min(150, current + step));
            els.age.value = next;
            els.age.dispatchEvent(new Event("input", { bubbles: true }));
        });
    });
}

/** Clic sur "Lancer l'analyse" : valide, envoie au backend, bascule en workspace. */
async function runAnalysis() {
    if (!state.file) return;

    state.meta = collectMeta();
    if (!validateMeta(state.meta)) {
        els.metaError.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
    }

    // On garde l'aperçu client comme image de base (affiché immédiatement).
    state.viewer.setBaseImage(state.previewUrl || URL.createObjectURL(state.file));

    startProcessing();
    try {
        // Un seul appel : le backend proxifie l'API distante et renvoie
        // prédiction + score + heatmap (data URL) d'un coup.
        const result = await predict(state.file, state.meta);
        state.result = result;

        // Heatmap éventuelle : on active/désactive les modes qui en dépendent.
        const hasHeat = Boolean(result.heatmap);
        if (hasHeat) state.viewer.setHeatImage(result.heatmap);
        els.heatToggle.disabled = !hasHeat;
        els.compareBtn.disabled = !hasHeat;

        renderSynthesis(result);
        stopProcessing(true);
    } catch (err) {
        console.error(err);
        stopProcessing(false);
        alert("Échec de l'analyse.\n" + err.message);
    }
}

/* --------------------------------------------------------------------------- */
/*  Indicateur de traitement temps réel                                        */
/* --------------------------------------------------------------------------- */
function startProcessing() {
    // Si un compteur précédent tourne encore, on l'arrête d'abord.
    if (state.procInterval) clearInterval(state.procInterval);
    els.procTimer.textContent = "0.0 s";
    els.processing.classList.add("active");
    const t0 = performance.now();
    state.procInterval = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        els.procTimer.textContent = s.toFixed(1) + " s";
    }, 60);
}

function stopProcessing(success) {
    if (state.procInterval) {
        clearInterval(state.procInterval);
        state.procInterval = null;
    }
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

    // Métriques d'anomalie renvoyées par le modèle.
    els.scoreAnomalie.textContent =
        result.score_anomalie != null ? Number(result.score_anomalie).toFixed(2) : "—";
    els.seuilValue.textContent =
        result.seuil_utilise != null ? Number(result.seuil_utilise).toFixed(2) : "—";
    els.strategieValue.textContent = result.strategie || "—";

    // Alerte conditionnelle (présente si une anomalie est détectée).
    if (result.alerte) {
        els.alerteText.textContent = result.alerte;
        els.alerteBlock.classList.remove("hidden");
    } else {
        els.alerteBlock.classList.add("hidden");
    }

    // Avertissement pédagogique renvoyé par l'API.
    if (result.avertissement || result.warning) {
        els.disclaimerText.textContent = result.avertissement || result.warning;
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
        // Activer la zone détectée sort du mode comparateur (exclusifs).
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
        // Reflète l'état réel de la zone détectée après sortie du comparateur.
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
        state.result = null;
        clearSelection();
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
/*  Modales (compte-rendu)                                                     */
/* --------------------------------------------------------------------------- */
function bindModals() {
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
// Les scripts de type "module" étant différés, le DOM peut déjà être prêt au
// moment où ce fichier s'exécute : on gère les deux cas pour garantir l'init.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
