import os
from typing import List
from pydantic import BaseModel
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = os.path.dirname(__file__)
# Navigate up 3 levels: hs_service -> services -> AI -> models
MODELS_DIR = os.path.join(BASE_DIR, '..', '..', 'models')
MODELS_DIR = os.path.normpath(MODELS_DIR)

app = FastAPI(
    title='HS Code Suggestion Service',
    version='1.0.0',
    description='AI-powered HS Code suggestion service for customs compliance'
)

# CORS Configuration for AWS Deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SuggestRequest(BaseModel):
    name: str = ''
    category: str = ''
    description: str = ''
    k: int = 5

class SuggestItem(BaseModel):
    hscode: str
    description: str
    score: float

class SuggestResponse(BaseModel):
    suggestions: List[SuggestItem]

model = None
index = None
meta = None
faiss = None
np = None
pd = None
load_error = None

@app.on_event('startup')
def load_resources():
    """Load the embedding model and FAISS index if available. Never block startup."""
    global model, index, meta, faiss, np, pd, load_error

    # Paths
    fs_index = os.path.join(MODELS_DIR, 'hs_index.faiss')
    meta_csv = os.path.join(MODELS_DIR, 'hs_meta.csv')
    emb_npy = os.path.join(MODELS_DIR, 'embeddings.npy')

    try:
        # Import heavy deps lazily so that missing packages don't block startup
        import numpy as _np
        import pandas as _pd
        import faiss as _faiss
        from sentence_transformers import SentenceTransformer

        np = _np
        pd = _pd
        faiss = _faiss

        if not os.path.exists(fs_index) or not os.path.exists(meta_csv) or not os.path.exists(emb_npy):
            print('WARNING: Model files missing in', MODELS_DIR)
            print('  Expected:', fs_index, meta_csv, emb_npy)
            print('  Please run: python backend/AI/scripts/prepare_hs_data.py && python backend/AI/scripts/build_hs_embeddings.py')
            return

        model = SentenceTransformer('all-MiniLM-L6-v2')
        index = faiss.read_index(fs_index)
        meta = pd.read_csv(meta_csv)
        print('Loaded HS model and index. Rows:', len(meta))
    except Exception as ex:
        load_error = ex
        model = None
        index = None
        meta = None
        print('ERROR: Failed to load HS model/index:', ex)

@app.post('/suggest-hs', response_model=SuggestResponse)
def suggest_hs(req: SuggestRequest):
    try:
        if index is None or model is None or meta is None or faiss is None or np is None:
            if load_error:
                print('HS suggest called but model unavailable:', load_error)
            return {'suggestions': []}

        q = f"{req.name or ''} {req.category or ''} {req.description or ''}".strip().lower()
        emb = model.encode([q], convert_to_numpy=True)
        faiss.normalize_L2(emb)
        D, I = index.search(emb, req.k)
        suggestions = []
        for score, idx in zip(D[0], I[0]):
            if idx < 0:
                continue
            row = meta.iloc[int(idx)]
            suggestions.append({'hscode': str(row.get('hscode', '')), 'description': str(row.get('description', '')), 'score': float(score)})
        return {'suggestions': suggestions}
    except Exception as ex:
        print('HS suggest failed:', ex)
        return {'suggestions': []}

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.get('/model-info')
def model_info():
    if meta is None:
        return {'loaded': False}
    return {'loaded': True, 'rows': len(meta)}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8001)
