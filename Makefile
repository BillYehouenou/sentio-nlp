.PHONY: help install install-export export test run dev clean clean-model

help:
	@echo "Sentio — targets disponibles :"
	@echo "  make install         Installe les dépendances runtime + dev via uv"
	@echo "  make install-export  Installe en plus les dépendances d'export"
	@echo "  make export          Exporte le modèle HuggingFace en ONNX (une seule fois)"
	@echo "  make test            Lance la suite de tests"
	@echo "  make dev             Lance le serveur avec rechargement automatique"
	@echo "  make run             Lance le serveur"
	@echo "  make clean           Supprime le venv et les fichiers Python compilés"
	@echo "  make clean-model     Supprime le modèle ONNX exporté"

install:
	cd backend && uv sync

install-export:
	cd backend && uv sync --group export

export: install-export
	cd backend && uv run python setup_models.py

test: install
	cd backend && uv run pytest tests

dev: install
	cd backend && uv run uvicorn main:app --reload

run: install
	cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000

clean:
	rm -rf backend/.venv
	find . -type d -name "__pycache__" -exec rm -rf {} +

clean-model:
	rm -rf backend/model
