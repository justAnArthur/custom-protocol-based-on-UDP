#!/usr/bin/env node
/**
 * SNSS Protocol Server - Node.js Implementation
 * Sync 'n' Send Spectacle - Custom UDP-based reliable transfer protocol
 */

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Type, createMessage, openMessage, corruptMessage } = require('./message');

// Parse command line arguments
const args = parseArgs(process.argv.slice(2));

const config = {
    ip: args.ip || 'localhost',
    port: args.port || 3141,
    debug: args.debug || false,
    broken: args.broken || false,
    encryption: args.encryption || false
};

let windowSize = 1;
let payloadSize = 1;
let storingDirectory = './';

// Main UDP socket
const sock = dgram.createSocket('udp4');

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-p' || argv[i] === '--port') {
            args.port = parseInt(argv[++i]);
        } else if (argv[i] === '-a' || argv[i] === '--ip') {
            args.ip = argv[++i];
        } else if (argv[i] === '-d' || argv[i] === '--debug') {
            args.debug = argv[++i] === 'true';
        } else if (argv[i] === '-b' || argv[i] === '--broken') {
            args.broken = argv[++i] === 'true';
        } else if (argv[i] === '-e' || argv[i] === '--encryption') {
            args.encryption = argv[++i] === 'true';
        } else if (argv[i] === '-h' || argv[i] === '--help') {
            console.log(`
Usage: node server.js [options]

Options:
  -p, --port <number>        Port to listen on (default: 3141)
  -a, --ip <address>         IP address to bind (default: localhost)
  -d, --debug <true|false>   Enable debug mode (default: false)
  -b, --broken <true|false>  Enable random message corruption/dropping (default: false)
  -e, --encryption <true|false> Enable simple encryption (default: false)
  -h, --help                 Show this help message
            `);
            process.exit(0);
        }
    }
    return args;
}

/**
 * Receive message/file from client
 */
