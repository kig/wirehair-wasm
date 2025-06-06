#include <wirehair/wirehair.h>
#include <vector>
#include <cstring>
#include <iostream>

using namespace std;

WirehairCodec setup_encoder(int kMessageBytes, int kPacketSize, vector<uint8_t>& message) {
    // Create encoder
    WirehairCodec encoder = wirehair_encoder_create(nullptr, &message[0], kMessageBytes, kPacketSize);
    if (!encoder)
    {
        cout << "!!! Failed to create encoder" << endl;
    }
    return encoder;
}

// Create decoder
WirehairCodec setup_decoder(int kMessageBytes, int kPacketSize) {
    // Create decoder
    WirehairCodec decoder = wirehair_decoder_create(nullptr, kMessageBytes, kPacketSize);
    if (!decoder)
    {
        cout << "!!! Failed to create decoder" << endl;
    }
    return decoder;
}

bool send_packet(WirehairCodec encoder, unsigned blockId, vector<uint8_t>& block, uint32_t& writeLen)
{
    // Attempt to encode
    WirehairResult encodeResult = wirehair_encode(
        encoder, // Encoder object
        blockId, // ID of block to encode
        &block[0], // Output block
        (uint32_t)block.size(), // Block length
        &writeLen); // Number of bytes written

    if (encodeResult != Wirehair_Success)
    {
        cout << "wirehair_encode failed: " << encodeResult << endl;
        return false;
    }
    return true;
}

WirehairResult receive_packet(WirehairCodec decoder, unsigned blockId, const vector<uint8_t>& block, uint32_t writeLen)
{
    // Attempt to decode the received packet
    WirehairResult decodeResult = wirehair_decode(
        decoder, // Decoder object
        blockId, // ID of block that was encoded
        &block[0], // Input block
        writeLen); // Block length

    return decodeResult;
}

struct Block
{
    unsigned id; // Block ID
    vector<uint8_t> data; // Block data

    // Resize the block data to a specific size
    void resize(uint32_t size) {
        data.resize(size);
    }

    // Check if the block is empty
    bool empty() const {
        return data.empty();
    }
};

static bool ReadmeExample()
{
    // Size of packets to produce
    static const int kPacketSize = 2850;

    // Note: Does not need to be an even multiple of packet size or 16 etc
    static const int kMessageBytes = 2500 * 1000;

    vector<uint8_t> message(kMessageBytes);

    // Fill message contents
    for (int i = 0; i < kMessageBytes; ++i)
    {
        message[i] = (uint8_t)(i % 256);
    }

    WirehairCodec encoder = setup_encoder(kMessageBytes, kPacketSize, message);
    if (!encoder)
    {
        return false;
    }

    // Create decoder
    WirehairCodec decoder = setup_decoder(kMessageBytes, kPacketSize);
    if (!decoder)
    {
        // Free memory for encoder
        wirehair_free(encoder);
        return false;
    }

    unsigned blockId = 0, needed = 0;

    vector<Block> blocks(8);

    for (;;)
    {
        // Select which block to encode.
        // Note: First N blocks are the original data, so it's possible to start
        // sending data while wirehair_encoder_create() is getting started.

        // Receive 8 blocks concurrently in random order
        // cout << "Generating " << blocks.size() << " blocks" << endl;
        for (auto& block : blocks)
        {
            uint32_t writeLen = 0;
            blockId++;
            block.id = blockId;
            block.resize(kPacketSize);
            if (send_packet(encoder, block.id, block.data, writeLen) == false)
            {
                // Free memory for encoder and decoder
                wirehair_free(encoder);
                wirehair_free(decoder);
                return false;
            }
            block.resize(writeLen); // Resize to actual written length
            // cout << "Sent packet of " << writeLen << " bytes with ID " << block.id << endl;
        }

        // Simulate 75% bursty packetloss with 20% random loss
        if (((blockId / 100) % 4) != 0 || rand() % 5 == 0){
            continue;
        }

        // Shuffle the blocks to simulate random order
        random_shuffle(blocks.begin(), blocks.end());

        // Process the blocks
        // cout << "Processing " << blocks.size() << " blocks" << endl;
        bool done = false;
        for (const auto& block : blocks)
        {
            // Keep track of how many pieces were needed
            ++needed;

            // cout << "Received packet with ID " << block.id << " of size " << block.data.size() << endl;
            // cout << "Attempt decoding" << endl;
            // Attempt to decode the received packet
            WirehairResult decodeResult = receive_packet(decoder, block.id, block.data, (uint32_t)block.data.size());

            // If decoder returns success:
            if (decodeResult == Wirehair_Success) {
                // Decoder has enough data to recover now
                done = true;
                break;
            }

            if (decodeResult != Wirehair_NeedMore)
            {
                cout << "wirehair_decode failed: " << decodeResult << endl;
                return false;
            }
        }
        if (done) {
            break;
        }
    }

    cout << "Blocks received, recovering data..." << endl;

    vector<uint8_t> decoded(kMessageBytes);

    // Recover original data on decoder side
    WirehairResult decodeResult = wirehair_recover(
        decoder,
        &decoded[0],
        kMessageBytes);

    if (decodeResult != Wirehair_Success)
    {
        cout << "wirehair_recover failed: " << decodeResult << endl;
        return false;
    }
    // Check if the recovered data matches the original message
    if (memcmp(&decoded[0], &message[0], kMessageBytes) != 0)
    {
        cout << "!!! Recovered data does not match original message" << endl;
        return false;
    } else {
        cout << "Recovered data matches original message" << endl;
    }
    cout << "Recovered from " << needed << " blocks out of " << (blockId - 1) << " sent" << endl;
    cout << "Message was split into " << ceil((double)kMessageBytes / kPacketSize) << " blocks of size " << kPacketSize << endl;

    // Free memory for encoder and decoder
    wirehair_free(encoder);
    wirehair_free(decoder);

    return true;
}

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
    - `wasm_wirehair_encoder_free(codec: WirehairCodec): void`
        Frees the memory allocated for the Wirehair encoder.
    - `wasm_wirehair_decoder_free(codec: WirehairCodec): void`
        Frees the memory allocated for the Wirehair decoder.
    
    We also need utility functions to allocate memory for the message:
    - `create_buffer(size: number): ArrayBuffer`
        Allocates memory for the message of the specified size.
    - `free_buffer(message: ArrayBuffer): void`
        Frees the memory allocated for the message.

