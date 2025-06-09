import createWirehairModule from "./wirehair_core.mjs";

let WirehairModule = null;

/**
 * Initializes the Wirehair WebAssembly module.
 * This function must be called before any other Wirehair functions.
 * It loads and initializes the WebAssembly module. If the module is already
 * initialized, this function does nothing.
 * @async
 * @throws {Error} If Wirehair initialization fails.
 */
export async function initWirehairModule() {
    if (!WirehairModule) {
        WirehairModule = await createWirehairModule();
        const initResult = WirehairModule._wasm_wirehair_init_(2);
        if (initResult !== Wirehair_Success) {
            throw new Error(
                `Wirehair initialization failed with code ${initResult}.`
            );
        }
    }
}

/**
 * @class WirehairEncoder
 * Encapsulates the Wirehair encoding functionality.
 * Use this class to encode a message into a series of packets.
 */
export class WirehairEncoder {
    /**
     * Creates an instance of WirehairEncoder.
     * The constructor is private; use WirehairEncoder.create() instead.
     * @private
     */
    constructor() {
        this.module = WirehairModule;
        this.encoder = null;
    }

    /**
     * Asynchronously creates and initializes a WirehairEncoder instance.
     * Ensures the Wirehair WebAssembly module is initialized before creating the encoder.
     * @async
     * @returns {Promise<WirehairEncoder>} A promise that resolves to a new WirehairEncoder instance.
     */
    static async create() {
        await initWirehairModule();
        return new WirehairEncoder();
    }

    /**
     * Sets the message to be encoded and initializes the encoder.
     * @param {Uint8Array} messageU8 - The message data as a Uint8Array.
     * @param {number} [packetSizeWithHeaders=366] - The desired size of each encoded packet, including headers.
     *                                                This will be adjusted if it's too large for the message.
     *                                                The actual data payload size per packet will be this value minus 8 bytes for headers.
     * @throws {Error} If WASM buffer allocation fails.
     */
    setMessage(messageU8, packetSizeWithHeaders = 366) {
        this.messageU8 = messageU8;
        packetSizeWithHeaders = Math.min(
            messageU8.length + 8,
            packetSizeWithHeaders
        );
        this.packetSize = packetSizeWithHeaders - 8;
        this.blockId = 0;
        this.messagePtr = this.module._create_buffer(messageU8.length);
        if (!this.messagePtr) {
            throw new Error("Failed to allocate message buffer in WASM.");
        }
        this.messageBytes = messageU8.length;
        this.module.HEAPU8.set(messageU8, this.messagePtr);
        this.encoder = this.module._wasm_wirehair_encoder_create(
            this.encoder,
            this.messagePtr,
            this.messageBytes,
            this.packetSize
        );
        this.dataPtr = this.module._create_buffer(this.packetSize);
        this.writeLenPtr = this.module._create_buffer(4); // Allocate space for writeLen (uint32_t)
    }

    /**
     * Encodes the next block of the message.
     * @returns {Uint8Array} A packet containing the encoded block data and headers.
     *                       The first 4 bytes are messageBytes (total original message size),
     *                       the next 4 bytes are the blockId, followed by the encoded data.
     * @throws {Error} If Wirehair encoding fails.
     */
    encode() {
        const result = this.module._wasm_wirehair_encode(
            this.encoder,
            this.blockId,
            this.dataPtr,
            this.packetSize,
            this.writeLenPtr
        );
        if (result !== 0) {
            throw new Error(`Wirehair encode failed with code ${result}.`);
        }
        const writeLen = this.module.getValue(this.writeLenPtr, "i32");
        const packet = new Uint8Array(writeLen + 8);
        // Write header: messageBytes, blockId
        new Uint32Array(packet.buffer, 0, 2).set([
            this.messageBytes,
            this.blockId,
        ]);
        // Copy encoded data
        packet.set(
            new Uint8Array(this.module.HEAPU8.buffer, this.dataPtr, writeLen),
            8
        );
        this.blockId++;
        return packet;
    }

    /**
     * Frees the resources associated with this encoder instance in the WebAssembly module.
     * Call this method when the encoder is no longer needed to prevent memory leaks.
     */
    free() {
        if (this.module && this.encoder) {
            this.module._wasm_wirehair_free(this.encoder);
            this.encoder = null;
        }
    }
}

/**
 * @class WirehairDecoder
 * Encapsulates the Wirehair decoding functionality.
 * Use this class to decode a series of packets back into the original message.
 */
