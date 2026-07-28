import pytest
from pydantic import ValidationError

from analysis import build_summary, build_timeline, build_top_words
from schemas import AnalyzeRequest
from youtube import InvalidVideoURLError, RawComment, clean_text, extract_video_id

# Extraction YouTube

VALID_URLS = [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
]


@pytest.mark.parametrize("url, expected_id", VALID_URLS)
def test_extract_video_id_accepts_common_url_shapes(url, expected_id):
    assert extract_video_id(url) == expected_id


INVALID_URLS = [
    "",
    "not a url",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=tooshort",
    "https://www.youtube.com/watch",
]


@pytest.mark.parametrize("url", INVALID_URLS)
def test_extract_video_id_rejects_invalid_input(url):
    with pytest.raises(InvalidVideoURLError):
        extract_video_id(url)


def test_clean_text_strips_urls():
    assert clean_text("Check this out https://example.com/foo now") == "Check this out now"


def test_clean_text_collapses_whitespace():
    assert clean_text("too   many\n\nspaces") == "too many spaces"


def test_clean_text_unescapes_html_entities():
    assert clean_text("Tom &amp; Jerry") == "Tom & Jerry"


# analysis.py: aggregation


def test_build_summary_computes_percentages_and_confidence():
    labels = ["positive", "positive", "neutral", "negative"]
    scores = [0.9, 0.8, 0.6, 0.7]

    summary = build_summary(labels, scores)

    assert summary["positive_pct"] == 50.0
    assert summary["neutral_pct"] == 25.0
    assert summary["negative_pct"] == 25.0
    assert summary["avg_confidence"] == round(sum(scores) / len(scores), 3)


def test_build_summary_handles_no_comments():
    assert build_summary([], []) == {
        "positive_pct": 0,
        "neutral_pct": 0,
        "negative_pct": 0,
        "avg_confidence": 0,
    }


def test_build_timeline_groups_by_month_and_skips_unparseable_dates():
    comments = [
        RawComment(text="a", author="A", like_count=0, published_at="2024-01-15T10:00:00Z"),
        RawComment(text="b", author="B", like_count=0, published_at="2024-01-20T10:00:00Z"),
        RawComment(text="c", author="C", like_count=0, published_at="2024-02-01T10:00:00Z"),
        RawComment(text="d", author="D", like_count=0, published_at="not-a-date"),
    ]
    labels = ["positive", "negative", "neutral", "positive"]

    assert build_timeline(comments, labels) == [
        {"period": "2024-01", "positive": 1, "neutral": 0, "negative": 1},
        {"period": "2024-02", "positive": 0, "neutral": 1, "negative": 0},
    ]


def test_build_top_words_filters_stopwords_by_sentiment():
    texts = ["ce video est vraiment genial et super", "genial genial mais un peu long"]
    labels = ["positive", "positive"]

    result = build_top_words(texts, labels)
    positive_words = [w["word"] for w in result["positive"]]

    assert "genial" in positive_words
    assert "video" not in positive_words 
    assert result["neutral"] == []
    assert result["negative"] == []


# schemas.py: request validation


def test_analyze_request_defaults_to_500_comments():
    req = AnalyzeRequest(video_url="https://youtu.be/dQw4w9WgXcQ")
    assert req.max_comments == 500


@pytest.mark.parametrize("value", [0, -5, 501, 10000])
def test_analyze_request_rejects_out_of_range_max_comments(value):
    with pytest.raises(ValidationError):
        AnalyzeRequest(video_url="https://youtu.be/dQw4w9WgXcQ", max_comments=value)
