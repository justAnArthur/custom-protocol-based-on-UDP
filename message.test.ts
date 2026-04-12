/**
 * SNSS Protocol - Test Suite (Bun test runner)
 * Run with:  bun test
 */

import { describe, test, expect } from "bun:test";
import {
    Type,
    createMessage,
    openMessage,
    packMessage,
    unpackMessage,
    computeChecksum,
    corruptMessage,
    getTypeName,
} from "./message";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bigIntToBuffer(value: bigint): Buffer {
    if (value === 0n) return Buffer.alloc(0);
    const hex = value.toString(16);
    return Buffer.from(hex.length % 2 === 0 ? hex : "0" + hex, "hex");
}

function bufferToBigInt(buf: Buffer): bigint {
    if (buf.length === 0) return 0n;
    return BigInt("0x" + buf.toString("hex"));
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

describe("Type constants", () => {
    test("all six types have correct 3-bit values", () => {
        expect(Type.REQ).toBe(0b011);
        expect(Type.REQ_M).toBe(0b010);
        expect(Type.APR).toBe(0b100);
        expect(Type.NACK).toBe(0b101);
        expect(Type.DATA).toBe(0b000);
        expect(Type.KEEP_A).toBe(0b110);
    });

    test("getTypeName round-trips every type", () => {
        for (const [name, value] of Object.entries(Type)) {
            expect(getTypeName(value)).toBe(name);
        }
    });

    test("getTypeName throws for unknown value", () => {
        expect(() => getTypeName(0b111)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

describe("computeChecksum", () => {
    test("basic sum within bit-width returns that sum", () => {
        // 3 + 1 + 100 = 104, fits in 8 bits
        expect(computeChecksum(8, Type.REQ, 1, 100)).toBe(104);
    });

    test("folding reduces large sum to ≤ bitsLength bits", () => {
        const cs = computeChecksum(21, Type.REQ, 1, 100);
        expect(cs).toBeGreaterThan(0);
        expect(cs).toBeLessThan(1 << 21);
    });

    test("same inputs always produce the same checksum", () => {
        const a = computeChecksum(21, Type.DATA, 0, 12345678);
        const b = computeChecksum(21, Type.DATA, 0, 12345678);
        expect(a).toBe(b);
    });
});

// ---------------------------------------------------------------------------
// KEEP_A message
// ---------------------------------------------------------------------------

describe("KEEP_A message", () => {
    test("can be created and parsed", () => {
        const msg = createMessage(Type.KEEP_A);
        const fields = openMessage(msg);
        expect(fields[0]).toBe(Type.KEEP_A);
        expect(fields).toHaveLength(1);
    });

    test("round-trips through pack/unpack", () => {
        const msg = createMessage(Type.KEEP_A);
        expect(msg.length).toBeGreaterThan(0);
        // Re-parse
        const fields = openMessage(msg);
        expect(fields[0]).toBe(Type.KEEP_A);
    });
});

// ---------------------------------------------------------------------------
// APR message
// ---------------------------------------------------------------------------

describe("APR message", () => {
    test("embeds seq_number correctly", () => {
        const seq = 1024;
        const msg = createMessage(Type.APR, seq);
        const fields = openMessage(msg);
        expect(fields[0]).toBe(Type.APR);
        expect(fields[1]).toBe(seq);
    });

    test("handles seq_number = 0", () => {
        const msg = createMessage(Type.APR, 0);
        const fields = openMessage(msg);
        expect(fields[1]).toBe(0);
    });

    test("handles large seq_number (32-bit max)", () => {
        const seq = 0xffff_ffff;
        const msg = createMessage(Type.APR, seq);
        const fields = openMessage(msg);
        expect(fields[1]).toBe(seq);
    });
});

// ---------------------------------------------------------------------------
// NACK message
// ---------------------------------------------------------------------------

describe("NACK message", () => {
    test("embeds seq_number correctly", () => {
        const seq = 512;
        const msg = createMessage(Type.NACK, seq);
        const fields = openMessage(msg);
        expect(fields[0]).toBe(Type.NACK);
        expect(fields[1]).toBe(seq);
    });
});

// ---------------------------------------------------------------------------
// DATA message
// ---------------------------------------------------------------------------

describe("DATA message", () => {
    test("embeds seq and payload, recovers payload bytes", () => {
        const seq = 0;
        const payload = Buffer.from("Hello, SNSS!", "utf-8");
        const payloadInt = bufferToBigInt(payload);

        const msg = createMessage(Type.DATA, seq, payloadInt);
        const fields = openMessage(msg);

        expect(fields[0]).toBe(Type.DATA);
        expect(fields[1]).toBe(seq);

        const recovered = bigIntToBuffer(fields[2] as bigint);
        expect(recovered.toString("utf-8")).toBe("Hello, SNSS!");
    });
});

// ---------------------------------------------------------------------------
// REQ_M message
// ---------------------------------------------------------------------------

describe("REQ_M message", () => {
    test("encodes window_size and payload_size", () => {
        const win = 5;
        const pld = 1024;
        const msg = createMessage(Type.REQ_M, win, pld);
        const fields = openMessage(msg);

        expect(fields[0]).toBe(Type.REQ_M);
        expect(fields[1]).toBe(win);
        expect(fields[2]).toBe(pld);
    });

    test("max window (255) and max payload (2047) round-trip", () => {
        const msg = createMessage(Type.REQ_M, 255, 2047);
        const fields = openMessage(msg);
        expect(fields[1]).toBe(255);
        expect(fields[2]).toBe(2047);
    });
});

// ---------------------------------------------------------------------------
// REQ message
// ---------------------------------------------------------------------------

describe("REQ message", () => {
    test("encodes filename as variable-length field", () => {
        const fileName = "test.txt";
        const fileNameBuf = Buffer.from(fileName, "utf-8");
        const fileNameInt = bufferToBigInt(fileNameBuf);

        const msg = createMessage(Type.REQ, 5, 1024, fileNameInt);
        const fields = openMessage(msg);

        expect(fields[0]).toBe(Type.REQ);
        expect(fields[1]).toBe(5);
        expect(fields[2]).toBe(1024);

        const recovered = bigIntToBuffer(fields[3] as bigint).toString("utf-8");
        expect(recovered).toBe(fileName);
    });
});

// ---------------------------------------------------------------------------
// Checksum validation / corruption
// ---------------------------------------------------------------------------

describe("checksum validation", () => {
    test("valid message passes openMessage", () => {
        const msg = createMessage(Type.APR, 100);
        expect(() => openMessage(msg)).not.toThrow();
    });

    test("corrupted byte causes Invalid checksum error", () => {
        const msg = createMessage(Type.APR, 100);
        const bad = Buffer.from(msg);
        bad[1] = 0xff; // Damage checksum byte
        expect(() => openMessage(bad)).toThrow("Invalid checksum");
    });

    test("corruptMessage helper produces an invalid message", () => {
        const msg = createMessage(Type.APR, 200);
        const bad = corruptMessage(msg);
        expect(() => openMessage(bad)).toThrow("Invalid checksum");
    });
});

// ---------------------------------------------------------------------------
// Multi-chunk message reconstruction
// ---------------------------------------------------------------------------

describe("multi-chunk message reconstruction", () => {
    test("splits and reassembles a text message", () => {
        const fullMessage = "This is a longer test message that will be split into chunks";
        const chunkSize = 10;
        const chunks: Array<{ seqNum: number; msg: Buffer }> = [];

        for (let i = 0; i < fullMessage.length; i += chunkSize) {
            const chunk = Buffer.from(fullMessage.substring(i, i + chunkSize), "utf-8");
            chunks.push({
                seqNum: i,
                msg: createMessage(Type.DATA, i, bufferToBigInt(chunk)),
            });
        }

        const received: Record<number, Buffer> = {};
        for (const { msg } of chunks) {
            const fields = openMessage(msg);
            received[fields[1] as number] = bigIntToBuffer(fields[2] as bigint);
        }

        const sortedKeys = Object.keys(received)
            .map(Number)
            .sort((a, b) => a - b);
        const reconstructed = sortedKeys.map((k) => received[k]!.toString("utf-8")).join("");

        expect(reconstructed).toBe(fullMessage);
    });
});

// ---------------------------------------------------------------------------
// pack / unpack symmetry
// ---------------------------------------------------------------------------

describe("pack / unpack symmetry", () => {
    test("APR round-trips through pack then unpack", () => {
        // packMessage includes the checksum field, so pass it explicitly
        const checksum = computeChecksum(21, Type.APR, 42);
        const packed = packMessage(Type.APR, checksum, 42);
        const unpacked = unpackMessage(packed);

        // unpackMessage returns [type, checksum, seq]
        expect(unpacked[0]).toBe(Type.APR);
        expect(unpacked[1]).toBe(checksum);
        expect(unpacked[2]).toBe(42);
    });
});