*/
// Here's an implementation of the WebAssembly API functions in C++:
// Required includes for WebAssembly bindings and Wirehair
#include <wirehair/wirehair.h> // Ensure this is available
#include <emscripten.h>
#include <cstdlib> // For malloc, free
#include <cstdint> // For uint8_t, uint32_t
// Note: <string> for std::string is not directly needed for these C-style exports

extern "C" {

EMSCRIPTEN_KEEPALIVE
int test()
{
    const WirehairResult initResult = wirehair_init();

    if (initResult != Wirehair_Success)
    {

        cout << "!!! Wirehair initialization failed: " << initResult << endl;
        return -1;
    }

    if (!ReadmeExample())
    {

        cout << "!!! Example usage failed" << endl;
        return -2;
    }
    cout << "Wirehair example usage succeeded" << endl;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* wasm_wirehair_result_string(WirehairResult result) {
    return wirehair_result_string(result);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_init_(int expected_version) {
    // Assumes wirehair_init(int expected_version) exists.
    // The typical wirehair_init() might take WIREHAIR_VERSION.
    // If your wirehair.h has `wirehair_init()`, you might call that and
    // optionally check expected_version against a compiled-in WIREHAIR_VERSION.
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

static WirehairCodec encoder;
static WirehairCodec decoder;

EMSCRIPTEN_KEEPALIVE
void wasm_wirehair_encoder_create(uint8_t* message, int messageBytes, int blockBytes) {
    encoder = wirehair_encoder_create(encoder, message, messageBytes, blockBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_encode(int blockId, uint8_t* blockDataOut, int outBytes, uint32_t* dataBytesOut) {
    return (int)wirehair_encode(encoder, blockId, blockDataOut, (uint32_t)outBytes, dataBytesOut);
}

EMSCRIPTEN_KEEPALIVE
void wasm_wirehair_decoder_create(int messageBytes, int blockBytes) {
    decoder = wirehair_decoder_create(decoder, messageBytes, blockBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_decode(int blockId, const uint8_t* blockData, int dataBytes) {
    return (int)wirehair_decode(decoder, blockId, blockData, (uint32_t)dataBytes);
}

EMSCRIPTEN_KEEPALIVE
int wasm_wirehair_recover(uint8_t* messageOut, int messageBytes) {
    return (int)wirehair_recover(decoder, messageOut, (uint32_t)messageBytes);
}

EMSCRIPTEN_KEEPALIVE
void wasm_wirehair_encoder_free() {
    wirehair_free(encoder);
}

EMSCRIPTEN_KEEPALIVE
void wasm_wirehair_decoder_free() {
    wirehair_free(decoder);
}

} // extern "C"

// Compile with
// emcc test.cpp -o test.js -s EXPORTED_FUNCTIONS='["_wasm_wirehair_result_string", "_wasm_wirehair_init_", "_create_buffer", "_free_buffer", "_wasm_wirehair_encoder_create", "_wasm_wirehair_encode", "_wasm_wirehair_decoder_create", "_wasm_wirehair_decode", "_wasm_wirehair_recover", "_wasm_wirehair_encoder_free", "_wasm_wirehair_decoder_free"]' -s MODULARIZE=1 -s EXPORT_NAME='createWirehairModule' -s ALLOW_MEMORY_GROWTH=1 -I include --std=c++11 gf256.cpp wirehair.cpp WirehairCodec.cpp WirehairTools.cpp