async function receiveMessage(fields, remoteIp, remotePort) {
    const sockMessage = dgram.createSocket('udp4');
    sockMessage.bind();
    
    const isFile = fields[0] === Type.REQ;
    let fileName = null;
    
    if (isFile) {
        // Decode filename from BigInt
        const fileNameInt = fields[3];
        const fileNameBytes = bigIntToBytes(fileNameInt);
        fileName = fileNameBytes.toString('utf-8');
    }
    
    const _windowSize = fields[1];
    const _payloadSize = fields[2];
    let seqNumber = 0;
    let index = 0;
    
    const messageChunkBytes = {};
    const seqNumberNegatives = [];
    
    return new Promise((resolve) => {
        let timeoutIndex = 0;
        let received = false;
        
        sockMessage.on('error', (err) => {
            console.error('Socket error:', err);
            sockMessage.close();
            resolve();
        });
        
        // Send initial APR
        const aprMessage = createMessage(Type.APR, seqNumber);
        sockMessage.send(aprMessage, remotePort, remoteIp);
        
        // Set timeout
        let timeout = setTimeout(() => {
            handleTimeout();
        }, 3000);
        
        function handleTimeout() {
            timeoutIndex++;
            if (timeoutIndex > 2) {
                sockMessage.close();
                resolve();
                return;
            }
            
            if (received !== false && seqNumberNegatives.length === 0) {
                sendAck(received);
                sockMessage.close();
                resolve();
            } else {
                timeout = setTimeout(handleTimeout, 3000);
            }
        }
        
        function sendNegative(seqNum) {
            if (seqNumberNegatives.includes(seqNum)) {
                const nackMessage = createMessage(Type.NACK, seqNum);
                sockMessage.send(nackMessage, remotePort, remoteIp);
                setTimeout(() => sendNegative(seqNum), 1000);
            }
        }
        
        function sendAck(seqNum) {
            let message = createMessage(Type.APR, seqNum);
            
            if (config.broken && Math.random() < 0.2) {
                if (config.debug) {
                    console.log('broking message', seqNum);
                }
                message = corruptMessage(message);
            } else if (config.broken && Math.random() < 0.2) {
                if (config.debug) {
                    console.log('dropping message', seqNum);
                }
                return;
            }
            
            sockMessage.send(message, remotePort, remoteIp);
        }
        
        sockMessage.on('message', (data, rinfo) => {
            // Reset timeout
            clearTimeout(timeout);
            timeout = setTimeout(handleTimeout, 3000);
            timeoutIndex = 0;
            
            try {
                const fields = openMessage(data);
                
                if (fields[0] === Type.DATA) {
                    const chunk = bigIntToBytes(fields[2]);
                    
                    if (fields[1] !== seqNumber) {
                        if (!seqNumberNegatives.includes(fields[1])) {
                            for (let seq = seqNumber; seq < fields[1]; seq += _payloadSize) {
                                seqNumberNegatives.push(seq);
                                setTimeout(() => sendNegative(seq), 1000);
                            }
                        } else {
                            const idx = seqNumberNegatives.indexOf(fields[1]);
                            if (idx > -1) seqNumberNegatives.splice(idx, 1);
                        }
                    }
                    
                    messageChunkBytes[fields[1]] = chunk;
                    
                    if (fields[1] === seqNumber && seqNumberNegatives.includes(fields[1])) {
                        const idx = seqNumberNegatives.indexOf(fields[1]);
                        if (idx > -1) seqNumberNegatives.splice(idx, 1);
                    }
                    
                    if (!seqNumberNegatives.includes(fields[1])) {
                        seqNumber = fields[1] + _payloadSize;
                        index++;
                    } else {
                        return;
                    }
                    
                    if (chunk.length < _payloadSize) {
                        received = fields[1] + _payloadSize;
                    } else if (index === _windowSize) {
                        index = 0;
                        sendAck(fields[1] + _payloadSize);
                    }
                }
            } catch (err) {
                if (err.message === 'Invalid checksum') {
                    seqNumberNegatives.push(seqNumber);
                    setTimeout(() => sendNegative(seqNumber), 100);
                } else {
                    console.error('receiving error', err);
                }
            }
        });
        
        // Final check after all processing
        sockMessage.on('close', () => {
            if (received) {
                if (isFile) {
                    // Write file
                    const filePath = path.join(storingDirectory, fileName);
                    const sortedKeys = Object.keys(messageChunkBytes).map(Number).sort((a, b) => a - b);
                    const fileData = Buffer.concat(sortedKeys.map(key => messageChunkBytes[key]));
                    
                    fs.writeFileSync(filePath, fileData);
                    console.log(`file ${fileName} received`);
                } else {
                    // Reconstruct message
                    const sortedKeys = Object.keys(messageChunkBytes).map(Number).sort((a, b) => a - b);
                    let message = sortedKeys.map(key => messageChunkBytes[key].toString('utf-8')).join('');
                    
                    if (config.encryption && message.length % 2 !== 0) {
                        message = message.slice(0, -1);
                    }
                    
                    console.log(`${remoteIp}:${remotePort} | ${Math.floor((message.length + 1) / 3)} > ${message}`);
                }
            }
            resolve();
        });
    });
}

/**
 * Listen for incoming messages
 */
function listen() {
    sock.on('message', async (data, rinfo) => {
        try {
            const fields = openMessage(data);
            
            if (config.debug) {
                console.log('received', fields);
            }
            
            switch (fields[0]) {
                case Type.REQ:
                case Type.REQ_M:
                    await receiveMessage(fields, rinfo.address, rinfo.port);
                    break;
                    
                case Type.KEEP_A:
                    const keepAliveMsg = createMessage(Type.KEEP_A);
                    sock.send(keepAliveMsg, rinfo.port, rinfo.address);
                    break;
            }
        } catch (err) {
            console.error('receiving error', err);
        }
    });
}

/**
 * Send message/file to client
 */
