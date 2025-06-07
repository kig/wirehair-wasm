import createWirehairModule from "./wirehair.mjs";

// For sending messages using Wirehair in JavaScript.
// This is designed for use with QR codes, so the default packetSize is 366 bytes.
// (Max QR code size 2953 bytes minus a 16 byte header, divided by 8, minus 1 byte for block headers.)
// Each packet has an 8 byte header with the blockId and messageLength.
// The idea is that you can encode a message and send it over four different sizes of QR codes,
// or include a metadata block in a QR code with a couple data blocks without much overhead.
export class WirehairEncoder {
    constructor() {
        this.module = WirehairEncoder.module;
    }

    static async create() {
        if (!WirehairEncoder.module) {
            WirehairEncoder.module = await createWirehairModule();
            const initResult = WirehairEncoder.module._wasm_wirehair_init_(2);
            if (initResult !== Wirehair_Success) {
                throw new Error(
                    `Wirehair initialization failed with code ${initResult}.`
                );
            }
        }
        return new WirehairEncoder();
    }

    setMessage(messageU8, packetSizeWithHeaders = 366) {
        this.messageU8 = messageU8;
        packetSizeWithHeaders = Math.min(
            messageU8.length + 8,
            packetSizeWithHeaders
        );
        this.packetSize = packetSizeWithHeaders - 8;
        this.blockId = 0;
        const initResult = this.module._wasm_wirehair_init_(2);
        if (initResult !== Wirehair_Success) {
            throw new Error(
                `Wirehair initialization failed with code ${initResult}.`
            );
        }
        this.messagePtr = this.module._create_buffer(messageU8.length);
        if (!this.messagePtr) {
            throw new Error("Failed to allocate message buffer in WASM.");
        }
        this.messageBytes = messageU8.length;
        this.module.HEAPU8.set(messageU8, this.messagePtr);
        this.module._wasm_wirehair_encoder_create(
            this.messagePtr,
            this.messageBytes,
            this.packetSize
        );
        this.dataPtr = this.module._create_buffer(this.packetSize);
        this.writeLenPtr = this.module._create_buffer(4); // Allocate space for writeLen (uint32_t)
    }

    encode() {
        const result = this.module._wasm_wirehair_encode(
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

    free() {
        if (this.module) {
            this.module._wasm_wirehair_encoder_free();
        }
    }
}

export class WirehairDecoder {
    constructor() {
        this.module = WirehairDecoder.module;
    }

    static async create() {
        if (!WirehairDecoder.module) {
            WirehairDecoder.module = await createWirehairModule();
            const initResult = WirehairDecoder.module._wasm_wirehair_init_(2);
            if (initResult !== Wirehair_Success) {
                throw new Error(
                    `Wirehair initialization failed with code ${initResult}.`
                );
            }
        }
        return new WirehairDecoder();
    }

    initFromPacket(packet) {
        const headerView = new DataView(packet.buffer, 0, 8);
        const messageBytes = headerView.getUint32(0, true);
        const packetSizeWithHeaders = packet.length;
        this.init(messageBytes, packetSizeWithHeaders);
    }

    init(messageBytes, packetSizeWithHeaders) {
        this.messageBytes = messageBytes;
        this.packetSize = packetSizeWithHeaders - 8;
        this.module._wasm_wirehair_decoder_create(
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
            blockId,
            this.dataPtr,
            packet.length - 8
        );
        return result;
    }

    recover() {
        const decodedMessagePtr = this.module._create_buffer(this.messageBytes);
        if (!decodedMessagePtr) {
            throw new Error("Failed to allocate buffer for decoded message.");
        }
        const result = this.module._wasm_wirehair_recover(
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
}

export const Wirehair_Success = 0;
export const Wirehair_NeedMore = 1;
