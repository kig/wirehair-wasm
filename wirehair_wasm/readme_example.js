import { WirehairEncoder, WirehairDecoder, Wirehair_NeedMore, Wirehair_Success } from "./wirehair_util.mjs";

export async function runJsReadmeExample(Module) {
    // Constants from the C++ example
    const kPacketSize = 36600;
    const kMessageBytes = 250000 * 1000; // 250 MB

    // Wirehair version, ensure this matches the version Wirehair was compiled with.
    // This value is typically found in wirehair.h (e.g., WIREHAIR_VERSION_NUMBER)
    const WIREHAIR_EXPECTED_VERSION = 2; // Example value, adjust if necessary

    // WirehairResult enum values (subset, for clarity)
    // Add other error codes as needed for more detailed error messages

    // Helper to get string from WASM memory
    const getStringFromPtr = (ptr) => Module.UTF8ToString(ptr);

    // Helper function to log Wirehair results
    function logWirehairResult(operation, resultCode) {
        if (
            resultCode !== Wirehair_Success &&
            resultCode !== Wirehair_NeedMore
        ) {
            console.error(
                `!!! ${operation} failed: ${getStringFromPtr(
                    Module._wasm_wirehair_result_string(resultCode)
                )} (${resultCode})`
            );
        }
    }

    // 1. Initialize Wirehair
    console.log("Initializing Wirehair...");
    const initResult = Module._wasm_wirehair_init_(WIREHAIR_EXPECTED_VERSION);
    if (initResult !== Wirehair_Success) {
        logWirehairResult("Wirehair initialization", initResult);
        return false;
    }
    console.log("Wirehair initialized successfully.");

    // 2. Prepare message buffer in WASM memory
    const messagePtr = Module._create_buffer(kMessageBytes);
    if (!messagePtr) {
        console.error("!!! Failed to allocate message buffer in WASM.");
        return false;
    }
    // Create a Uint8Array view over the WASM memory for easy manipulation
    const messageView = new Uint8Array(
        Module.HEAPU8.buffer,
        messagePtr,
        kMessageBytes
    );
    for (let i = 0; i < kMessageBytes; ++i) {
        messageView[i] = i % 256; // Fill message contents
    }

    // 3. Create encoder
    console.log("Creating encoder...");
    Module._wasm_wirehair_encoder_create(
        messagePtr,
        kMessageBytes,
        kPacketSize
    );
    console.log("Encoder created.");

    // 4. Create decoder
    console.log("Creating decoder...");
    Module._wasm_wirehair_decoder_create(kMessageBytes, kPacketSize);
    console.log("Decoder created.");

    let blockIdCounter = 0;
    let packetsNeeded = 0;
    const numConcurrentBlocks = 8; // How many blocks to generate/send in a batch

    // Allocate memory for `writeLen` (a uint32_t output by wasm_wirehair_encode)
    const writeLenPtr = Module._create_buffer(4); // sizeof(uint32_t)
    if (!writeLenPtr) {
        console.error("!!! Failed to allocate memory for writeLen.");
        Module._wasm_wirehair_encoder_free(encoder);
        Module._wasm_wirehair_decoder_free(decoder);
        Module._free_buffer(messagePtr);
        return false;
    }

    // Main loop: encode, simulate loss, decode
    console.log("Starting encoding/decoding loop...");
    for (;;) {
        let currentBatchBlocks = []; // To store { id: number, dataPtr: number, length: number }

        // Generate a batch of blocks
        for (let i = 0; i < numConcurrentBlocks; ++i) {
            blockIdCounter++;
            const blockDataPtr = Module._create_buffer(kPacketSize);
            if (!blockDataPtr) {
                console.error(
                    `!!! Failed to allocate buffer for block ID ${blockIdCounter}.`
                );
                // Perform cleanup for already allocated resources in this batch and globally
                currentBatchBlocks.forEach((b) =>
                    Module._free_buffer(b.dataPtr)
                );
                Module._free_buffer(writeLenPtr);
                Module._wasm_wirehair_encoder_free();
                Module._wasm_wirehair_decoder_free();
                Module._free_buffer(messagePtr);
                return false;
            }

            const encodeResult = Module._wasm_wirehair_encode(
                blockIdCounter,
                blockDataPtr,
                kPacketSize,
                writeLenPtr
            );
            const actualWriteLen = Module.getValue(writeLenPtr, "i32");

            if (encodeResult !== Wirehair_Success) {
                logWirehairResult(
                    `wirehair_encode for block ID ${blockIdCounter}`,
                    encodeResult
                );
                Module._free_buffer(blockDataPtr); // Free current block's data
                currentBatchBlocks.forEach((b) =>
                    Module._free_buffer(b.dataPtr)
                ); // Free previous blocks in batch
                Module._free_buffer(writeLenPtr);
                Module._wasm_wirehair_encoder_free();
                Module._wasm_wirehair_decoder_free();
                Module._free_buffer(messagePtr);
                return false;
            }
            currentBatchBlocks.push({
                id: blockIdCounter,
                dataPtr: blockDataPtr,
                length: actualWriteLen,
            });
        }

        // Simulate 75% bursty packet loss with 20% random loss
        const isBurstLoss = Math.floor(blockIdCounter / 100) % 4 !== 0;
        const isRandomLoss = Math.random() < 0.2; // rand() % 5 == 0

        if (isBurstLoss || isRandomLoss) {
            // console.log(`Losing batch ending with block ID ${blockIdCounter}`);
            currentBatchBlocks.forEach((block) =>
                Module._free_buffer(block.dataPtr)
            ); // Free lost blocks
            continue; // Skip processing this batch
        }

        // Shuffle the blocks to simulate random order of arrival (Fisher-Yates shuffle)
        for (let i = currentBatchBlocks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [currentBatchBlocks[i], currentBatchBlocks[j]] = [
                currentBatchBlocks[j],
                currentBatchBlocks[i],
            ];
        }

        // Process the received (non-lost) batch of blocks
        let recoveryDone = false;
        for (const block of currentBatchBlocks) {
            packetsNeeded++;
            // console.log(`Decoding block ID ${block.id}, size ${block.length}`);
            const decodeResult = Module._wasm_wirehair_decode(
                block.id,
                block.dataPtr,
                block.length
            );
            Module._free_buffer(block.dataPtr); // Free block data after attempting decode

            if (decodeResult === Wirehair_Success) {
                console.log("Recovery successful after decoding block!");
                recoveryDone = true;
                break; // Decoder has enough data
            }

            if (decodeResult !== Wirehair_NeedMore) {
                logWirehairResult(
                    `wirehair_decode for block ID ${block.id}`,
                    decodeResult
                );
                // Critical error during decode
                Module._free_buffer(writeLenPtr);
                Module._wasm_wirehair_encoder_free();
                Module._wasm_wirehair_decoder_free();
                Module._free_buffer(messagePtr);
                return false;
            }
        }

        if (recoveryDone) {
            break; // Exit main loop
        }
    } // End main loop

    console.log(
        "All necessary blocks received, attempting to recover original message..."
    );
    const decodedMessagePtr = Module._create_buffer(kMessageBytes);
    if (!decodedMessagePtr) {
        console.error("!!! Failed to allocate buffer for decoded message.");
        // Perform cleanup
        Module._free_buffer(writeLenPtr);
        Module._wasm_wirehair_encoder_free();
        Module._wasm_wirehair_decoder_free();
        Module._free_buffer(messagePtr);
        return false;
    }

    const recoverResult = Module._wasm_wirehair_recover(
        decodedMessagePtr,
        kMessageBytes
    );
    if (recoverResult !== Wirehair_Success) {
        logWirehairResult("wirehair_recover", recoverResult);
        Module._free_buffer(decodedMessagePtr);
        Module._free_buffer(writeLenPtr);
        Module._wasm_wirehair_encoder_free();
        Module._wasm_wirehair_decoder_free();
        Module._free_buffer(messagePtr);
        return false;
    }
    console.log("Message recovery successful.");

    // Verify recovered data
    const decodedMessageView = new Uint8Array(
        Module.HEAPU8.buffer,
        decodedMessagePtr,
        kMessageBytes
    );
    let match = true;
    for (let i = 0; i < kMessageBytes; ++i) {
        if (decodedMessageView[i] !== i % 256) {
            match = false;
            break;
        }
    }

    if (match) {
        console.log("SUCCESS: Recovered data matches original message.");
    } else {
        console.error(
            "!!! FAILURE: Recovered data does not match original message."
        );
    }

    console.log(
        `Recovered from ${packetsNeeded} blocks out of ${blockIdCounter} generated.`
    );
    console.log(
        `Original message was ${kMessageBytes} bytes, packet/block size ${kPacketSize}.`
    );
    console.log(
        `Minimum blocks needed: ${Math.ceil(kMessageBytes / kPacketSize)}.`
    );

    // Cleanup
    Module._free_buffer(messagePtr);
    Module._free_buffer(decodedMessagePtr);
    Module._free_buffer(writeLenPtr);
    Module._wasm_wirehair_encoder_free();
    Module._wasm_wirehair_decoder_free();

    console.log("JavaScript ReadmeExample finished.");

    // Use WirehairEncoder and WirehairDecoder classes
    const encoder = new WirehairEncoder();
    const decoder = new WirehairDecoder();
    const message = new Uint8Array(kMessageBytes);
    for (let i = 0; i < kMessageBytes; ++i) {
        message[i] = i % 256; // Fill message contents
    }
    await encoder.setMessage(message, kPacketSize);
    await decoder.init(kMessageBytes, kPacketSize);

    let totalPackets = Math.ceil(kMessageBytes / kPacketSize);
    let receivedPackets = 0;
    let sentPackets = 0;

    {
        for (let i = 0; i < Math.ceil(kMessageBytes / kPacketSize); i++) {
            const packet = encoder.encode();
        }
        const startTime = performance.now();
        let packetSize = encoder.packetSize;
        for (let i = 0; i < 1e4; i++) {
            const packet = encoder.encode();
        }
        const endTime = performance.now();
        const bytesPerSecond = (
            packetSize*1e4 / ((endTime - startTime) / 1000)
        );
        console.log(
            `Encoded 10,000 packets in ${(endTime - startTime).toFixed(2)} ms (${(bytesPerSecond/1e6).toFixed(2)} MB/s).`
        );
    }

    const startTime = performance.now();

    for (;;) {
        const packet = encoder.encode();
        sentPackets++;
        if (!packet) {
            break; // No more packets to encode
        }
        if (Math.random() > 0.5) {
            continue;
        }
        receivedPackets++;

        const decodeResult = decoder.decode(packet);
        if (decodeResult === Wirehair_Success) {
            break;
        }
        if (decodeResult !== Wirehair_NeedMore) {
            console.error(`Wirehair decode failed with code ${decodeResult}.`);
            throw new Error(
                `Wirehair decode failed with code ${decodeResult}.`
            );
        }
    }
    const recoveredMessage = decoder.recover();

    const endTime = performance.now();
    const bytesPerSecond = (
        kMessageBytes / ((endTime - startTime) / 1000)
    );
    console.log(
        `Encoded and decoded the message in ${(endTime - startTime).toFixed(2)} ms (${(bytesPerSecond/1e6).toFixed(2)} MB/s).`
    );

    let cmatch = true;
    for (let i = 0; i < kMessageBytes; ++i) {
        if (recoveredMessage[i] !== i % 256) {
            cmatch = false;
            break;
        }
    }
    console.log(
        `Sent ${sentPackets} packets, received ${receivedPackets} to recover the message (minimum number of packets is ${totalPackets})`
    );
    if (cmatch) {
        console.log(
            "SUCCESS: WirehairEncoder/WirehairDecoder: Recovered data matches original message."
        );
    } else {
        console.error(
            "!!! FAILURE: WirehairEncoder/WirehairDecoder: Recovered data does not match original message."
        );
    }

    encoder.free();
    decoder.free();

    return match && cmatch; // Return true if both methods succeeded
}
