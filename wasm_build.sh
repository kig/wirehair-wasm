#!/bin/bash

TAG=:4.0.10

# If we're on arm64, add the -arm64 tag
if [[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]]; then
    TAG="$TAG-arm64"
fi

docker run --rm -v $(pwd):/src -u $(id -u):$(id -g) emscripten/emsdk$TAG emcc \
    wirehair_wasm.cpp -o wirehair_wasm/wirehair_core.mjs \
    -s ENVIRONMENT=web -s MALLOC=emmalloc -s FILESYSTEM=0 \
    -s SINGLE_FILE=1 \
    -s MODULARIZE=1 -s EXPORT_ES6=1 -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_FUNCTIONS='["_wasm_wirehair_result_string", "_wasm_wirehair_init_", "_create_buffer", "_free_buffer", "_wasm_wirehair_encoder_create", "_wasm_wirehair_encode", "_wasm_wirehair_decoder_create", "_wasm_wirehair_decode", "_wasm_wirehair_recover", "_wasm_wirehair_free", "_test"]' \
    -s EXPORT_NAME='createWirehairModule' \
    -s EXPORTED_RUNTIME_METHODS='[HEAPU8,getValue,UTF8ToString]' \
    --std=c++11 \
    -O3 -msimd128 -mavx -DGF256_TARGET_MOBILE=1 \
    -I ./node_modules/libwirehair/include \
    ./node_modules/libwirehair/gf256.cpp \
    ./node_modules/libwirehair/wirehair.cpp \
    ./node_modules/libwirehair/WirehairCodec.cpp \
    ./node_modules/libwirehair/WirehairTools.cpp
