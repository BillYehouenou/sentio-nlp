"""Module FastAPI pour Sentio.

Cycle de vie du modèle : la session ONNX et le tokenizer sont chargés une seule fois, 
dans le hook de démarrage <lifespan> ci-dessous et conservés en mémoire pendant toute la durée du processus.
"""


from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import analysis
import sentiment
import youtube
from schemas import AnalyzeRequest, AnalyzeResponse

load_dotenv()

MODEL_DIR = Path(__file__).parent / "model"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    ["*"]
    if _allowed_origins_raw == "*"
    else [origin.strip() for origin in _allowed_origins_raw.split(",") if origin.strip()]
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        sentiment.load_model(MODEL_DIR)
    except FileNotFoundError as exc:
        # Le serveur peut toujours démarrer (par exemple pour /api/health), mais /api/analyze échouera clairement jusqu'à ce que `setup_models.py --onnx` ait été exécuté.
        print(f"[startup] WARNING: {exc}")
    yield


app = FastAPI(title="Sentio API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_loaded": sentiment.is_loaded(),
        "youtube_api_key_configured": bool(YOUTUBE_API_KEY),
    }


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    if not sentiment.is_loaded():
        raise HTTPException(
            status_code=503,
            detail="Le modèle de sentiment n'est pas chargé. Lance `setup_models.py --onnx` puis redémarre le serveur.",
        )

    try:
        video_id = youtube.extract_video_id(request.video_url)
        client = youtube.get_client(YOUTUBE_API_KEY)
        video_meta = youtube.fetch_video_meta(client, video_id)
        raw_comments = youtube.fetch_comments(client, video_id, request.max_comments)
    except youtube.InvalidVideoURLError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except youtube.VideoNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except youtube.CommentsDisabledError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except youtube.QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except youtube.YouTubeAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not raw_comments:
        raise HTTPException(status_code=422, detail="Aucun commentaire n'a pu être récupéré pour cette vidéo.")

    cleaned_texts = [youtube.clean_text(c.text) for c in raw_comments]

    start = time.perf_counter()
    predictions = sentiment.predict_batch(cleaned_texts)
    elapsed_ms = (time.perf_counter() - start) * 1000

    labels = [p["label"] for p in predictions]
    scores = [p["score"] for p in predictions]

    return {
        "video": {
            "title": video_meta.title,
            "channel": video_meta.channel,
            "comment_count": len(raw_comments),
            "published_at": video_meta.published_at,
            "thumbnail_url": video_meta.thumbnail_url,
        },
        "summary": analysis.build_summary(labels, scores),
        "timeline": analysis.build_timeline(raw_comments, labels),
        "top_words": analysis.build_top_words(cleaned_texts, labels),
        "comments": analysis.build_comments(raw_comments, cleaned_texts, predictions),
        "meta": {
            "model": f"cardiffnlp/twitter-xlm-roberta-base-sentiment ({sentiment.ONNX_FILENAME})",
            "runtime": sentiment.runtime_version(),
            "latency_ms_per_comment": round(elapsed_ms / len(raw_comments), 2),
        },
    }


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
