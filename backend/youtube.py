"""Récupération des commentaires YouTube et nettoyage du texte."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


class YouTubeError(Exception):
    """Classe de base pour toutes les erreurs liées à YouTube traitées."""


class InvalidVideoURLError(YouTubeError):
    pass


class VideoNotFoundError(YouTubeError):
    pass


class CommentsDisabledError(YouTubeError):
    pass


class QuotaExceededError(YouTubeError):
    pass


class YouTubeAPIError(YouTubeError):
    """Any other upstream API failure we don't special-case."""


@dataclass
class VideoMeta:
    video_id: str
    title: str
    channel: str
    published_at: str
    thumbnail_url: str | None


@dataclass
class RawComment:
    text: str
    author: str
    like_count: int
    published_at: str


def extract_video_id(video_url: str) -> str:
    """Extraire l'identifiant de vidéo de 11 caractères d'une URL YouTube commune."""
    url = video_url.strip()
    if re.compile(r"^[a-zA-Z0-9_-]{11}$").match(url):
        return url

    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise InvalidVideoURLError(f"URL invalide : {video_url!r}") from exc

    if not parsed.scheme or not parsed.netloc:
        raise InvalidVideoURLError(f"URL invalide : {video_url!r}")

    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")

    video_id: str | None = None
    if host == "youtu.be":
        video_id = parsed.path.lstrip("/").split("/")[0]
    elif host in {"youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [None])[0]
        elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
            video_id = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else None

    if not video_id or not re.compile(r"^[a-zA-Z0-9_-]{11}$").match(video_id):
        raise InvalidVideoURLError(f"Impossible d'extraire l'identifiant de vidéo depuis : {video_url!r}")

    return video_id


def clean_text(text: str) -> str:
    """Nettoyer le texte d'un commentaire YouTube en supprimant les liens, les entités HTML et les espaces blancs superflus."""
    text = html.unescape(text)
    text = re.compile(r"https?://\S+|www\.\S+").sub(" ", text)
    text = re.compile(r"\s+").sub(" ", text)
    return text.strip()


def _error_reason(exc: HttpError) -> str:
    try:
        errors = exc.error_details
        if errors:
            reason = errors[0].get("reason") if isinstance(errors[0], dict) else None
            if reason:
                return reason
    except Exception:
        pass
    return str(exc.reason or "")


def get_client(api_key: str):
    if not api_key:
        raise YouTubeAPIError("Clé API YouTube manquante.")
    return build("youtube", "v3", developerKey=api_key, cache_discovery=False)


def fetch_video_meta(youtube, video_id: str) -> VideoMeta:
    try:
        response = youtube.videos().list(part="snippet", id=video_id).execute()
    except HttpError as exc:
        reason = _error_reason(exc)
        if "quotaExceeded" in reason or "dailyLimitExceeded" in reason:
            raise QuotaExceededError("Le quota de l'API YouTube est dépassé pour aujourd'hui.") from exc
        raise YouTubeAPIError(f"Erreur API YouTube : {reason or exc}") from exc

    items = response.get("items", [])
    if not items:
        raise VideoNotFoundError(f"Aucune vidéo trouvée pour l'identifiant {video_id!r}.")

    snippet = items[0]["snippet"]
    thumbnails = snippet.get("thumbnails", {})
    thumbnail = thumbnails.get("medium") or thumbnails.get("high") or thumbnails.get("default")

    return VideoMeta(
        video_id=video_id,
        title=snippet.get("title", ""),
        channel=snippet.get("channelTitle", ""),
        published_at=snippet.get("publishedAt", ""),
        thumbnail_url=thumbnail.get("url") if thumbnail else None,
    )


def fetch_comments(youtube, video_id: str, max_comments: int) -> list[RawComment]:
    comments: list[RawComment] = []
    page_token: str | None = None

    while len(comments) < max_comments:
        try:
            response = (
                youtube.commentThreads()
                .list(
                    part="snippet",
                    videoId=video_id,
                    maxResults=min(100, max_comments - len(comments)),
                    pageToken=page_token,
                    textFormat="plainText",
                )
                .execute()
            )
        except HttpError as exc:
            reason = _error_reason(exc)
            if "commentsDisabled" in reason:
                raise CommentsDisabledError("Les commentaires sont désactivés pour cette vidéo.") from exc
            if "quotaExceeded" in reason or "dailyLimitExceeded" in reason:
                raise QuotaExceededError("Le quota de l'API YouTube est dépassé pour aujourd'hui.") from exc
            if "videoNotFound" in reason:
                raise VideoNotFoundError(f"Aucune vidéo trouvée pour l'identifiant {video_id!r}.") from exc
            raise YouTubeAPIError(f"Erreur API YouTube : {reason or exc}") from exc

        for item in response.get("items", []):
            top_level = item["snippet"]["topLevelComment"]["snippet"]
            comments.append(
                RawComment(
                    text=top_level.get("textDisplay", ""),
                    author=top_level.get("authorDisplayName", "Anonyme"),
                    like_count=int(top_level.get("likeCount", 0)),
                    published_at=top_level.get("publishedAt", ""),
                )
            )
            if len(comments) >= max_comments:
                break

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return comments
