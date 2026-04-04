#!/bin/bash
# Shim that replaces -arch=native with -arch=sm_89 (RTX 4090)
# Needed because CI runners have no GPU, so nvcc cannot detect architecture.
args=()
for arg in "$@"; do
  if [[ "$arg" == "-arch=native" ]]; then
    args+=("-arch=sm_89")
  else
    args+=("$arg")
  fi
done
exec /usr/local/cuda/bin/nvcc.real "${args[@]}"
