import io
from statistics import median_low

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image

from backend.services.preprocessing import crop_img
# from routes.predict import router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:63342",
        "http://127.0.0.1:63342",
        "http://localhost:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# app.include_router(router)


@app.get("/")
def root():
    return {"message": "Backend lancé"}


@app.post("/crop")
async def crop(file: UploadFile = File(...)):
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes)).convert('L')
    cropped = crop_img(image)

    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    buf.seek(0)

    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes)).convert('L')
    image = crop_img(image)

    return {
        "filename": file.filename,
        "Pathologies_detectees": [
            "Lung Opacity",
            "Pleural Effusion",
            "Support Devices"
        ],
        "Incertain": [
            "Consolidation",
            "Atelectasis"
        ]}
