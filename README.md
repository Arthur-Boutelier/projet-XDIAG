# X-DIAG

Station de travail clinique pour la **détection assistée d'anomalies sur
radiographie thoracique**. Interface web « Dark Medical » branchée, via un
**backend FastAPI qui sert de proxy**, sur l'API d'inférence distante déployée
sur Azure Container Apps.

Le modèle indique la présence ou l'absence d'anomalie ; il ne nomme pas la
pathologie — le diagnostic précis relève d'un médecin radiologue.

Le backend local évite les problèmes de CORS (le front ne parle qu'à lui) et
adapte la réponse de l'API au format consommé par l'interface.

## Architecture

```
backend/
  app.py                     Proxy FastAPI (routes /predict, /heatmap, /metrics)
  services/
    remote.py                Client de l'API distante + mapping de la réponse
    preprocessing.py         Pipeline CheXpert (crop 320x320, normalisation)
    imaging.py               Chargement PNG/JPG/WEBP/DICOM
    inference.py             Métriques de référence du modèle

frontend/
  index.html                 Station de travail (import + visionneuse + synthèse)
  css/theme.css              Thème clinique sombre, glassmorphism
  js/
    api.js                   Accès au backend local
    viewer.js                Visionneuse (zoom, fenêtrage, négatif, comparateur, heatmap)
    app.js                   Orchestrateur
    report.js                Compte-rendu + export JSON / PDF
```

## API distante

Le backend appelle par défaut l'API déployée. L'URL est surchargeable via la
variable d'environnement `XRAY_API_BASE` (utile pour pointer un mock local ou un
autre déploiement) :

```bash
# Exemple : pointer une API locale
XRAY_API_BASE="http://127.0.0.1:8100" python -m uvicorn backend.app:app --port 8000
```

> ⏱️ Le conteneur Azure est en « scale-to-zero » : le **premier appel après une
> période d'inactivité peut prendre 1 à 3 minutes** (démarrage à froid). Le
> timeout du proxy est réglé large en conséquence. Pour une démo fluide, prévoir
> un appel de « préchauffage » juste avant, ou configurer `minReplicas: 1`.

## Lancement

Prérequis : Python 3.10+.

```bash
pip install -r requirements.txt

# 1) Backend (port 8000)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000

# 2) Frontend (port 5500) — dans un second terminal
python -m http.server 5500 --directory frontend
```

Ouvrir http://localhost:5500 puis renseigner le contexte clinique (âge, sexe,
incidence — obligatoire) et glisser une radiographie thoracique
(PNG / JPG / WEBP / DICOM). L'analyse démarre automatiquement.

## Outils de la visionneuse

| Outil | Raccourci | Description |
|-------|-----------|-------------|
| Zone détectée | `H` | Superpose la zone d'intérêt renvoyée par le modèle |
| Comparer | `C` | Comparateur avant / après à poignée déplaçable |
| Négatif | `N` | Inversion radiologique |
| Plein écran | `F` | Visionneuse plein écran |
| Réinitialiser | `R` | Réinitialise zoom, fenêtrage et modes |
| Zoom / Pan | molette / glisser | Double-clic pour recentrer |

La colonne de synthèse indique **anomalie oui/non** avec le score et la
confiance. En cas d'anomalie, une orientation vers un médecin radiologue est
affichée — le nom précis de la pathologie n'est **pas** produit (l'API ne fait
que de la détection binaire).

## Contrat JSON (`POST /predict` du backend local)

Le backend renvoie au front la réponse de l'API distante, adaptée :

```json
{
  "anomalie_detectee": true,
  "predicted_class": "Anomalie détectée",
  "confidence": 76.0,
  "score_anomalie": 0.82,
  "seuil_utilise": 0.5,
  "strategie": "max_aggregation",
  "severity": "alert",
  "alerte": "Une anomalie a été détectée sur ce cliché. Il est fortement recommandé de consulter un médecin radiologue…",
  "avertissement": "Outil pédagogique — …",
  "warning": "Outil pédagogique — …",
  "heatmap": "data:image/png;base64,…",
  "inference_time_ms": 286.9
}
```

Le mapping API distante → interface est dans `backend/services/remote.py`
(`map_result`). Hypothèses (conformes à la doc de l'API) : `niveau_de_confiance`
et `score_anomalie` sont exprimés entre 0 et 1.

> Outil d'aide à la décision. Le diagnostic final et la validation clinique
> relèvent exclusivement du médecin radiologue.
