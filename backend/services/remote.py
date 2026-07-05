"""
Client de l'API d'inférence distante (radiographie thoracique).

Le backend local sert de PROXY vers l'API déployée sur Azure Container Apps :
  - il évite tout problème de CORS côté navigateur (le front n'appelle que le
    backend local) ;
  - il adapte la réponse (détection binaire d'anomalie) au contrat attendu par
    l'interface clinique ;
  - il regroupe prédiction + probabilités + heatmap en un seul appel distant.

L'API distante peut être lente au premier appel (démarrage à froid du conteneur
Azure « scale-to-zero ») : le timeout est volontairement large.
"""
from __future__ import annotations

import os

import httpx

# URL de l'API distante — surchargeable via la variable d'environnement
# XRAY_API_BASE (pratique pour pointer un mock local ou un autre déploiement).
API_BASE = os.environ.get(
    "XRAY_API_BASE",
    "https://xray-api-efrei.delightfulbeach-8c2a5467.swedencentral.azurecontainerapps.io",
).rstrip("/")

# Timeout large : le cold start Azure peut dépasser deux minutes.
_TIMEOUT = httpx.Timeout(240.0, connect=30.0)

# Correspondance des métadonnées front -> paramètres de l'API distante.
# Le front envoie déjà l'une de ces quatre valeurs telles quelles.
_VUE_MAP = {"AP": "AP", "PA": "PA", "FRONTAL": "FRONTAL", "LATERAL": "LATERAL"}
_SEXE_MAP = {"male": "M", "female": "F", "M": "M", "F": "F"}


def to_vue(orientation: str | None) -> str:
    """Convertit l'incidence du formulaire en valeur attendue (AP/PA/FRONTAL/LATERAL)."""
    if not orientation:
        return "FRONTAL"
    return _VUE_MAP.get(orientation, "FRONTAL")


def to_sexe(sex: str | None) -> str:
    """Convertit le sexe du formulaire (male/female) en M/F."""
    return _SEXE_MAP.get(sex or "", "M")


async def predict(image_bytes: bytes, filename: str, *, vue: str, age, sexe: str,
                  inclure_heatmap: bool = True, inclure_probabilites: bool = True) -> dict:
    """Appelle l'endpoint /predict distant et renvoie le JSON brut."""
    data = {
        "vue": vue,
        "age": str(age) if age not in (None, "") else "0",
        "sexe": sexe,
        "inclure_heatmap": str(inclure_heatmap).lower(),
        "inclure_probabilites": str(inclure_probabilites).lower(),
    }
    files = {"fichier": (filename or "image.png", image_bytes, "application/octet-stream")}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(f"{API_BASE}/predict", data=data, files=files)
        resp.raise_for_status()
        return resp.json()


# --------------------------------------------------------------------------- #
#  Adaptation de la réponse distante au contrat de l'interface
# --------------------------------------------------------------------------- #
# Seuil (affichage) au-delà duquel le score d'anomalie déclenche un badge rouge.
_SEVERITY_ALERT = 0.66

_FALLBACK_WARNING = (
    "Outil d'aide au diagnostic — Le diagnostic final et la validation clinique "
    "relèvent exclusivement du médecin radiologue."
)


def map_result(api: dict, inference_time_ms: float) -> dict:
    """Traduit la réponse binaire de l'API en objet consommé par le front.

    Le modèle fait UNIQUEMENT de la détection d'anomalie : on n'affiche donc ni
    nom de pathologie ni distribution de probabilités par classe (jugée peu
    fiable). En cas d'anomalie, on oriente vers un médecin compétent.
    """
    anomalie = bool(api.get("anomalie_detectee"))
    confidence = float(api.get("niveau_de_confiance") or 0.0)
    score = float(api.get("score_anomalie") or 0.0)

    predicted = "Anomalie détectée" if anomalie else "Examen sans anomalie significative"

    # Sévérité (couleur du badge) : plus le score est haut, plus l'alerte est forte.
    if not anomalie:
        severity = "normal"
    elif score >= _SEVERITY_ALERT:
        severity = "alert"
    else:
        severity = "watch"

    # En cas d'anomalie, orientation vers un médecin (on ne peut pas préciser
    # quelle anomalie). L'alerte fournie par l'API prime si elle existe.
    if anomalie:
        alerte = api.get("alerte") or (
            "Une anomalie a été détectée sur ce cliché. Il est fortement "
            "recommandé de consulter un médecin radiologue pour un diagnostic "
            "précis et une prise en charge adaptée."
        )
    else:
        alerte = None

    result = {
        "anomalie_detectee": anomalie,
        "predicted_class": predicted,
        "confidence": round(confidence * 100, 1),
        "score_anomalie": round(score, 3),
        "seuil_utilise": api.get("seuil_utilise"),
        "strategie": api.get("strategie"),
        "severity": severity,
        "avertissement": api.get("avertissement") or _FALLBACK_WARNING,
        "alerte": alerte,
        "warning": api.get("avertissement") or _FALLBACK_WARNING,
        "inference_time_ms": round(inference_time_ms, 1),
    }

    # Heatmap éventuelle -> data URL directement exploitable par une balise <img>.
    hb = api.get("heatmap_base64")
    if hb:
        result["heatmap"] = hb if str(hb).startswith("data:") else f"data:image/png;base64,{hb}"

    return result
