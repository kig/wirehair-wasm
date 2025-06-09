export const Wirehair_Success: number;
export const Wirehair_NeedMore: number;

export class WirehairEncoder {
    static create(): Promise<WirehairEncoder>;
    setMessage(message: Uint8Array, packetByteCount: number): void;
    encode(blockId: number): Uint8Array;
    free(): void;
}

export class WirehairDecoder {
    static create(): Promise<WirehairDecoder>;
    init(messageByteCount: number, packetByteCount: number): void;
    decode(packet: Uint8Array): number; // Returns WirehairResult
    recover(): Uint8Array;
    free(): void;
}
