"""
Collecte des commentaires YouTube et sauvegarde en local (JSON).
pour développer les analyses sans rappeler l'API à chaque essai.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

import youtube

DEFAULT_OUTPUT_DIR = Path(__file__).parent / "data"


def collect(client, video_url: str, max_comments: int, output_dir: Path) -> Path:
    """Récupérer les métadonnées et les commentaires d'une vidéo, puis les écrire dans <video_id>.json."""
    video_id = youtube.extract_video_id(video_url)
    video_meta = youtube.fetch_video_meta(client, video_id)
    raw_comments = youtube.fetch_comments(client, video_id, max_comments, order="time")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{video_id}.json"
    payload = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "video": asdict(video_meta),
        "comments": [asdict(c) for c in raw_comments],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def load_dataset(path: str | Path) -> tuple[youtube.VideoMeta, list[youtube.RawComment]]:
    """Relire un fichier JSON produit par collect() et rendre les mêmes objets que youtube.py."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    video_meta = youtube.VideoMeta(**payload["video"])
    raw_comments = [youtube.RawComment(**c) for c in payload["comments"]]
    return video_meta, raw_comments


if __name__ == "__main__":
    load_dotenv()

    parser = argparse.ArgumentParser(description="Collecte des commentaires YouTube en local.")
    parser.add_argument("urls", nargs="+", help="Une ou plusieurs URL (ou identifiants) de vidéos.")
    parser.add_argument("--max-comments", type=int, default=None, help="Nombre maximum de commentaires par vidéo (tous par défaut).")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Dossier de sauvegarde.")
    args = parser.parse_args()

    client = youtube.get_client(os.getenv("YOUTUBE_API_KEY", ""))
    for url in args.urls:
        try:
            path = collect(client, url, args.max_comments or sys.maxsize, Path(args.output_dir))
            print(f"OK  {url} -> {path}")
        except youtube.YouTubeError as exc:
            print(f"ERR {url} : {exc}")