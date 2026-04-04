#!/bin/bash
# ProofFrame — Generate Groth16 proof on RunPod (x86 + GPU)
#
# Usage:
#   1. Spin up RunPod instance: RTX 4090 or A100, Ubuntu 22.04, >=32GB RAM
#   2. SSH into the instance
#   3. Run: curl -sSL <this-script-url> | bash
#      Or: copy this script and run it
#
# After completion, download output/receipt.json back to your Mac.

set -euo pipefail

echo "=========================================="
echo "ProofFrame Groth16 Proof Generator (RunPod)"
echo "=========================================="

# 1. Install system deps
echo ""
echo "[1/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq build-essential pkg-config libssl-dev git curl docker.io >/dev/null 2>&1
echo "  Done."

# 2. Install Rust
echo ""
echo "[2/6] Installing Rust..."
if ! command -v rustup &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "  Rust already installed."
fi
rustc --version

# 3. Install RISC Zero toolchain
echo ""
echo "[3/6] Installing RISC Zero toolchain..."
if ! command -v rzup &> /dev/null; then
    curl -L https://risczero.com/install | bash
    source "$HOME/.bashrc" 2>/dev/null || true
    export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"
fi
rzup install
echo "  RISC Zero toolchain installed."

# 4. Clone repo
echo ""
echo "[4/6] Cloning ProofFrame repository..."
REPO_DIR="$HOME/proof-frame"
if [ -d "$REPO_DIR" ]; then
    echo "  Repo already exists, pulling latest..."
    cd "$REPO_DIR"
    git pull
else
    git clone https://github.com/pycckuu/proof-frame.git "$REPO_DIR"
    cd "$REPO_DIR"
fi

# 5. Check GPU / Docker
echo ""
echo "[5/6] Checking GPU and Docker..."
if command -v nvidia-smi &> /dev/null; then
    echo "  GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
else
    echo "  WARNING: No GPU detected. Proving will use CPU (slow, ~15 min)."
fi

# Start Docker if not running (needed for Groth16)
if ! docker info &> /dev/null 2>&1; then
    echo "  Starting Docker..."
    service docker start 2>/dev/null || true
    sleep 2
fi

# 6. Generate Groth16 proof
echo ""
echo "[6/6] Generating Groth16 proof (this takes 1-5 minutes with GPU)..."
echo "  Image: test_images/ethglobal_cannes.png"
echo "  Key: test_images/ethglobal_cannes.signing_key.json"
echo "  Disclosure: date + city location + camera make"
echo ""

# Build first (compiles guest ELF)
cargo build -p proofframe-host --release 2>&1 | tail -5

# Run WITHOUT RISC0_DEV_MODE → real Groth16 proof
mkdir -p output
time cargo run -p proofframe-host --release -- \
    --image test_images/ethglobal_cannes.png \
    --key test_images/ethglobal_cannes.signing_key.json \
    --disclosure '{"reveal_date":true,"reveal_location":true,"reveal_camera_make":true,"location_precision":"City"}' \
    --output output

echo ""
echo "=========================================="
echo "DONE! Groth16 proof generated."
echo "=========================================="
echo ""
echo "Output files:"
ls -la output/
echo ""
echo "Receipt JSON:"
cat output/receipt.json | head -20
echo ""
echo "Next steps:"
echo "  1. Download output/receipt.json to your Mac:"
echo "     scp runpod:~/proof-frame/output/receipt.json ."
echo "  2. Deploy contract with REAL verifier router (not mock):"
echo "     cd contracts && IMAGE_ID=0x... forge script script/Deploy.s.sol --rpc-url sepolia --broadcast"
echo "  3. Submit receipt on-chain via the frontend relay API"
