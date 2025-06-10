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
 * Encapsulates the Wirehair encoding functionality for raw packets (no headers).
 * Use this class to encode a message into a series of raw data packets.
 */
export class WirehairEncoderRaw {
    /**
     * Creates an instance of WirehairEncoderRaw.
     * Only usable after calling await initWirehairModule().
     *
     * Consider using WirehairEncoderRaw.create() instead.
     */
    constructor() {
        this.module = WirehairModule;
        this.encoder = null;
        this.messagePtr = null;
        this.dataPtr = null;
        this.writeLenPtr = null;
    }

    /**
     * Asynchronously creates and initializes a WirehairEncoderRaw instance.
     * Ensures the Wirehair WebAssembly module is initialized before creating the encoder.
     * @async
     * @returns {Promise<WirehairEncoderRaw>} A promise that resolves to a new WirehairEncoderRaw instance.
     */
    static async create() {
        await initWirehairModule();
        return new WirehairEncoderRaw();
    }

    /**
     * Sets the message to be encoded and initializes the encoder for raw output.
     * @param {Uint8Array} messageU8 - The message data as a Uint8Array.
     * @param {number} packetSize - The desired size of each encoded data payload.
     *                              This will be adjusted if it's too large for the message.
     * @throws {Error} If WASM buffer allocation fails.
     */
    setMessage(messageU8, packetSize) {
        this.messageU8 = messageU8;
        // Ensure packetSize does not exceed the message length.
        this.packetSize = Math.min(messageU8.length, packetSize);
        
        this.messagePtr = this.module._create_buffer(messageU8.length);
        if (!this.messagePtr) {
            throw new Error("Failed to allocate message buffer in WASM.");
        }
        this.messageBytes = messageU8.length;
        this.module.HEAPU8.set(messageU8, this.messagePtr);
        this.encoder = this.module._wasm_wirehair_encoder_create(
            this.encoder, // Pass null or existing encoder for re-use
            this.messagePtr,
            this.messageBytes,
            this.packetSize
        );
        this.dataPtr = this.module._create_buffer(this.packetSize);
        this.writeLenPtr = this.module._create_buffer(4); // Allocate space for writeLen (uint32_t)
    }

    /**
     * Encodes a block of the message with the given blockId.
     * @param {number} blockId - The ID of the block to encode.
     * @returns {Uint8Array} A raw packet containing the encoded block data.
     * @throws {Error} If Wirehair encoding fails.
     */
    encode(blockId) {
        const result = this.module._wasm_wirehair_encode(
            this.encoder,
            blockId,
            this.dataPtr,
            this.packetSize,
            this.writeLenPtr
        );
        if (result !== 0) {
            throw new Error(`Wirehair encode failed with code ${result}.`);
        }
        const writeLen = this.module.getValue(this.writeLenPtr, "i32");
        const rawPacketData = new Uint8Array(
            this.module.HEAPU8.buffer,
            this.dataPtr,
            writeLen
        );
        return rawPacketData;
    }

    /**
     * Frees the resources associated with this encoder instance in the WebAssembly module.
     * Call this method when the encoder is no longer needed to prevent memory leaks.
     */
    free() {
        if (this.module) {
            if (this.encoder !== null) {
                this.module._wasm_wirehair_free(this.encoder);
                this.encoder = null;
            }
            if (this.messagePtr !== null) {
                this.module._free_buffer(this.messagePtr);
                this.messagePtr = null;
            }
            if (this.dataPtr !== null) {
                this.module._free_buffer(this.dataPtr);
                this.dataPtr = null;
            }
            if (this.writeLenPtr !== null) {
                this.module._free_buffer(this.writeLenPtr);
                this.writeLenPtr = null;
            }
        }
    }
}

/**
 * Encapsulates the Wirehair decoding functionality for raw packets (no headers).
 * Use this class to decode a series of raw data packets back into the original message.
 */
export class WirehairDecoderRaw {
    /**
     * Creates an instance of WirehairDecoderRaw.
     * Only usable after calling await initWirehairModule().
     *
     * Consider using WirehairDecoderRaw.create() instead.
     */
    constructor() {
        this.module = WirehairModule;
        this.decoder = null;
        this.dataPtr = null;
        this.receivedBlocks = null;
    }

    /**
     * Asynchronously creates and initializes a WirehairDecoderRaw instance.
     * Ensures the Wirehair WebAssembly module is initialized before creating the decoder.
     * @async
     * @returns {Promise<WirehairDecoderRaw>} A promise that resolves to a new WirehairDecoderRaw instance.
     */
    static async create() {
        await initWirehairModule();
        return new WirehairDecoderRaw();
    }

