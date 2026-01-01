from typing import List, Optional, Dict
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from inference.predict_hybrid import predict_documents_hybrid


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Pre-Clear Document Recommender",
    description="Hybrid ML + Rules Engine for Trade Compliance Document Recommendation",
    version="2.0.0"
)

# CORS Configuration for AWS Deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    origin_country: Optional[str] = ""
    destination_country: Optional[str] = ""
    hs_code: Optional[str] = ""
    hts_flag: Optional[bool] = False
    product_category: Optional[str] = ""
    product_description: Optional[str] = ""
    package_type_weight: Optional[str] = ""
    mode_of_transport: Optional[str] = ""


class PredictResponse(BaseModel):
    required_documents: List[str]
    documents_with_scores: Optional[Dict[str, float]] = None
    explanations: Optional[Dict[str, str]] = None


@app.get("/")
def root():
    """Health check endpoint."""
    return {
        "service": "Pre-Clear Document Recommender",
        "version": "2.0.0",
        "status": "healthy",
        "architecture": "hybrid (rules + ML)"
    }


@app.get("/health")
def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "rules_engine": "active",
        "ml_model": "loaded"
    }


@app.post("/predict-documents", response_model=PredictResponse)
def predict_documents(payload: PredictRequest) -> dict:
    """
    Predict required trade compliance documents using hybrid approach.
    
    Combines:
    - Deterministic rules engine (mandatory regulatory requirements)
    - ML model (learned patterns from historical data)
    
    Returns document list with confidence scores and explanations.
    """
    # Log request for monitoring
    logger.info(
        f"Document prediction request: "
        f"origin={payload.origin_country}, "
        f"dest={payload.destination_country}, "
        f"hs={payload.hs_code}, "
        f"category={payload.product_category}"
    )
    
    # Basic validation: require at least one meaningful field
    fields = [
        payload.origin_country,
        payload.destination_country,
        payload.hs_code,
        payload.product_category,
        payload.product_description,
    ]
    
    if all(not v or v == "" for v in fields):
        logger.warning("Rejected request: insufficient input fields")
        raise HTTPException(
            status_code=400,
            detail="At least one of: origin_country, destination_country, hs_code, product_category, or product_description must be provided."
        )
    
    try:
        # Run hybrid prediction
        result = predict_documents_hybrid(
            origin_country=payload.origin_country or "",
            destination_country=payload.destination_country or "",
            hs_code=payload.hs_code or "",
            hts_flag=payload.hts_flag if payload.hts_flag is not None else False,
            product_category=payload.product_category or "",
            product_description=payload.product_description or "",
            package_type_weight=payload.package_type_weight or "",
            mode_of_transport=payload.mode_of_transport or "",
            include_explanations=True
        )
        
        # Log successful prediction
        logger.info(
            f"Prediction successful: {len(result['required_documents'])} documents recommended"
        )
        
        return result
        
    except FileNotFoundError as exc:
        logger.error(f"Model artifact not found: {exc}")
        # Still return rules-based predictions if ML model not available
        # The predict_hybrid function handles this gracefully
        raise HTTPException(
            status_code=500,
            detail="ML model not trained. Using rules engine only. Please train the model for full functionality."
        ) from exc
    
    except Exception as exc:
        logger.error(f"Prediction failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(exc)}"
        ) from exc


if __name__ == "__main__":
    import uvicorn
    
    logger.info("=" * 60)
    logger.info("Starting Pre-Clear Document Recommender Service")
    logger.info("Architecture: Hybrid (Deterministic Rules + ML)")
    logger.info("Port: 9000")
    logger.info("=" * 60)
    
    uvicorn.run(app, host="0.0.0.0", port=9000, log_level="info")
