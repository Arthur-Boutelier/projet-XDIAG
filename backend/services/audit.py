"""
Journal de traçabilité clinique (SQLite).

Enregistre chaque inférence réalisée pendant la session : horodatage, fichier,
conclusion, confiance et latence. Alimente le panneau "Performance & Audit IA"
de l'interface, exigé pour la traçabilité médicale.
"""
import os
import sqlite3
from datetime import datetime, timezone
from threading import Lock

# Base placée à côté du backend pour rester locale et portable.
_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "audit.sqlite3")
_lock = Lock()  # SQLite + FastAPI async : on sérialise les écritures.


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Crée la table d'audit si absente (idempotent)."""
    with _lock, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inferences (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp         TEXT    NOT NULL,
                filename          TEXT,
                predicted_class   TEXT    NOT NULL,
                confidence        REAL    NOT NULL,
                severity          TEXT,
                inference_time_ms REAL,
                patient_age       INTEGER,
                patient_sex       TEXT,
                orientation       TEXT
            )
            """
        )


def log_inference(*, filename: str, predicted_class: str, confidence: float,
                  severity: str, inference_time_ms: float,
                  patient_age=None, patient_sex=None, orientation=None) -> dict:
    """Insère une ligne d'audit et renvoie l'enregistrement créé."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "filename": filename,
        "predicted_class": predicted_class,
        "confidence": confidence,
        "severity": severity,
        "inference_time_ms": inference_time_ms,
        "patient_age": patient_age,
        "patient_sex": patient_sex,
        "orientation": orientation,
    }
    with _lock, _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO inferences
                (timestamp, filename, predicted_class, confidence, severity,
                 inference_time_ms, patient_age, patient_sex, orientation)
            VALUES
                (:timestamp, :filename, :predicted_class, :confidence, :severity,
                 :inference_time_ms, :patient_age, :patient_sex, :orientation)
            """,
            record,
        )
        record["id"] = cur.lastrowid
    return record


def get_logs(limit: int = 50) -> list:
    """Retourne les dernières inférences (plus récentes d'abord)."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM inferences ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats() -> dict:
    """Statistiques agrégées de la session pour le panneau d'audit."""
    with _lock, _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*)              AS total,
                   AVG(inference_time_ms) AS avg_time,
                   AVG(confidence)        AS avg_confidence
            FROM inferences
            """
        ).fetchone()
    return {
        "total_inferences": row["total"] or 0,
        "avg_time_ms": round(row["avg_time"], 1) if row["avg_time"] else 0.0,
        "avg_confidence": round(row["avg_confidence"], 1) if row["avg_confidence"] else 0.0,
    }
