/**
 * Message Module - SNSS Protocol
 * Handles message packing, unpacking, and checksum validation
 */

/** Message types - 3 bits each */
export const Type = {
    REQ: 0b011,      // File request
    REQ_M: 0b010,    // Message request
    APR: 0b100,      // Acknowledgment
    NACK: 0b101,     // Negative acknowledgment
    DATA: 0b000,     // Data chunk
    KEEP_A: 0b110    // Keep-alive
} as const;

export type TypeName = keyof typeof Type;
export type MessageType = (typeof Type)[TypeName];

/** Mixed field value - fixed-width fields are numbers, variable-length data fields are BigInt */
export type FieldValue = number | bigint;

type MaskField = number | '_';

/**
 * Field masks for each message type.
 * Numbers specify bit-width of that field; '_' marks the remaining variable-length field.
 */
const Mask: Record<TypeName, MaskField[]> = {
    // type(3b), checksum(18b), window(8b), payload(11b), filename(...)
    REQ: [0b111, 0x3FFFF, 0xFF, 0x7FF, '_'],
    // type(3b), checksum(18b), window(8b), payload(11b)
    REQ_M: [0b111, 0x3FFFF, 0xFF, 0x7FF],
    // type(3b), checksum(21b), seq_number(32b)
    APR: [0b111, 0x1FFFFF, 0xFFFFFFFF],
    // type(3b), checksum(21b), seq_number(32b)
    NACK: [0b111, 0x1FFFFF, 0xFFFFFFFF],
    // type(3b), checksum(21b), seq_number(32b), data(...)
    DATA: [0b111, 0x1FFFFF, 0xFFFFFFFF, '_'],
    // type(3b), checksum(21b)
    KEEP_A: [0b111, 0x1FFFFF],
};

/** Reverse-lookup: numeric type value → type name */
export function getTypeName(typeValue: number): TypeName {
    for (const [name, value] of Object.entries(Type) as [TypeName, number][]) {
        if (value === typeValue) return name;
    }
    throw new Error(`Unknown type value: ${typeValue}`);
}

/** Returns the number of bits needed to represent num */
function bitLength(num: number): number {
    if (num === 0) return 1;
    return Math.floor(Math.log2(num)) + 1;
}

/** Zero-pads num's binary representation to length bits */
function toBinaryString(num: number, length: number): string {
    return num.toString(2).padStart(length, '0');
}

/**
 * Unpack raw message bytes into an array of field values.
 * Variable-length trailing fields are returned as BigInt.
 */
export function unpackMessage(messageBytes: Buffer): FieldValue[] {
    const typeValue = messageBytes[0] >> 5;
    const typeName = getTypeName(typeValue);
    const messageMask = Mask[typeName];

    let messageBits = '';
    for (let i = 0; i < messageBytes.length; i++) {
        messageBits += toBinaryString(messageBytes[i]!, 8);
    }

    const fields: FieldValue[] = [];

    for (let index = 0; index < messageMask.length; index++) {
        const maskField = messageMask[index]!;

        if (maskField === '_') {
            fields.push(messageBits.length > 0 ? BigInt('0b' + messageBits) : 0n);
            break;
        }

        const maskBitLength = bitLength(maskField);
        fields.push(parseInt(messageBits.substring(0, maskBitLength), 2));
        messageBits = messageBits.substring(maskBitLength);
    }

    return fields;
}

/**
 * Pack field values (type + checksum + protocol fields) into a binary Buffer.
 * The first argument is the message type; all others are ordered per the mask.
 */
export function packMessage(type: MessageType, ...fields: FieldValue[]): Buffer {
    const typeName = getTypeName(type);
    const messageMask = Mask[typeName];

    const allFields: FieldValue[] = [type, ...fields];
    let messageBits = '';

    for (let index = 0; index < messageMask.length; index++) {
        const maskField = messageMask[index]!;

        if (maskField === '_') {
            const fieldValue = allFields[index]!;
            const fieldBigInt = typeof fieldValue === 'bigint' ? fieldValue : BigInt(fieldValue);

            if (fieldBigInt === 0n) break;

            const fieldBitLength = Math.ceil(fieldBigInt.toString(2).length / 8) * 8;
            messageBits += fieldBigInt.toString(2).padStart(fieldBitLength, '0');
            break;
        }

        // Use >>> 0 to convert signed 32-bit result of & back to unsigned
        const fieldValue = (Number(allFields[index]!) & maskField) >>> 0;
        messageBits += toBinaryString(fieldValue, bitLength(maskField));
    }

    const bytes: number[] = [];
    for (let i = 0; i < messageBits.length; i += 8) {
        bytes.push(parseInt(messageBits.substring(i, i + 8), 2));
    }

    return Buffer.from(bytes);
}

/**
 * Compute the custom Internet Checksum.
 * Folds the sum of all data values into at most bitsLength bits.
 */
export function computeChecksum(bitsLength: number, ...data: FieldValue[]): number {
    let checksum = 0n;

    for (const value of data) {
        checksum += typeof value === 'bigint' ? value : BigInt(value);
    }

    while (bitLength(Number(checksum)) > bitsLength) {
        const halfLength = Math.floor(bitLength(Number(checksum)) / 2);
        const mask = (1n << BigInt(halfLength)) - 1n;
        checksum = (checksum & mask) + (checksum >> BigInt(halfLength));
    }

    return Number(checksum);
}

/**
 * Create a protocol message: computes and prepends the checksum, then packs the bytes.
 */
export function createMessage(type: MessageType, ...fields: FieldValue[]): Buffer {
    const checksum = computeChecksum(21, type, ...fields);
    return packMessage(type, checksum, ...fields);
}

/**
 * Parse and validate a received message.
 * Throws if the embedded checksum does not match the computed one.
 * Returns fields in order: [type, ...protocol-specific fields] (checksum stripped).
 */
export function openMessage(message: Buffer): FieldValue[] {
    const fields = unpackMessage(message);
    const checksum = fields[1] as number;

    const fieldsWithoutChecksum: FieldValue[] = [fields[0]!, ...fields.slice(2)];
    const calculatedChecksum = computeChecksum(21, ...fieldsWithoutChecksum);

    if (checksum !== calculatedChecksum) {
        throw new Error('Invalid checksum');
    }

    return fieldsWithoutChecksum;
}

/**
 * Corrupt a message byte for testing error-detection (matches Python implementation).
 */
export function corruptMessage(message: Buffer): Buffer {
    const corrupted = Buffer.from(message);
    if (corrupted.length > 1) {
        corrupted[1] = 'a'.charCodeAt(0);
    }
    return corrupted;
}