export class WirehairDecoder {
    /**
     * Creates an instance of WirehairDecoder.
     * The constructor is private; use WirehairDecoder.create() instead.
     * @private
     */
    constructor() {
        this.module = WirehairModule;
        this.decoder = null;
    }

    /**
     * Asynchronously creates and initializes a WirehairDecoder instance.
     * Ensures the Wirehair WebAssembly module is initialized before creating the decoder.
     * @async
     * @returns {Promise<WirehairDecoder>} A promise that resolves to a new WirehairDecoder instance.
     */
    static async create() {
        await initWirehairModule();
        return new WirehairDecoder();
    }

    /**
     * Initializes the decoder based on information from the first received packet.
     * This is a convenience method that calls `init` with parameters extracted from the packet.
     * @param {Uint8Array} packet - The first packet received for the message.
     *                              It's used to determine message size and packet size.
     */
    initFromPacket(packet) {
        const headerView = new DataView(packet.buffer, 0, 8);
        const messageBytes = headerView.getUint32(0, true);
        const packetSizeWithHeaders = packet.length;
        this.init(messageBytes, packetSizeWithHeaders);
    }

    /**
     * Initializes the decoder with the total message size and packet size.
     * This method must be called before decoding any packets if not using `initFromPacket`.
     * @param {number} messageBytes - The total size of the original message in bytes.
     * @param {number} packetSizeWithHeaders - The size of each packet, including headers (typically 8 bytes).
     *                                         The actual data payload size per packet will be this value minus 8 bytes.
     * @throws {Error} If WASM buffer allocation for packet data fails.
     */
    init(messageBytes, packetSizeWithHeaders) {
        this.messageBytes = messageBytes;
        this.packetSize = packetSizeWithHeaders - 8;
        this.decoder = this.module._wasm_wirehair_decoder_create(
            this.decoder,
            messageBytes,
            this.packetSize
        );
        this.dataPtr = this.module._create_buffer(this.packetSize);
        if (!this.dataPtr) {
            throw new Error(
                "Failed to allocate buffer for packet data in WASM."
            );
        }
        this.receivedBlocks = new Set();
    }

    /**
     * Decodes a received packet.
     * @param {Uint8Array} packet - The packet to decode. The packet should include the
     *                              8-byte header (messageBytes, blockId).
     * @returns {number|false} The result of the decode operation (e.g., Wirehair_Success, Wirehair_NeedMore).
     *                         Returns `false` if the blockId has already been received.
     * @throws {Error} If the packet's message size does not match the initialized message size.
     */
    decode(packet) {
        const headerView = new DataView(packet.buffer, 0, 8);
        const messageBytes = headerView.getUint32(0, true);
        const blockId = headerView.getUint32(4, true);
        if (messageBytes !== this.messageBytes) {
            throw new Error(
                "Packet message size does not match expected size."
            );
        }
        if (this.receivedBlocks.has(blockId)) {
            return false; // Already received this block
        }
        this.receivedBlocks.add(blockId);

        this.module.HEAPU8.set(new Uint8Array(packet.buffer, 8), this.dataPtr);

        const result = this.module._wasm_wirehair_decode(
            this.decoder,
            blockId,
            this.dataPtr,
            packet.length - 8
        );
        return result;
    }

    /**
     * Attempts to recover the original message from the decoded packets.
     * This should be called after enough packets have been successfully decoded
     * (i.e., when `decode` returns `Wirehair_Success`).
     * @returns {Uint8Array} The recovered original message.
     * @throws {Error} If WASM buffer allocation for the decoded message fails or if recovery fails.
     */
    recover() {
        const decodedMessagePtr = this.module._create_buffer(this.messageBytes);
        if (!decodedMessagePtr) {
            throw new Error("Failed to allocate buffer for decoded message.");
        }
        const result = this.module._wasm_wirehair_recover(
            this.decoder,
            decodedMessagePtr,
            this.messageBytes
        );
        if (result !== 0) {
            throw new Error(`Wirehair recover failed with code ${result}.`);
        }
        const decodedMessage = new Uint8Array(
            this.module.HEAPU8.buffer,
            decodedMessagePtr,
            this.messageBytes
        );
        return decodedMessage;
    }

    /**
     * Frees the resources associated with this decoder instance in the WebAssembly module.
     * Call this method when the decoder is no longer needed to prevent memory leaks.
     */
    free() {
        if (this.module && this.decoder) {
            this.module._wasm_wirehair_free(this.decoder);
            this.decoder = null;
        }
    }
}

/** Indicates successful operation. */
export const Wirehair_Success = 0;
/** Indicates that more packets are needed to reconstruct the message. */
export const Wirehair_NeedMore = 1;
