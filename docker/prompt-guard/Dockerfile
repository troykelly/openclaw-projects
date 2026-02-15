# PromptGuard-2 Inference Server
#
# Provides prompt injection and jailbreak classification using
# Meta's Llama-Prompt-Guard-2-86M model via a FastAPI REST API.
#
# Model weights are NOT baked into the image — they are downloaded
# at runtime on first startup using HF_TOKEN and cached in a
# persistent Docker volume.
#
# Issue #1256

FROM python:3.12-slim

# OCI labels
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION
ARG OCI_CREATED
ARG OCI_REVISION
ARG OCI_VERSION
LABEL org.opencontainers.image.created="${OCI_CREATED}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.title="openclaw-projects-prompt-guard" \
      org.opencontainers.image.description="PromptGuard-2 inference server for prompt injection detection" \
      org.opencontainers.image.vendor="Troy Kelly" \
      org.opencontainers.image.licenses="MIT AND Llama-4-Community"

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
# CPU-only PyTorch to keep the image small (~700MB vs ~2GB for CUDA)
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir \
    transformers \
    fastapi \
    uvicorn

COPY server.py NOTICE LICENSE ./

ENV MODEL_CACHE_DIR=/app/model_cache
ENV MODEL_ID=meta-llama/Llama-Prompt-Guard-2-86M

VOLUME /app/model_cache

EXPOSE 8190

# Run as non-root
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8190"]
