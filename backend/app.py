"""
API de la station de travail clinique ARV (Assistant Radiologue Virtuel).

Expose le pipeline d'inférence au frontend :
  GET  /                -> état du backend
  GET  /health          -> sonde de disponibilité
  POST /crop            -> recadrage 320x320 (compat. existante)
  POST /predict         -> contrat JSON complet d'aide à la décision
  POST /heatmap         -> superposition Grad-CAM (image PNG)
  GET  /metrics         -> métriques du modèle (panneau d'audit)
  GET  /audit/logs      -> journal SQLite des inférences de la session
  GET  /audit/stats     -> statistiques agrégées de session
"""
import io
import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.services import audit
from backend.services.imaging import load_image, prepare_image, to_png_bytes
from backend.services.inference import (
    MODEL_METRICS,
    analyze,
    heatmap_overlay,
)
from backend.services.preprocessing import crop_img

app = FastAPI(title="ARV — Assistant Radiologue Virtuel", version="1.0.0")

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


@app.on_event("startup")
def _startup() -> None:
    audit.init_db()


@app.get("/")
def root():
    return {"message": "Backend lancé", "service": "ARV", "status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/crop")
async def crop(file: UploadFile = File(...)):
    """Recadrage centré 320x320 — conservé pour compatibilité avec le front."""
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
    """Analyse complète : renvoie le contrat JSON d'aide à la décision."""
    start = time.perf_counter()

    image_bytes = await file.read()
    image = load_image(image_bytes, file.filename)
    prepared = prepare_image(image)

    elapsed_ms = (time.perf_counter() - start) * 1000
    result = analyze(prepared, inference_time_ms=elapsed_ms)

    # Traçabilité clinique.
    audit.log_inference(
        filename=file.filename,
        predicted_class=result.predicted_class,
        confidence=result.confidence,
        severity=result.severity,
        inference_time_ms=result.inference_time_ms,
        patient_age=age,
        patient_sex=sex,
        orientation=orientation,
    )

    return result.to_dict()


@app.post("/heatmap")
async def heatmap(file: UploadFile = File(...)):
    """Renvoie la radiographie préparée avec la cartographie IA superposée (PNG)."""
    image_bytes = await file.read()
    image = load_image(image_bytes, file.filename)
    prepared = prepare_image(image)

    result = analyze(prepared)
    overlay = heatmap_overlay(prepared, result)
    return Response(content=to_png_bytes(overlay), media_type="image/png")


@app.get("/metrics")
def metrics():
    """Métriques clés du modèle pour le panneau d'audit du jury."""
    return MODEL_METRICS


@app.get("/audit/logs")
def audit_logs(limit: int = 50):
    return {"logs": audit.get_logs(limit)}


@app.get("/audit/stats")
def audit_stats():
    return audit.get_stats()