async function sendMessage(ip, port, messageBytes, fileNameInt = null) {
    const sockMessage = dgram.createSocket('udp4');
    sockMessage.bind();
    
    return new Promise((resolve, reject) => {
        const messageChunks = {};
        for (let i = 0; i < messageBytes.length; i += payloadSize) {
            messageChunks[i] = messageBytes.slice(i, i + payloadSize);
        }
        
        // Add empty chunk if message is exact multiple of payload size
        const isMessageWithRemainder = messageBytes.length % payloadSize !== 0;
        if (!isMessageWithRemainder) {
            messageChunks[messageBytes.length] = Buffer.alloc(0);
        }
        
        let approved = false;
        let index = 0;
        let attempts = 0;
        
        sockMessage.on('error', (err) => {
            console.error('Socket error:', err);
            sockMessage.close();
            reject(err);
        });
        
        // Send request
        function sendRequest() {
            if (attempts >= 3) {
                console.log('connection timed out');
                sockMessage.close();
                reject(new Error('Connection timeout'));
                return;
            }
            
            const reqArguments = [Type.REQ_M, windowSize, payloadSize];
            
            if (fileNameInt !== null) {
                reqArguments[0] = Type.REQ;
                reqArguments.push(fileNameInt);
            }
            
            const reqMsg = createMessage(...reqArguments);
            sockMessage.send(reqMsg, port, ip);
            attempts++;
            
            setTimeout(() => {
                if (!approved) {
                    sendRequest();
                }
            }, 3000);
        }
        
        sockMessage.on('message', (data, rinfo) => {
            try {
                const fields = openMessage(data);
                
                if (config.debug) {
                    console.log('received', fields);
                }
                
                if (fields[0] === Type.APR && !approved) {
                    approved = true;
                    index = fields[1];
                    startSending();
                } else if (fields[0] === Type.NACK) {
                    sendChunk(fields[1]);
                } else if (fields[0] === Type.APR) {
                    const maxKey = Math.max(...Object.keys(messageChunks).map(Number));
                    
                    if (maxKey + payloadSize === fields[1]) {
                        sockMessage.close();
                        resolve();
                    } else if (messageChunks[fields[1]] !== undefined) {
                        index = fields[1];
                        sendWindow();
                    }
                }
            } catch (err) {
                if (config.debug) {
                    console.error('Error processing message:', err);
                }
            }
        });
        
        function sendChunk(seqNumber) {
            const chunk = messageChunks[seqNumber];
            const chunkInt = chunk.length > 0 ? bytesToBigInt(chunk) : BigInt(0);
            const dataMsg = createMessage(Type.DATA, seqNumber, chunkInt);
            sockMessage.send(dataMsg, port, ip);
        }
        
        function sendWindow() {
            const keysToSend = [];
            for (let i = 0; i < windowSize; i++) {
                const key = index + i * payloadSize;
                if (messageChunks[key] !== undefined) {
                    keysToSend.push(key);
                }
            }
            
            for (const seqNumber of keysToSend) {
                if (config.broken && Math.random() < 0.2) {
                    if (config.debug) {
                        console.log('broking message', seqNumber);
                    }
                    const chunk = messageChunks[seqNumber];
                    const chunkInt = chunk.length > 0 ? bytesToBigInt(chunk) : BigInt(0);
                    const dataMsg = corruptMessage(createMessage(Type.DATA, seqNumber, chunkInt));
                    sockMessage.send(dataMsg, port, ip);
                    continue;
                } else if (config.broken && Math.random() < 0.2) {
                    if (config.debug) {
                        console.log('dropping message', seqNumber);
                    }
                    continue;
                }
                
                sendChunk(seqNumber);
            }
        }
        
        function startSending() {
            sendWindow();
        }
        
        sendRequest();
    });
}

/**
 * Manage session with keep-alive
 */
