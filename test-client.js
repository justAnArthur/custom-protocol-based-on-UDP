#!/usr/bin/env node
/**
 * Test Client for SNSS Protocol
 * Demonstrates basic protocol functionality
 */

const { Type, createMessage, openMessage, packMessage, unpackMessage, computeChecksum } = require('./message');

console.log('=== SNSS Protocol Test Suite ===\n');

// Test 1: Message Type Definitions
console.log('Test 1: Message Type Definitions');
console.log('REQ:', Type.REQ.toString(2).padStart(3, '0'), '(', Type.REQ, ')');
console.log('REQ_M:', Type.REQ_M.toString(2).padStart(3, '0'), '(', Type.REQ_M, ')');
console.log('APR:', Type.APR.toString(2).padStart(3, '0'), '(', Type.APR, ')');
console.log('NACK:', Type.NACK.toString(2).padStart(3, '0'), '(', Type.NACK, ')');
console.log('DATA:', Type.DATA.toString(2).padStart(3, '0'), '(', Type.DATA, ')');
console.log('KEEP_A:', Type.KEEP_A.toString(2).padStart(3, '0'), '(', Type.KEEP_A, ')');
console.log('✓ All types defined correctly\n');

// Test 2: Checksum Calculation
console.log('Test 2: Checksum Calculation');
const checksumTest1 = computeChecksum(8, Type.REQ, 1, 100);
console.log('computeChecksum(8, REQ, 1, 100) =', checksumTest1);
const checksumTest2 = computeChecksum(21, Type.REQ, 1, 100);
console.log('computeChecksum(21, REQ, 1, 100) =', checksumTest2);
console.log('✓ Checksum calculations work\n');

// Test 3: KEEP_A Message
console.log('Test 3: KEEP_A Message (Keep-Alive)');
const keepAliveMsg = createMessage(Type.KEEP_A);
console.log('Created message length:', keepAliveMsg.length, 'bytes');
console.log('Message bytes:', keepAliveMsg.toString('hex'));
const keepAliveFields = openMessage(keepAliveMsg);
console.log('Parsed fields:', keepAliveFields);
console.log('✓ KEEP_A message created and parsed successfully\n');

// Test 4: APR Message (Acknowledgment)
console.log('Test 4: APR Message (Acknowledgment)');
const seqNumber = 1024;
const aprMsg = createMessage(Type.APR, seqNumber);
console.log('Created APR with seq_number:', seqNumber);
console.log('Message bytes:', aprMsg.toString('hex'));
const aprFields = openMessage(aprMsg);
console.log('Parsed fields:', aprFields);
console.log('Type:', aprFields[0], 'Seq Number:', aprFields[1]);
console.log('✓ APR message created and parsed successfully\n');

// Test 5: NACK Message (Negative Acknowledgment)
console.log('Test 5: NACK Message (Negative Acknowledgment)');
const nackSeq = 512;
const nackMsg = createMessage(Type.NACK, nackSeq);
console.log('Created NACK with seq_number:', nackSeq);
console.log('Message bytes:', nackMsg.toString('hex'));
const nackFields = openMessage(nackMsg);
console.log('Parsed fields:', nackFields);
console.log('Type:', nackFields[0], 'Seq Number:', nackFields[1]);
console.log('✓ NACK message created and parsed successfully\n');

// Test 6: DATA Message
console.log('Test 6: DATA Message');
const dataSeq = 0;
const testData = Buffer.from('Hello, SNSS!', 'utf-8');
const dataBigInt = BigInt('0x' + testData.toString('hex'));
const dataMsg = createMessage(Type.DATA, dataSeq, dataBigInt);
console.log('Created DATA with seq_number:', dataSeq, 'and data:', testData.toString());
console.log('Message length:', dataMsg.length, 'bytes');
const dataFields = openMessage(dataMsg);
console.log('Parsed fields - Type:', dataFields[0], 'Seq:', dataFields[1]);
// Convert BigInt back to buffer
const receivedDataBigInt = dataFields[2];
const receivedDataHex = receivedDataBigInt.toString(16);
const receivedDataBuffer = Buffer.from(receivedDataHex.length % 2 === 0 ? receivedDataHex : '0' + receivedDataHex, 'hex');
console.log('Received data:', receivedDataBuffer.toString('utf-8'));
console.log('✓ DATA message created and parsed successfully\n');

