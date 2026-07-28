# Sentio

Analyse de sentiment des commentaires YouTube via modèle NLP multilingue pré-entrainé.
Aucune base de données : chaque analyse est calculée à la volée, à la demande.

## Stack

- **Backend** : Python, FastAPI
- **Modèle** : [`cardiffnlp/twitter-xlm-roberta-base-sentiment`](https://huggingface.co/cardiffnlp/twitter-xlm-roberta-base-sentiment)
  (HuggingFace), exporté en ONNX.
- **Commentaires** : `google-api-python-client` (YouTube Data API v3)
- **Frontend** : HTML/CSS/JS vanilla + Chart.js

## 1. Installation

Prérequis : Python 3.11+ et [`uv`](https://docs.astral.sh/uv/getting-started/installation/) installé.

```bash
cd backend
uv sync
```

## 2. Obtenir une clé API YouTube Data v3

1. Va sur la [Google Cloud Console](https://console.cloud.google.com/).
2. Crée un projet (ou utilise un projet existant).
3. Menu **API et services → Bibliothèque**, cherche **YouTube Data API v3**, clique **Activer**.
4. Menu **API et services → Identifiants → Créer des identifiants → Clé API**.
5. Copie la clé, puis :

```bash
cp backend/.env.example backend/.env
# édite backend/.env et colle ta clé :
# YOUTUBE_API_KEY=ta_clé_ici
```

## 3. Exporter le modèle en ONNX (une seule fois)

Cette étape télécharge le modèle HuggingFace (~1.1 Go), l'exporte au format ONNX puis le quantifie en int8. 
Elle ne tourne jamais automatiquement au démarrage du serveur — c'est un script séparé, à lancer une fois, hors ligne.

```bash
cd backend
uv sync --group export
uv run python setup_models.py
```

## 4. Lancer le serveur

```bash
cd backend
uv run uvicorn main:app --reload
```

Le serveur démarre sur *http://localhost:8000* et sert à la fois :
- l'API (`POST /api/analyze`, `GET /api/health`)
- le frontend statique (`/`, `/app.html`, `/results.html`, ...)

Ouvre *http://localhost:8000* dans un navigateur pour utiliser l'application.

### Tester l'API directement

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "max_comments": 100}'
```

## 5. Structure du repo

```
sentio/
├── backend/
│   ├── main.py                 # FastAPI app, routes, cycle de vie du modèle
│   ├── youtube.py              # récupération + nettoyage des commentaires
│   ├── sentiment.py            # tokenizer + session ONNX, inférence batch
│   ├── analysis.py             # agrégation : summary, timeline, top_words, commentaires
│   ├── schemas.py              # modèles Pydantic (requête/réponse)
│   ├── setup_models.py         # script one-shot : HF → ONNX (sentiment.onnx + tokenizer.json)
│   ├── tests/                  # pytest : URL parsing, agrégations, schémas
│   ├── conftest.py             # rend backend/ importable par pytest
│   ├── pyproject.toml          # dépendances (uv) : runtime + groupes dev/export
│   ├── uv.lock                 # versions résolues, pour des installs reproductibles
│   └── .env.example
├── frontend/
│   ├── index.html              # landing page
│   ├── app.html                # écran de saisie + pipeline animé
│   ├── results.html            # écran de résultats
│   ├── styles.css              # design system partagé
│   └── script.js
└── README.md
```