async function session(ip, port) {
    let aliveConnection = false;
    const sockKeepAlive = dgram.createSocket('udp4');
    sockKeepAlive.bind();
    
    let timer = null;
    
    function sendKeepAlive() {
        const keepAliveMsg = createMessage(Type.KEEP_A);
        sockKeepAlive.send(keepAliveMsg, port, ip);
        
        const timeout = setTimeout(() => {
            console.log('exception on keep-alive connection: timeout');
            aliveConnection = false;
            if (timer) clearInterval(timer);
        }, 3000);
        
        sockKeepAlive.once('message', (data, rinfo) => {
            clearTimeout(timeout);
            aliveConnection = true;
        });
    }
    
    return new Promise((resolve) => {
        // Initial keep-alive
        sendKeepAlive();
        
        setTimeout(() => {
            if (!aliveConnection) {
                console.log('Failed to establish connection');
                sockKeepAlive.close();
                resolve();
                return;
            }
            
            // Start keep-alive timer
            timer = setInterval(sendKeepAlive, 1000);
            
            // Setup readline for user input
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            async function promptMessage() {
                rl.question('enter message:\n', async (message) => {
                    if (timer) clearInterval(timer);
                    
                    if (message === '>exit') {
                        rl.close();
                        sockKeepAlive.close();
                        resolve();
                        return;
                    }
                    
                    try {
                        if (message.startsWith('\\')) {
                            // Send file
                            const filePath = message.substring(1);
                            try {
                                const fileData = fs.readFileSync(filePath);
                                const fileNameInt = bytesToBigInt(Buffer.from(filePath, 'utf-8'));
                                await sendMessage(ip, port, fileData, fileNameInt);
                            } catch (err) {
                                console.log('file not found');
                            }
                        } else {
                            // Send message
                            let messageToSend = message;
                            
                            if (config.encryption) {
                                // Simple encryption: reverse pairs
                                const pairs = [];
                                for (let i = 0; i < message.length; i += 2) {
                                    const pair = message.substring(i, i + 2);
                                    pairs.push(pair.split('').reverse().join(''));
                                }
                                messageToSend = pairs.join(' ');
                            }
                            
                            await sendMessage(ip, port, Buffer.from(messageToSend, 'utf-8'));
                        }
                    } catch (err) {
                        console.error(err);
                        rl.close();
                        sockKeepAlive.close();
                        resolve();
                        return;
                    }
                    
                    // Restart keep-alive and prompt again
                    sendKeepAlive();
                    timer = setInterval(sendKeepAlive, 1000);
                    
                    if (aliveConnection) {
                        promptMessage();
                    } else {
                        rl.close();
                        sockKeepAlive.close();
                        resolve();
                    }
                });
            }
            
            promptMessage();
        }, 3000);
    });
}

/**
 * Handle user input for session management
 */
async function userInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    function promptSocket() {
        rl.question('enter ip and port number:\n', async (input) => {
            try {
                if (input.startsWith('>')) {
                    // Handle commands
                    if (input.startsWith('>payload_size ')) {
                        const value = parseInt(input.split(' ')[1]);
                        if (!isNaN(value)) {
                            payloadSize = value;
                            console.log(`Payload size set to ${payloadSize}`);
                        } else {
                            console.log('invalid input');
                        }
                    } else if (input.startsWith('>window_size ')) {
                        const value = parseInt(input.split(' ')[1]);
                        if (!isNaN(value)) {
                            windowSize = value;
                            console.log(`Window size set to ${windowSize}`);
                        } else {
                            console.log('invalid input');
                        }
                    } else if (input.startsWith('>storing_directory ')) {
                        const value = input.split(' ')[1];
                        storingDirectory = value;
                        console.log(`Storing directory set to ${storingDirectory}`);
                    } else {
                        console.log('invalid command');
                    }
                    promptSocket();
                } else {
                    const parts = input.split(' ');
                    if (parts.length !== 2) {
                        console.log('invalid input');
                        promptSocket();
                        return;
                    }
                    
                    const [ip, port] = parts;
                    await session(ip, parseInt(port));
                    promptSocket();
                }
            } catch (err) {
                console.error(err);
                promptSocket();
            }
        });
    }
    
    promptSocket();
}

/**
 * Helper: Convert BigInt to bytes
 */
function bigIntToBytes(bigInt) {
    if (typeof bigInt !== 'bigint') {
        bigInt = BigInt(bigInt);
    }
    
    if (bigInt === BigInt(0)) {
        return Buffer.alloc(0);
    }
    
    const hex = bigInt.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
    return Buffer.from(paddedHex, 'hex');
}

/**
 * Helper: Convert bytes to BigInt
 */
function bytesToBigInt(bytes) {
    if (bytes.length === 0) {
        return BigInt(0);
    }
    return BigInt('0x' + bytes.toString('hex'));
}

// Start server
sock.bind(config.port, config.ip, () => {
    console.log(`SNSS Server listening on ${config.ip}:${config.port}`);
    console.log('Debug mode:', config.debug);
    console.log('Broken mode:', config.broken);
    console.log('Encryption:', config.encryption);
    console.log('\nCommands:');
    console.log('  >payload_size <number>  - Set payload size');
    console.log('  >window_size <number>   - Set window size');
    console.log('  >storing_directory <path> - Set file storage directory');
    console.log('  \\<filename>            - Send file (in session)');
    console.log('  >exit                   - Exit session');
    
    listen();
    userInput();
});

sock.on('error', (err) => {
    console.error('Socket error:', err);
    sock.close();
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    sock.close();
    process.exit(0);
});