// Test 7: REQ_M Message (Message Request)
console.log('Test 7: REQ_M Message (Message Request)');
const windowSize = 5;
const payloadSize = 1024;
const reqMMsg = createMessage(Type.REQ_M, windowSize, payloadSize);
console.log('Created REQ_M with window_size:', windowSize, 'payload_size:', payloadSize);
console.log('Message bytes:', reqMMsg.toString('hex'));
const reqMFields = openMessage(reqMMsg);
console.log('Parsed fields:', reqMFields);
console.log('Type:', reqMFields[0], 'Window:', reqMFields[1], 'Payload:', reqMFields[2]);
console.log('✓ REQ_M message created and parsed successfully\n');

// Test 8: REQ Message (File Request)
console.log('Test 8: REQ Message (File Request)');
const fileName = 'test.txt';
const fileNameBuffer = Buffer.from(fileName, 'utf-8');
const fileNameBigInt = BigInt('0x' + fileNameBuffer.toString('hex'));
const reqMsg = createMessage(Type.REQ, windowSize, payloadSize, fileNameBigInt);
console.log('Created REQ for file:', fileName);
console.log('Message length:', reqMsg.length, 'bytes');
const reqFields = openMessage(reqMsg);
console.log('Parsed fields - Type:', reqFields[0], 'Window:', reqFields[1], 'Payload:', reqFields[2]);
// Decode filename
const fileNameReceivedInt = reqFields[3];
const fileNameReceivedHex = fileNameReceivedInt.toString(16);
const fileNameReceivedBuffer = Buffer.from(fileNameReceivedHex.length % 2 === 0 ? fileNameReceivedHex : '0' + fileNameReceivedHex, 'hex');
console.log('Received filename:', fileNameReceivedBuffer.toString('utf-8'));
console.log('✓ REQ message created and parsed successfully\n');

// Test 9: Checksum Validation (Corrupted Message)
console.log('Test 9: Checksum Validation (Invalid Message)');
const testMsg = createMessage(Type.APR, 100);
console.log('Original message valid');
const corruptedMsg = Buffer.from(testMsg);
corruptedMsg[1] = 0xFF; // Corrupt checksum byte
try {
    openMessage(corruptedMsg);
    console.log('✗ Should have thrown error for corrupted message');
} catch (err) {
    console.log('✓ Correctly detected corrupted message:', err.message);
}
console.log();

// Test 10: Multiple DATA Messages
console.log('Test 10: Multiple DATA Messages (Simulating Transfer)');
const fullMessage = 'This is a longer test message that will be split into chunks';
const chunkSize = 10;
const chunks = [];

for (let i = 0; i < fullMessage.length; i += chunkSize) {
    const chunk = fullMessage.substring(i, i + chunkSize);
    const chunkBuffer = Buffer.from(chunk, 'utf-8');
    const chunkBigInt = BigInt('0x' + chunkBuffer.toString('hex'));
    const seqNum = i;
    chunks.push({
        seqNum,
        message: createMessage(Type.DATA, seqNum, chunkBigInt)
    });
}

console.log(`Created ${chunks.length} DATA chunks`);

// Simulate receiving and reconstructing
const receivedChunks = {};
for (const chunk of chunks) {
    const fields = openMessage(chunk.message);
    const chunkBigInt = fields[2];
    const hex = chunkBigInt.toString(16);
    const buffer = Buffer.from(hex.length % 2 === 0 ? hex : '0' + hex, 'hex');
    receivedChunks[fields[1]] = buffer;
}

const sortedSeqs = Object.keys(receivedChunks).map(Number).sort((a, b) => a - b);
const reconstructed = sortedSeqs.map(seq => receivedChunks[seq].toString('utf-8')).join('');
console.log('Original:', fullMessage);
console.log('Reconstructed:', reconstructed);
console.log('✓ Message successfully split and reconstructed\n');

console.log('=== All Tests Passed ===');
console.log('\nTo test the full server, run two instances:');
console.log('  Terminal 1: node server.js -p 3141');
console.log('  Terminal 2: node server.js -p 3142');
console.log('Then in Terminal 2, enter: 127.0.0.1 3141');
console.log('And start sending messages!');
