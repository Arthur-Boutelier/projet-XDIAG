"""
Chargement et préparation des images radiographiques.

Formats supportés : PNG / JPG / JPEG / WEBP et DICOM (.dcm) si pydicom est installé.
Toutes les images sont ramenées au format d'entrée du modèle : 320x320, niveaux de gris.
"""
import io

import numpy as np
from PIL import Image

from backend.services.preprocessing import SIZE, crop_img

# pydicom est optionnel : l'application fonctionne sans, mais refusera les .dcm
try:
    import pydicom
    _HAS_PYDICOM = True
except ImportError:
    _HAS_PYDICOM = False


def _is_dicom(data: bytes, filename: str) -> bool:
    """Détecte un fichier DICOM via l'extension ou le marqueur 'DICM' (offset 128)."""
    if filename and filename.lower().endswith(".dcm"):
        return True
    return len(data) > 132 and data[128:132] == b"DICM"


def _dicom_to_pil(data: bytes) -> Image.Image:
    """Convertit le pixel array DICOM en image PIL 8 bits niveaux de gris."""
    if not _HAS_PYDICOM:
        raise ValueError("Format DICOM détecté mais pydicom n'est pas installé (pip install pydicom).")

    dataset = pydicom.dcmread(io.BytesIO(data))
    pixels = dataset.pixel_array.astype(np.float32)

    # Normalisation min-max vers 8 bits (les DICOM sont souvent en 12/16 bits)
    pixels -= pixels.min()
    if pixels.max() > 0:
        pixels /= pixels.max()

    # MONOCHROME1 = échelle inversée (blanc = faible densité) -> on ré-inverse
    if getattr(dataset, "PhotometricInterpretation", "") == "MONOCHROME1":
        pixels = 1.0 - pixels

    return Image.fromarray((pixels * 255).astype(np.uint8), mode="L")


def load_image(data: bytes, filename: str = "") -> Image.Image:
    """Charge une image (standard ou DICOM) en niveaux de gris PIL."""
    if _is_dicom(data, filename):
        return _dicom_to_pil(data)
    return Image.open(io.BytesIO(data)).convert("L")


def prepare_image(image: Image.Image) -> Image.Image:
    """
    Ramène n'importe quelle radiographie au format d'entrée du modèle (320x320).

    Contrairement à crop_img (conçu pour CheXpert-small, ~390px), les images
    cliniques réelles peuvent être très grandes : on redimensionne d'abord le
    plus petit côté à 320px (le crop centré ne perd alors que les bords),
    puis on applique le crop centré existant du pipeline.
    """
    w, h = image.size
    ratio = SIZE / min(w, h)
    if ratio != 1.0:
        image = image.resize((max(SIZE, round(w * ratio)), max(SIZE, round(h * ratio))),
                             Image.Resampling.LANCZOS)
    return crop_img(image)


def to_png_bytes(image: Image.Image) -> bytes:
    """Sérialise une image PIL en PNG (bytes)."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()
