/**
 * Visionneuse médicale HD interactive.
 *
 * Fonctions d'examen :
 *   - zoom au scroll + déplacement (pan) ;
 *   - fenêtrage médical : luminosité / contraste ;
 *   - négatif radiologique (inversion) ;
 *   - cartographie IA (superposition Grad-CAM) avec opacité réglable ;
 *   - comparateur avant / après (poignée déplaçable) ;
 *   - plein écran.
 *
 * L'état est encapsulé dans une classe pour rester réutilisable et testable.
 */
export class MedicalViewer {
    constructor(root) {
        this.root = root;
        this.frame = root.querySelector(".viewer-frame");
        this.baseImg = root.querySelector("[data-viewer-base]");
        this.heatImg = root.querySelector("[data-viewer-heat]");
        this.stage = root.querySelector("[data-viewer-stage]");
        this.split = root.querySelector("[data-viewer-split]");
        this.compareLabels = root.querySelector("[data-compare-labels]");

        // Transform (zoom / déplacement).
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;

        // Fenêtrage.
        this.brightness = 100; // %
        this.contrast = 100;   // %
        this.invert = false;

        // Cartographie IA.
        this.heatOn = false;
        this.heatOpacity = 0.75;

        // Comparateur.
        this.compareOn = false;
        this.splitPct = 50;

        this._dragging = false;
        this._splitting = false;
        this._last = { x: 0, y: 0 };

        this._bindEvents();
        this._applyTransform();
        this._applyWindowing();
    }

    /* ---------- Chargement des images ---------- */

    setBaseImage(url) {
        this.baseImg.src = url;
        this.reset();
    }

    setHeatImage(url) {
        this.heatImg.src = url;
    }

    /* ---------- Fenêtrage médical ---------- */

    setBrightness(value) {
        this.brightness = value;
        this._applyWindowing();
    }

    setContrast(value) {
        this.contrast = value;
        this._applyWindowing();
    }

    setInvert(on) {
        this.invert = on;
        this._applyWindowing();
        this.root.classList.toggle("invert-active", on);
    }

    _applyWindowing() {
        // Le fenêtrage et le négatif ne s'appliquent qu'à la radiographie.
        const inv = this.invert ? " invert(1)" : "";
        this.baseImg.style.filter =
            `brightness(${this.brightness}%) contrast(${this.contrast}%)${inv}`;
    }

    /* ---------- Cartographie IA ---------- */

    toggleHeatmap(on) {
        this.heatOn = on;
        this.root.classList.toggle("heat-active", on);
        if (this.compareOn) return; // le comparateur pilote la heatmap lui-même
        this.heatImg.style.opacity = on ? this.heatOpacity : 0;
    }

    setHeatOpacity(value) {
        this.heatOpacity = value;
        if (this.heatOn && !this.compareOn) this.heatImg.style.opacity = value;
    }

    /* ---------- Comparateur avant / après ---------- */

    toggleCompare(on) {
        this.compareOn = on;
        this.root.classList.toggle("compare-active", on);
        this.split.classList.toggle("hidden", !on);
        this.compareLabels.classList.toggle("hidden", !on);

        if (on) {
            // Le comparateur exige une vue non zoomée pour aligner la coupe.
            this.resetZoom();
            this.heatImg.style.opacity = 1;
            this._applySplit(this.splitPct);
        } else {
            this.heatImg.style.clipPath = "none";
            // Restaure l'état cartographie précédent.
            this.heatImg.style.opacity = this.heatOn ? this.heatOpacity : 0;
        }
    }

    _applySplit(pct) {
        this.splitPct = Math.min(95, Math.max(5, pct));
        this.split.style.left = this.splitPct + "%";
        // La cartographie n'est révélée qu'à droite de la poignée.
        this.heatImg.style.clipPath = `inset(0 0 0 ${this.splitPct}%)`;
    }

    /* ---------- Plein écran ---------- */

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.frame.requestFullscreen?.();
        }
    }

    /* ---------- Zoom / Pan ---------- */

    _bindEvents() {
        // Zoom molette.
        this.stage.addEventListener("wheel", (e) => {
            if (this.compareOn) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            const newScale = Math.min(6, Math.max(1, this.scale * delta));
            if (newScale === 1) { this.tx = 0; this.ty = 0; }
            this.scale = newScale;
            this._applyTransform();
        }, { passive: false });

        // Pan à la souris.
        this.stage.addEventListener("mousedown", (e) => {
            if (this.compareOn || this.scale === 1) return;
            this._dragging = true;
            this._last = { x: e.clientX, y: e.clientY };
            this.stage.classList.add("grabbing");
        });
        window.addEventListener("mousemove", (e) => {
            if (this._splitting) return this._onSplitMove(e);
            if (!this._dragging) return;
            this.tx += e.clientX - this._last.x;
            this.ty += e.clientY - this._last.y;
            this._last = { x: e.clientX, y: e.clientY };
            this._applyTransform();
        });
        window.addEventListener("mouseup", () => {
            this._dragging = false;
            this._splitting = false;
            this.stage.classList.remove("grabbing");
        });

        // Double-clic : reset zoom.
        this.stage.addEventListener("dblclick", () => this.resetZoom());

        // Glissement de la poignée du comparateur.
        this.split.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this._splitting = true;
        });
    }

    _onSplitMove(e) {
        const rect = this.frame.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        this._applySplit(pct);
    }

    _applyTransform() {
        this.stage.style.transform =
            `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
        this.root.classList.toggle("zoomed", this.scale > 1);
    }

    resetZoom() {
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this._applyTransform();
    }

    /** Réinitialise complètement la visionneuse (nouvelle image ou bouton reset). */
    reset() {
        this.resetZoom();
        this.brightness = 100;
        this.contrast = 100;
        this.invert = false;
        this.root.classList.remove("invert-active");
        this._applyWindowing();
        this.toggleCompare(false);
        this.toggleHeatmap(false);
    }
}
