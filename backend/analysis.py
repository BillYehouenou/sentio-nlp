"""
Aggrégation des résultats obtenus suite à l'analyse de sentiment de chaque commentaire.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime

from youtube import RawComment

_WORD_RE = re.compile(r"[a-zà-öø-ÿ]+", re.IGNORECASE)


# Dictionnaire de stopwords du language courant
STOPWORDS = frozenset(
    """
    le la les l un une des du de d et en on ne pas se ce cet cette ces qui que
    quoi dont ou où est sont suis es était étais été être avoir a ai as ont
    au aux avec sans pour par sur sous dans vers chez entre je tu il elle nous
    vous ils elles moi toi lui eux mon ma mes ton ta tes son sa ses notre nos
    votre vos leur leurs y en si mais donc or ni car comme plus moins très
    trop bien mal aussi alors quand comment pourquoi tout tous toute toutes
    rien personne autre autres même mêmes cela ça ceci celui celle ceux celles
    the a an and or but if then so to of in on at for with without from by
    as is am are was were be been being have has had do does did will would
    can could shall should may might must not no nor this that these those
    i you he she it we they me him her us them my your his its our their
    what which who whom whose when where why how all any both each few more
    most other some such only own same than too very s t just don now
    video vidéo youtube comment commentaire chaîne channel https http www com

    fait faire dit dire soit bout quel quelle quels quelles fois tiens
    donc bah ba genre grave mdr ptdr lol tellement jsuis jsp askip sah
    wesh frero frere coup ouais ouai hein euh bref enfin voila voila
    sinon franchement carrement direct style truc chose ptn omg mdrr
    mdrrr jpp osef nn ouai nan bcp qqn qqch stp svp tkt
    """.split()
)

TOP_WORDS_PER_SENTIMENT = 10
STANDOUT_COMMENTS_PER_SENTIMENT = 5


def _extract_words(text: str) -> list[str]:
    return [w for w in _WORD_RE.findall(text.lower()) if len(w) >= 3 and w not in STOPWORDS]


def build_summary(labels: list[str], scores: list[float]) -> dict:
    total = len(labels)
    if total == 0:
        return {"positive_pct": 0, "neutral_pct": 0, "negative_pct": 0, "avg_confidence": 0}

    counts = Counter(labels)
    return {
        "positive_pct": round(100 * counts.get("positive", 0) / total, 1),
        "neutral_pct": round(100 * counts.get("neutral", 0) / total, 1),
        "negative_pct": round(100 * counts.get("negative", 0) / total, 1),
        "avg_confidence": round(sum(scores) / total, 3),
    }


def build_timeline(comments: list[RawComment], labels: list[str]) -> list[dict]:
    buckets: dict[str, Counter] = defaultdict(Counter)

    for comment, label in zip(comments, labels):
        try:
            period = datetime.fromisoformat(comment.published_at.replace("Z", "+00:00")).strftime("%Y-%m")
        except ValueError:
            continue
        buckets[period][label] += 1

    return [
        {
            "period": period,
            "positive": buckets[period].get("positive", 0),
            "neutral": buckets[period].get("neutral", 0),
            "negative": buckets[period].get("negative", 0),
        }
        for period in sorted(buckets)
    ]


def build_top_words(cleaned_texts: list[str], labels: list[str]) -> dict:
    """Mot clé pour chaque commentaire analysé"""
    counters: dict[str, Counter] = {"positive": Counter(), "neutral": Counter(), "negative": Counter()}

    for text, label in zip(cleaned_texts, labels):
        counters[label].update(_extract_words(text))

    return {
        sentiment: [
            {"word": word, "count": count} for word, count in counter.most_common(TOP_WORDS_PER_SENTIMENT)
        ]
        for sentiment, counter in counters.items()
    }


def build_comments(comments: list[RawComment], cleaned_texts: list[str], predictions: list[dict]) -> dict:
    grouped: dict[str, list[dict]] = {"positive": [], "neutral": [], "negative": []}

    for comment, text, prediction in zip(comments, cleaned_texts, predictions):
        grouped[prediction["label"]].append(
            {
                "text": text,
                "author": comment.author,
                "like_count": comment.like_count,
                "score": round(prediction["score"], 3),
            }
        )

    for sentiment, items in grouped.items():
        items.sort(key=lambda c: (c["score"], c["like_count"]), reverse=True)
        grouped[sentiment] = items[:STANDOUT_COMMENTS_PER_SENTIMENT]

    return grouped
