"""
PromptGuard-2 Inference Server

FastAPI service wrapping Meta's Llama-Prompt-Guard-2-86M model for
prompt injection and jailbreak classification.

Model weights are downloaded on first startup from HuggingFace
(requires HF_TOKEN) and cached in MODEL_CACHE_DIR for persistence
across restarts.

Endpoints:
  POST /classify       - Classify a single text
  POST /classify/batch - Classify multiple texts
  GET  /health         - Health check (includes readiness status)

Issue #1256
"""

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForSequenceClassification, AutoTokenizer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("prompt-guard")

MODEL_ID = os.environ.get("MODEL_ID", "meta-llama/Llama-Prompt-Guard-2-86M")
MODEL_CACHE_DIR = os.environ.get("MODEL_CACHE_DIR", "/app/model_cache")
HF_TOKEN = os.environ.get("HF_TOKEN")

# Label mapping for the model's output classes
LABEL_NAMES = ["BENIGN", "INJECTION", "JAILBREAK"]

# Global model state
model = None
tokenizer = None
model_ready = False
load_error: Optional[str] = None


def load_model():
    """Load model from cache or download from HuggingFace."""
    global model, tokenizer, model_ready, load_error

    try:
        logger.info("Loading model %s (cache: %s)", MODEL_ID, MODEL_CACHE_DIR)
        os.makedirs(MODEL_CACHE_DIR, exist_ok=True)

        # Check if model is already cached
        config_path = os.path.join(MODEL_CACHE_DIR, "config.json")
        if os.path.exists(config_path):
            logger.info("Model found in cache, loading from disk...")
            tokenizer = AutoTokenizer.from_pretrained(MODEL_CACHE_DIR)
            model = AutoModelForSequenceClassification.from_pretrained(MODEL_CACHE_DIR)
        else:
            if not HF_TOKEN:
                load_error = "HF_TOKEN not set and model not cached"
                logger.error(load_error)
                return

            logger.info("Model not cached, downloading from HuggingFace...")
            tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=HF_TOKEN)
            model = AutoModelForSequenceClassification.from_pretrained(
                MODEL_ID, token=HF_TOKEN
            )

            # Save to cache for subsequent starts
            logger.info("Saving model to cache...")
            tokenizer.save_pretrained(MODEL_CACHE_DIR)
            model.save_pretrained(MODEL_CACHE_DIR)
            logger.info("Model cached successfully")

        # Set to inference mode (no gradients needed)
        model.requires_grad_(False)
        model_ready = True
        logger.info("Model loaded and ready for inference")

    except Exception as e:
        load_error = str(e)
        logger.error("Failed to load model: %s", load_error)


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    """Load model on startup in a background thread."""
    thread = threading.Thread(target=load_model, daemon=True)
    thread.start()
    yield


app = FastAPI(
    title="PromptGuard-2 Classifier",
    description="Prompt injection and jailbreak detection service",
    lifespan=lifespan,
)


class ClassifyRequest(BaseModel):
    text: str = Field(..., description="Text to classify")


class ClassifyBatchRequest(BaseModel):
    texts: list[str] = Field(..., description="Texts to classify")


class ClassifyResponse(BaseModel):
    injection: bool
    jailbreak: bool
    label: str
    scores: dict[str, float]


def classify_single(text: str) -> ClassifyResponse:
    """Classify a single text string."""
    if not model_ready or model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not ready")

    inputs = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    )

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)[0]

    scores = {
        "benign": round(probs[0].item(), 4),
        "injection": round(probs[1].item(), 4),
        "jailbreak": round(probs[2].item(), 4),
    }

    top_idx = probs.argmax().item()
    label = LABEL_NAMES[top_idx]

    return ClassifyResponse(
        injection=label == "INJECTION",
        jailbreak=label == "JAILBREAK",
        label=label,
        scores=scores,
    )


@app.post("/classify", response_model=ClassifyResponse)
async def classify(request: ClassifyRequest):
    """Classify a single text for injection/jailbreak."""
    return classify_single(request.text)


@app.post("/classify/batch", response_model=list[ClassifyResponse])
async def classify_batch(request: ClassifyBatchRequest):
    """Classify multiple texts for injection/jailbreak."""
    if not request.texts:
        return []
    return [classify_single(text) for text in request.texts]


class HealthResponse(BaseModel):
    ok: bool
    model: str
    ready: bool
    error: Optional[str] = None


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint. Returns ready=false while model is loading."""
    return HealthResponse(
        ok=load_error is None,
        model=MODEL_ID,
        ready=model_ready,
        error=load_error,
    )
