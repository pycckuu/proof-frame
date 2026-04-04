# ProofFrame — RunPod Serverless Prover (GPU / Groth16)
# Multi-stage build: compile Rust host binary with CUDA, package with Python RunPod handler
#
# Build:  docker build -t ghcr.io/pycckuu/proofframe-prover:latest .
# Test:   docker run --rm --gpus all ghcr.io/pycckuu/proofframe-prover:latest
# Push:   docker push ghcr.io/pycckuu/proofframe-prover:latest

# ===========================================================================
# Stage 1: Build the Rust host binary with CUDA support
# ===========================================================================
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04 AS builder

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Install system deps for RISC Zero + OpenSSL + Rust
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev cmake git curl protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install RISC Zero toolchain
RUN curl -L https://risczero.com/install | bash \
    && export PATH="$HOME/.risc0/bin:$PATH" \
    && rzup install

ENV PATH="/root/.risc0/bin:/root/.cargo/bin:${PATH}"

# CUDA paths for compilation
ENV CUDA_HOME=/usr/local/cuda
ENV PATH="${CUDA_HOME}/bin:${PATH}"
ENV LD_LIBRARY_PATH="${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}"

# CI runner has no GPU, so nvcc -arch=native fails.
# Wrap real nvcc with a shim that replaces -arch=native with -arch=sm_89 (RTX 4090).
RUN mv /usr/local/cuda/bin/nvcc /usr/local/cuda/bin/nvcc.real
COPY nvcc-shim.sh /usr/local/cuda/bin/nvcc
RUN chmod +x /usr/local/cuda/bin/nvcc

WORKDIR /build

# Copy workspace files
COPY Cargo.toml Cargo.lock* ./
COPY common/ common/
COPY methods/ methods/
COPY host/ host/

# Build host binary with CUDA feature for GPU-accelerated Groth16 proving
RUN cargo build -p proofframe-host --release --features cuda

# ===========================================================================
# Stage 2: Runtime with CUDA + Python RunPod handler
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
