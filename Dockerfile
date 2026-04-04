# ProofFrame — RunPod Serverless Prover
# Multi-stage build: compile Rust host binary, package with Python RunPod handler
#
# Build:  docker build -t ghcr.io/pycckuu/proofframe-prover:latest .
# Test:   docker run --rm -e RISC0_DEV_MODE=1 ghcr.io/pycckuu/proofframe-prover:latest
# Push:   docker push ghcr.io/pycckuu/proofframe-prover:latest

# ===========================================================================
# Stage 1: Build the Rust host binary + compile guest ELF
# ===========================================================================
FROM rust:1.85-bookworm AS builder

# Install system deps for RISC Zero + OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev cmake git curl \
    && rm -rf /var/lib/apt/lists/*

# Install RISC Zero toolchain
RUN curl -L https://risczero.com/install | bash \
    && export PATH="$HOME/.risc0/bin:$PATH" \
    && rzup install

ENV PATH="/root/.risc0/bin:/root/.cargo/bin:${PATH}"

WORKDIR /build

# Copy workspace files
COPY Cargo.toml Cargo.lock* ./
COPY common/ common/
COPY methods/ methods/
COPY host/ host/

# Build host binary in release mode (compiles guest ELF via build.rs)
RUN cargo build -p proofframe-host --release

# ===========================================================================
# Stage 2: Runtime with Python RunPod handler
# ===========================================================================
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip libssl3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir runpod

WORKDIR /app

# Copy compiled binary
COPY --from=builder /build/target/release/proofframe-host /app/proofframe-host

# Copy test images (for default test runs)
COPY test_images/ /app/test_images/

# Copy RunPod handler
COPY handler.py /app/handler.py

# RunPod serverless entry point
CMD ["python3", "-u", "/app/handler.py"]
