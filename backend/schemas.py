"""Contrats de données d'entrée et de sortie pour l'API d'analyse de vidéos YouTube."""

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    video_url: str
    max_comments: int = Field(default=500, ge=1, le=500)


class VideoInfo(BaseModel):
    title: str
    channel: str
    comment_count: int
    published_at: str
    thumbnail_url: str | None = None


class Summary(BaseModel):
    positive_pct: float
    neutral_pct: float
    negative_pct: float
    avg_confidence: float


class TimelinePoint(BaseModel):
    period: str
    positive: int
    neutral: int
    negative: int


class WordCount(BaseModel):
    word: str
    count: int


class TopWords(BaseModel):
    positive: list[WordCount]
    neutral: list[WordCount]
    negative: list[WordCount]


class CommentOut(BaseModel):
    text: str
    author: str
    like_count: int
    score: float


class CommentsBySentiment(BaseModel):
    positive: list[CommentOut]
    neutral: list[CommentOut]
    negative: list[CommentOut]


class Meta(BaseModel):
    model: str
    runtime: str
    latency_ms_per_comment: float


class AnalyzeResponse(BaseModel):
    video: VideoInfo
    summary: Summary
    timeline: list[TimelinePoint]
    top_words: TopWords
    comments: CommentsBySentiment
    meta: Meta
