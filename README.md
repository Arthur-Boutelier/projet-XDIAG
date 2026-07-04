# ARV — Assistant Radiologue Virtuel

Station de travail clinique pour l'analyse assistée de radiographies thoraciques
frontales. Interface web « Dark Medical » branchée sur un pipeline d'inférence
FastAPI (prétraitement CheXpert 320×320 + moteur d'analyse + cartographie IA).

## Architecture

```
backend/
  app.py                     API FastAPI (routes /predict, /heatmap, /crop, /metrics, /audit)
  services/
    preprocessing.py         Pipeline existant (crop 320x320, normalisation)
    imaging.py               Chargement PNG/JPG/WEBP/DICOM + mise au format modèle
    inference.py             Moteur d'inférence + contrat JSON + heatmap Grad-CAM
    audit.py                 Journal de traçabilité SQLite
  audit.sqlite3              Base créée au premier lancement (traçabilité session)

frontend/
  index.html                 Station de travail (import + visionneuse + synthèse)
  css/theme.css              Thème clinique sombre, glassmorphism
  js/
    api.js                   Accès backend
    viewer.js                Visionneuse (zoom, fenêtrage, toggle heatmap)
    app.js                   Orchestrateur
    report.js                Compte-rendu + export JSON / PDF
    audit.js                 Panneau Performance & Audit IA
```

## Lancement

Prérequis : Python 3.10+.

```bash
pip install -r requirements.txt

# 1) Backend (port 8000)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000

# 2) Frontend (port 5500) — dans un second terminal
python -m http.server 5500 --directory frontend
```

Ouvrir http://localhost:5500 puis glisser une radiographie thoracique frontale
(PNG / JPG / WEBP / DICOM). L'analyse s'affiche en moins de 10 secondes.

## Outils de la visionneuse

| Outil | Raccourci | Description |
|-------|-----------|-------------|
| Cartographie IA | `H` | Superpose la carte d'activation (Grad-CAM) |
| Comparer | `C` | Comparateur avant / après à poignée déplaçable |
| Négatif | `N` | Inversion radiologique |
| Plein écran | `F` | Visionneuse plein écran |
| Réinitialiser | `R` | Réinitialise zoom, fenêtrage et modes |
| Zoom / Pan | molette / glisser | Double-clic pour recentrer |

La colonne de synthèse affiche aussi un **diagnostic différentiel** : la
distribution des probabilités du modèle sur les principales pathologies.

## Contrat JSON (`POST /predict`)

```json
{
  "predicted_class": "Atélectasie basale probable",
  "confidence": 82.4,
  "visual_evidence": ["Perte de volume basale", "..."],
  "justification": "…",
  "recommendations": ["Corrélation clinique", "…"],
  "limitations": ["…"],
  "warning": "Assistance IA — …",
  "severity": "watch",
  "scores": { "…": 82.4 },
  "region": "base_gauche",
  "inference_time_ms": 84.2
}
```

## Brancher un vrai modèle

Le dépôt fournit le prétraitement mais pas de poids entraînés. Le moteur
(`backend/services/inference.py`) produit un résultat déterministe et cohérent
pour la démonstration. Pour intégrer un modèle réel, remplacer `_predict_scores()`
par `model.predict(preprocessing(prepared_image))` — le reste du contrat
(formatage, heatmap, audit) reste inchangé.

> Outil d'aide à la décision. Le diagnostic final et la validation clinique
> relèvent exclusivement du médecin radiologue.
