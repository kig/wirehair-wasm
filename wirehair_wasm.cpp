/*
    WebAssembly API
    =================

    The following functions are exported to WebAssembly and can be called from JavaScript:
    - `wasm_wirehair_result_string(result: WirehairResult): string`
      Returns a string representation of the WirehairResult.
    - `wasm_wirehair_init_(expected_version: number): WirehairResult`
        Initializes the Wirehair library with the expected version.
    - `wasm_wirehair_encoder_create(reuseOpt: WirehairCodec, message: ArrayBuffer, messageBytes: number, blockBytes: number): WirehairCodec`
        Creates a Wirehair encoder with the given parameters.
    - `wasm_wirehair_encode(codec: WirehairCodec, blockId: number, blockDataOut: ArrayBuffer, outBytes: number, dataBytesOut: number): WirehairResult`
        Encodes a block of data using the specified codec.
    - `wasm_wirehair_decoder_create(reuseOpt: WirehairCodec, messageBytes: number, blockBytes: number): WirehairCodec`
        Creates a Wirehair decoder with the given parameters.
    - `wasm_wirehair_decode(codec: WirehairCodec, blockId: number, blockData: ArrayBuffer, dataBytes: number): WirehairResult`
        Decodes a block of data using the specified codec.
    - `wasm_wirehair_recover(codec: WirehairCodec, messageOut: ArrayBuffer, messageBytes: number): WirehairResult`
        Recovers the original message from the encoded data using the specified codec.
    - `wasm_wirehair_free(codec: WirehairCodec): void`
        Frees the memory allocated for the Wirehair codec.
    
    We also need utility functions to allocate memory for the message:
    - `create_buffer(size: number): ArrayBuffer`
        Allocates memory for the message of the specified size.
    - `free_buffer(message: ArrayBuffer): void`
        Frees the memory allocated for the message.

*/

#include <wirehair/wirehair.h>
#include <emscripten.h>
#include <cstdlib> // For malloc, free
#include <cstdint> // For uint8_t, uint32_t

extern "C" {

EMSCRIPTEN_KEEPALIVE
const char* wasm_wirehair_result_string(WirehairResult result) {
    return wirehair_result_string(result);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_init_(int expected_version) {
    return wirehair_init_(expected_version);
}

EMSCRIPTEN_KEEPALIVE
int create_buffer(int size) {
    return (int)malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void free_buffer(int buffer) {
    free((void *)buffer);
}

EMSCRIPTEN_KEEPALIVE
WirehairCodec wasm_wirehair_encoder_create(WirehairCodec encoder, uint8_t* message, int messageBytes, int blockBytes) {
    return wirehair_encoder_create(encoder, message, messageBytes, blockBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_encode(WirehairCodec encoder, int blockId, uint8_t* blockDataOut, int outBytes, uint32_t* dataBytesOut) {
    return (int)wirehair_encode(encoder, blockId, blockDataOut, (uint32_t)outBytes, dataBytesOut);
}

EMSCRIPTEN_KEEPALIVE
WirehairCodec wasm_wirehair_decoder_create(WirehairCodec decoder, int messageBytes, int blockBytes) {
    return wirehair_decoder_create(decoder, messageBytes, blockBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_decode(WirehairCodec decoder, int blockId, const uint8_t* blockData, int dataBytes) {
    return (int)wirehair_decode(decoder, blockId, blockData, (uint32_t)dataBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_recover(WirehairCodec decoder, uint8_t* messageOut, int messageBytes) {
    return (int)wirehair_recover(decoder, messageOut, (uint32_t)messageBytes);
}

EMSCRIPTEN_KEEPALIVE
void wasm_wirehair_free(WirehairCodec codec) {
    wirehair_free(codec);
}

} // extern "C"
