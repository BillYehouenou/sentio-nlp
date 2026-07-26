"""
Exportation en une seule étape : modèle HuggingFace en ONNX (int8). 
"""

from __future__ import annotations

import argparse
from pathlib import Path

MODEL_ID = "cardiffnlp/twitter-xlm-roberta-base-sentiment"
DEFAULT_OUTPUT_DIR = Path(__file__).parent / "model"



def export_onnx(model_id: str, output_dir: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.onnxruntime import ORTModelForSequenceClassification
    from transformers import AutoTokenizer

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Télécharge et exporte '{model_id}' en ONNX...")
    model = ORTModelForSequenceClassification.from_pretrained(model_id, export=True)
    model.save_pretrained(output_dir)

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    tokenizer.save_pretrained(output_dir)

    exported_path = output_dir / "model.onnx"
    fp32_path = output_dir / "sentiment.fp32.onnx"
    target_path = output_dir / "sentiment.onnx"
    if exported_path.exists():
        exported_path.rename(fp32_path)

    quantize_dynamic(str(fp32_path), str(target_path), weight_type=QuantType.QInt8)
    fp32_path.unlink()

    for filename in ["config.json", "tokenizer_config.json", "special_tokens_map.json", "sentencepiece.bpe.model"]:
        (output_dir / filename).unlink(missing_ok=True)

    onnx_size_mb = target_path.stat().st_size / 1e6
    print(f"Modèle sauvegardé dans {output_dir} comme sentiment.onnx ({onnx_size_mb:.0f} Mo, int8) + tokenizer.json.")
    print(f"Labels (pour référence -- sentiment.py, LABELS encodées): {model.config.id2label}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export du modèle d'analyse de sentiment de Sentio.")
    parser.add_argument("--model-id", default=MODEL_ID, help="Id Modèle HuggingFace.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Dossier de sauvegarde du modèle.")
    args = parser.parse_args()

    export_onnx(args.model_id, Path(args.output_dir))
