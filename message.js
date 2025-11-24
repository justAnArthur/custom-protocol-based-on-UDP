/**
 * Message Module - SNSS Protocol
 * Handles message packing, unpacking, and checksum validation
 */

/**
 * Message Types - 3 bits
 */
const Type = {
    REQ: 0b011,      // File request
    REQ_M: 0b010,    // Message request
    APR: 0b100,      // Acknowledgment
    NACK: 0b101,     // Negative acknowledgment
    DATA: 0b000,     // Data chunk
    KEEP_A: 0b110    // Keep-alive
};

/**
 * Field masks for each message type
 * '_' indicates variable-length field (rest of message)
 */
const Mask = {
    // checksum, hash, window, filename
    REQ: [0b111, 0x3FFFF, 0xFF, 0x7FF, '_'],
    // checksum, window, payload
    REQ_M: [0b111, 0x3FFFF, 0xFF, 0x7FF],
    // checksum, seq_number
    APR: [0b111, 0x1FFFFF, 0xFFFFFFFF],
    // checksum, seq_number
    NACK: [0b111, 0x1FFFFF, 0xFFFFFFFF],
    // checksum, seq_number, data
    DATA: [0b111, 0x1FFFFF, 0xFFFFFFFF, '_'],
    // checksum
    KEEP_A: [0b111, 0x1FFFFF]
};

/**
 * Get type name from value
 */
function getTypeName(typeValue) {
    for (const [name, value] of Object.entries(Type)) {
        if (value === typeValue) return name;
    }
    throw new Error(`Unknown type value: ${typeValue}`);
}

/**
 * Get bit length of a number
 */
function bitLength(num) {
    if (num === 0) return 1;
    return Math.floor(Math.log2(num)) + 1;
}

/**
 * Convert number to binary string with zero padding
 */
function toBinaryString(num, length) {
    return num.toString(2).padStart(length, '0');
}

/**
 * Unpack message from bytes
 */
function unpackMessage(messageBytes) {
    // Extract type from first 3 bits
    const typeValue = messageBytes[0] >> 5;
    const typeName = getTypeName(typeValue);
    const messageMask = Mask[typeName];
    
    // Convert bytes to binary string
    let messageBits = '';
    for (let i = 0; i < messageBytes.length; i++) {
        messageBits += toBinaryString(messageBytes[i], 8);
    }
    
    const fields = [];
    
    for (let index = 0; index < messageMask.length; index++) {
        const maskField = messageMask[index];
        
        if (maskField === '_') {
            // Variable length field - rest of message
            if (messageBits.length > 0) {
                fields.push(BigInt('0b' + messageBits));
            } else {
                fields.push(BigInt(0));
            }
            break;
        }
        
        const maskBitLength = bitLength(maskField);
        const fieldBits = messageBits.substring(0, maskBitLength);
        fields.push(parseInt(fieldBits, 2));
        messageBits = messageBits.substring(maskBitLength);
    }
    
    return fields;
}

/**
 * Pack message fields into bytes
 */
function packMessage(type, ...fields) {
    const typeName = getTypeName(type);
    const messageMask = Mask[typeName];
    
    const allFields = [type, ...fields];
    let messageBits = '';
    
    for (let index = 0; index < messageMask.length; index++) {
        const maskField = messageMask[index];
        
        if (maskField === '_') {
            // Variable length field
            const fieldValue = allFields[index];
            const fieldBigInt = typeof fieldValue === 'bigint' ? fieldValue : BigInt(fieldValue);
            
            if (fieldBigInt === BigInt(0)) {
                break;
            }
            
            const fieldBitLength = Math.ceil((fieldBigInt.toString(2).length) / 8) * 8;
            messageBits += fieldBigInt.toString(2).padStart(fieldBitLength, '0');
            break;
        }
        
        const fieldValue = allFields[index] & maskField;
        messageBits += toBinaryString(fieldValue, bitLength(maskField));
    }
    
    // Convert binary string to bytes
    const bytes = [];
    for (let i = 0; i < messageBits.length; i += 8) {
        const byte = messageBits.substring(i, i + 8);
        bytes.push(parseInt(byte, 2));
    }
    
    return Buffer.from(bytes);
}

/**
 * Compute checksum using Internet Checksum algorithm
 */
function computeChecksum(bitsLength, ...data) {
    let checksum = BigInt(0);
    
    for (const value of data) {
        checksum += typeof value === 'bigint' ? value : BigInt(value);
    }
    
    while (bitLength(Number(checksum)) > bitsLength) {
        const checksumBitLength = bitLength(Number(checksum));
        const halfLength = Math.floor(checksumBitLength / 2);
        const mask = (BigInt(1) << BigInt(halfLength)) - BigInt(1);
        
        const lowBits = checksum & mask;
        const highBits = checksum >> BigInt(halfLength);
        
        checksum = lowBits + highBits;
    }
    
    return Number(checksum);
}

/**
 * Create message with checksum
 */
function createMessage(type, ...fields) {
    const checksum = computeChecksum(21, type, ...fields);
    const fieldsWithChecksum = [checksum, ...fields];
    return packMessage(type, ...fieldsWithChecksum);
}

/**
 * Open and validate message
 */
function openMessage(message) {
    const fields = unpackMessage(message);
    const checksum = fields[1];
    
    // Remove checksum for validation
    const fieldsWithoutChecksum = [fields[0], ...fields.slice(2)];
    const calculatedChecksum = computeChecksum(21, ...fieldsWithoutChecksum);
    
    if (checksum !== calculatedChecksum) {
        throw new Error('Invalid checksum');
    }
    
    // Return fields without checksum
    return fieldsWithoutChecksum;
}

/**
 * Corrupt message for testing
 */
function corruptMessage(message) {
    const corrupted = Buffer.from(message);
    if (corrupted.length > 1) {
        corrupted[1] = 'a'.charCodeAt(0);
    }
    return corrupted;
}

module.exports = {
    Type,
    Mask,
    unpackMessage,
    packMessage,
    computeChecksum,
    createMessage,
    openMessage,
    corruptMessage,
    getTypeName
};
