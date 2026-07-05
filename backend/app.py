"""
API de la station de travail clinique X-DIAG.

Le backend local sert de PROXY/adaptateur vers l'API d'inférence distante
(Azure Container Apps) : le frontend n'appelle que ce backend (pas de CORS),
et la réponse distante (détection binaire d'anomalie) est adaptée au contrat
attendu par l'interface.

  GET  /                -> état du backend
  GET  /health          -> sonde de disponibilité
  POST /crop            -> recadrage 320x320 (compat. locale, non utilisé par le front)
  POST /predict         -> proxy vers l'API distante + mapping
  POST /heatmap         -> heatmap distante décodée en PNG (fallback)
  GET  /metrics         -> métriques de référence du modèle
"""
import base64
import time

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.services import remote
from backend.services.imaging import load_image, to_png_bytes
from backend.services.inference import MODEL_METRICS
from backend.services.preprocessing import crop_img

app = FastAPI(title="X-DIAG", version="2.1.0")

# CORS : on autorise les serveurs statiques usuels (IDE, http.server, live server).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:63342",
        "http://127.0.0.1:63342",
        "http://localhost:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Backend lancé", "service": "X-DIAG", "status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/crop")
async def crop(file: UploadFile = File(...)):
    """Recadrage centré 320x320 — conservé pour compatibilité locale."""
    image_bytes = await file.read()
    image = load_image(image_bytes, file.filename)
    cropped = crop_img(image)
    return Response(content=to_png_bytes(cropped), media_type="image/png")


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    age: int = Form(None),
    sex: str = Form(None),
    orientation: str = Form(None),
):
    """Proxy vers l'API distante : renvoie le contrat JSON adapté à l'interface."""
    start = time.perf_counter()
    image_bytes = await file.read()

    try:
        # inclure_probabilites=False : les probabilités par classe ne sont pas
        # jugées fiables — on s'en tient à la détection binaire d'anomalie.
        api_response = await remote.predict(
            image_bytes,
            file.filename,
            vue=remote.to_vue(orientation),
            age=age,
            sexe=remote.to_sexe(sex),
            inclure_heatmap=True,
            inclure_probabilites=False,
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="L'API d'inférence n'a pas répondu à temps (démarrage à froid possible, réessayez).",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Erreur de l'API distante ({exc.response.status_code}).")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"API d'inférence injoignable : {exc}")

    elapsed_ms = (time.perf_counter() - start) * 1000
    return remote.map_result(api_response, elapsed_ms)


@app.post("/heatmap")
async def heatmap(
    file: UploadFile = File(...),
    age: int = Form(None),
    sex: str = Form(None),
    orientation: str = Form(None),
):
    """Récupère la heatmap distante et la renvoie en PNG (fallback ; /predict la fournit déjà)."""
    image_bytes = await file.read()
    try:
        api_response = await remote.predict(
            image_bytes, file.filename,
            vue=remote.to_vue(orientation), age=age, sexe=remote.to_sexe(sex),
            inclure_heatmap=True, inclure_probabilites=False,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"API d'inférence injoignable : {exc}")

    hb = api_response.get("heatmap_base64")
    if not hb:
        raise HTTPException(status_code=404, detail="Aucune heatmap renvoyée par l'API.")
    raw = base64.b64decode(str(hb).split(",")[-1])
    return Response(content=raw, media_type="image/png")


@app.get("/metrics")
def metrics():
    """Métriques de référence du modèle."""
    return MODEL_METRICS
