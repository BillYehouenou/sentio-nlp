"""Analyse de sentiment via un modèle ONNX exporté depuis Hugging Face Transformers."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime
from transformers import PreTrainedTokenizerBase, PreTrainedTokenizerFast

LABELS = ["negative", "neutral", "positive"]
ONNX_FILENAME = "sentiment.onnx"

_tokenizer: PreTrainedTokenizerBase | None = None
_session: onnxruntime.InferenceSession | None = None
_input_names: set[str] = set()


def load_model(model_dir: Path) -> None:
    """Charger le modèle de sentiment ONNX et le tokenizer depuis le répertoire donné."""
    global _tokenizer, _session, _input_names

    onnx_path = model_dir / ONNX_FILENAME
    tokenizer_path = model_dir / "tokenizer.json"
    if not onnx_path.exists() or not tokenizer_path.exists():
        raise FileNotFoundError(
            f"Modèle introuvable dans {model_dir} (sentiment.onnx et/ou tokenizer.json manquant). "
            "Lance d'abord `setup_models.py --onnx` (voir README)."
        )

    _tokenizer = PreTrainedTokenizerFast(tokenizer_file=str(tokenizer_path), pad_token="<pad>")
    _session = onnxruntime.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    _input_names = {inp.name for inp in _session.get_inputs()}


def is_loaded() -> bool:
    return _session is not None and _tokenizer is not None


def runtime_version() -> str:
    return f"onnxruntime {onnxruntime.__version__}"


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


def predict_batch(texts: list[str], batch_size: int = 16) -> list[dict]:
    """Exécuter l'analyse de sentiment sur un lot de textes et renvoyer les résultats sous forme de dictionnaires.

    Chaque dictionnaire contient :
    - label: l'étiquette de sentiment prédite ["negative", "neutral" ou "positive"]
    - score: la probabilité associée à l'étiquette prédite
    - scores: un dictionnaire de toutes les étiquettes et leurs probabilités respectives
    """
    if not is_loaded():
        raise RuntimeError("Le modèle de sentiment n'est pas chargé.")

    results: list[dict] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        encoded = _tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors="np",
        )
        feed = {name: value for name, value in encoded.items() if name in _input_names}
        logits = _session.run(None, feed)[0]
        probs = _softmax(logits)

        for row in probs:
            idx = int(row.argmax())
            results.append(
                {
                    "label": LABELS[idx],
                    "score": float(row[idx]),
                    "scores": {label: float(row[j]) for j, label in enumerate(LABELS)},
                }
            )

    return results