    /**
     * Initializes the decoder with the total message size and raw packet (payload) size.
     * This method must be called before decoding any packets.
     * @param {number} messageBytes - The total size of the original message in bytes.
     * @param {number} packetSize - The size of each raw data payload.
     * @throws {Error} If WASM buffer allocation for packet data fails.
     */
    init(messageBytes, packetSize) {
        this.messageBytes = messageBytes;
        this.packetSize = packetSize; // This is the raw payload size
        this.decoder = this.module._wasm_wirehair_decoder_create(
            this.decoder, // Pass null or existing decoder for re-use (currently null)
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
     * Decodes a received raw packet.
     * @param {number} blockId - The ID of the block contained in packetDataU8.
     * @param {Uint8Array} packetDataU8 - The raw packet data to decode (payload only).
     * @returns {number|false} The result of the decode operation (e.g., Wirehair_Success, Wirehair_NeedMore).
     *                         Returns `false` if the blockId has already been received.
     * @throws {Error} If the decoder is not initialized or if packet data is too large.
     */
    decode(blockId, packetDataU8) {
        if (!this.decoder) {
            throw new Error("Decoder not initialized. Call init() first.");
        }
        if (packetDataU8.length > this.packetSize) {
            throw new Error(
                `Packet data length ${packetDataU8.length} exceeds initialized max packet size ${this.packetSize}.`
            );
        }

        if (this.receivedBlocks.has(blockId)) {
            return false; // Already received this block
        }
        this.receivedBlocks.add(blockId);

        this.module.HEAPU8.set(packetDataU8, this.dataPtr);

        const result = this.module._wasm_wirehair_decode(
            this.decoder,
            blockId,
            this.dataPtr,
            packetDataU8.length // Use the actual length of the provided data
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
        if (!this.decoder) {
            throw new Error("Decoder not initialized.");
        }
        this.decodedMessagePtr = this.module._create_buffer(this.messageBytes);
        if (!this.decodedMessagePtr) {
            throw new Error("Failed to allocate buffer for decoded message.");
        }
        const result = this.module._wasm_wirehair_recover(
            this.decoder,
            this.decodedMessagePtr,
            this.messageBytes
        );
        if (result !== 0) {
            // Free the potentially allocated buffer if recovery fails
            // Assuming _free_buffer is available and should be used.
            // if (this.module._free_buffer) this.module._free_buffer(decodedMessagePtr);
            throw new Error(`Wirehair recover failed with code ${result}.`);
        }
        const decodedMessage = new Uint8Array(
            this.module.HEAPU8.buffer,
            this.decodedMessagePtr,
            this.messageBytes
        );
        const copy = new Uint8Array(decodedMessage.length);
        copy.set(decodedMessage); // Copy the data to a new Uint8Array
        // Return the copied data to avoid issues with memory management.
        this.module._free_buffer(this.decodedMessagePtr); // Free the original buffer
        this.decodedMessagePtr = null; // Clear the pointer to avoid dangling reference
        return copy; // Return the copied data
    }

    /**
     * Frees the resources associated with this decoder instance in the WebAssembly module.
     * Call this method when the decoder is no longer needed to prevent memory leaks.
     */
    free() {
        if (this.module) {
            if (this.decoder !== null) {
                this.module._wasm_wirehair_free(this.decoder);
                this.decoder = null;
            }
            if (this.dataPtr !== null) {
                this.module._free_buffer(this.dataPtr);
                this.dataPtr = null;
            }
            if (this.decodedMessagePtr !== null) {
                this.module._free_buffer(this.decodedMessagePtr);
                this.decodedMessagePtr = null;
            }
        }
        this.receivedBlocks = null;
    }
}


/**
 * Encapsulates the Wirehair encoding functionality.
 * Use this class to encode a message into a series of packets with headers,
 * to be decoded by WirehairDecoder.
 */
export class WirehairEncoder extends WirehairEncoderRaw {
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
        this.blockId = 0;
        super.setMessage(messageU8, packetSizeWithHeaders - 8);
    }

    /**
     * Encodes the next block of the message.
     * @returns {Uint8Array} A packet containing the encoded block data and headers.
     *                       The first 4 bytes are messageBytes (total original message size),
     *                       the next 4 bytes are the blockId, followed by the encoded data.
     * @throws {Error} If Wirehair encoding fails.
     */
    encode() {
        const encoded = super.encode(this.blockId);
        const packet = new Uint8Array(encoded.length + 8);
        // Write header: messageBytes, blockId
        const header = new Uint32Array(packet.buffer, 0, 2);
        header[0] = this.messageBytes;
        header[1] = this.blockId;
        // Copy encoded data
        packet.set(encoded, 8);
        this.blockId++;
        return packet;
    }
}

/**
 * Encapsulates the Wirehair decoding functionality.
 * Use this class to decode a series of packets back into the original message.
 * This class operates on packets with headers that include the message size and block ID
 * as produced by WirehairEncoder.
 */
export class WirehairDecoder extends WirehairDecoderRaw {
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
        super.init(messageBytes, packetSizeWithHeaders - 8);
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
        if (!this.decoder) {
            this.initFromPacket(packet);
        }
        const headerView = new DataView(packet.buffer, 0, 8);
        const messageBytes = headerView.getUint32(0, true);
        const blockId = headerView.getUint32(4, true);
        if (messageBytes !== this.messageBytes) {
            throw new Error(
                "Packet message size does not match expected size."
            );
        }
        return super.decode(blockId, new Uint8Array(packet.buffer, 8));
    }
}

/** Indicates successful operation. */
export const Wirehair_Success = 0;
/** Indicates that more packets are needed to reconstruct the message. */
export const Wirehair_NeedMore = 1;
