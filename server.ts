#!/usr/bin/env bun
/**
 * SNSS Protocol Server - TypeScript/Bun Implementation
 * Sync 'n' Send Spectacle - Custom UDP-based reliable transfer protocol
 */

import { createSocket, type Socket, type RemoteInfo } from "node:dgram";
import { join } from "node:path";
import * as readline from "node:readline";
import {
    Type,
    createMessage,
    openMessage,
    corruptMessage,
    type FieldValue,
} from "./message";

// ---------------------------------------------------------------------------
// CLI configuration
// ---------------------------------------------------------------------------

interface Config {
    ip: string;
    port: number;
    debug: boolean;
    broken: boolean;
    encryption: boolean;
}

function parseArgs(argv: string[]): Config {
    const cfg: Config = {
        ip: "localhost",
        port: 3141,
        debug: false,
        broken: false,
        encryption: false,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case "-p":
            case "--port":
                cfg.port = parseInt(argv[++i]!);
                break;
            case "-a":
            case "--ip":
                cfg.ip = argv[++i]!;
                break;
            case "-d":
            case "--debug":
                cfg.debug = argv[++i] === "true";
                break;
            case "-b":
            case "--broken":
                cfg.broken = argv[++i] === "true";
                break;
            case "-e":
            case "--encryption":
                cfg.encryption = argv[++i] === "true";
                break;
            case "-h":
            case "--help":
                console.log(`
Usage: bun run server.ts [options]

Options:
  -p, --port <number>           Port to listen on (default: 3141)
  -a, --ip <address>            IP address to bind (default: localhost)
  -d, --debug <true|false>      Enable debug mode (default: false)
  -b, --broken <true|false>     Randomly corrupt/drop packets (default: false)
  -e, --encryption <true|false> Enable simple encryption (default: false)
  -h, --help                    Show this help message
                `);
                process.exit(0);
        }
    }
    return cfg;
}

const config = parseArgs(process.argv.slice(2));

// Mutable transfer settings (can be changed via CLI commands)
let windowSize = 1;
let payloadSize = 1;
let storingDirectory = "./";

// Main listening socket
const sock: Socket = createSocket("udp4");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bigIntToBytes(value: bigint): Buffer {
    if (value === 0n) return Buffer.alloc(0);
    const hex = value.toString(16);
    return Buffer.from(hex.length % 2 === 0 ? hex : "0" + hex, "hex");
}

function bytesToBigInt(bytes: Buffer): bigint {
    if (bytes.length === 0) return 0n;
    return BigInt("0x" + bytes.toString("hex"));
}

// ---------------------------------------------------------------------------
// Receiver side
// ---------------------------------------------------------------------------

async function receiveMessage(
    fields: FieldValue[],
    remoteIp: string,
    remotePort: number
): Promise<void> {
    const sockMessage: Socket = createSocket("udp4");
    sockMessage.bind();

    const isFile = fields[0] === Type.REQ;
    let fileName: string | null = null;

    if (isFile) {
        fileName = bigIntToBytes(fields[3] as bigint).toString("utf-8");
    }

    const _windowSize = fields[1] as number;
    const _payloadSize = fields[2] as number;
    let seqNumber = 0;
    let index = 0;

    const messageChunkBytes: Record<number, Buffer> = {};
    const seqNumberNegatives: number[] = [];

    return new Promise<void>((resolve) => {
        let timeoutIndex = 0;
        let received: number | false = false;
        let timeout: ReturnType<typeof setTimeout>;

        function cleanup(): void {
            clearTimeout(timeout);
            sockMessage.close();
        }

        function handleTimeout(): void {
            timeoutIndex++;
            if (timeoutIndex > 2) {
                cleanup();
                resolve();
                return;
            }

            if (received !== false && seqNumberNegatives.length === 0) {
                sendAck(received);
                cleanup();
                resolve();
            } else {
                timeout = setTimeout(handleTimeout, 3000);
            }
        }

        function sendNegative(seqNum: number): void {
            if (!seqNumberNegatives.includes(seqNum)) return;
            sockMessage.send(createMessage(Type.NACK, seqNum), remotePort, remoteIp);
            setTimeout(() => sendNegative(seqNum), 1000);
        }

        function sendAck(seqNum: number): void {
            let msg = createMessage(Type.APR, seqNum);

            if (config.broken && Math.random() < 0.2) {
                if (config.debug) console.log("broking message", seqNum);
                msg = corruptMessage(msg);
            } else if (config.broken && Math.random() < 0.2) {
                if (config.debug) console.log("dropping message", seqNum);
                return;
            }

            sockMessage.send(msg, remotePort, remoteIp);
        }

        sockMessage.on("error", (err) => {
            console.error("Socket error:", err);
            cleanup();
            resolve();
        });

        // Send initial APR (seq = 0 means "ready to receive from seq 0")
        sockMessage.send(createMessage(Type.APR, seqNumber), remotePort, remoteIp);
        timeout = setTimeout(handleTimeout, 3000);

        sockMessage.on("message", (data: Buffer) => {
            clearTimeout(timeout);
            timeout = setTimeout(handleTimeout, 3000);
            timeoutIndex = 0;

            try {
                const f = openMessage(data);

                if (f[0] === Type.DATA) {
                    const chunk = bigIntToBytes(f[2] as bigint);
                    const fSeq = f[1] as number;

                    if (fSeq !== seqNumber) {
                        if (!seqNumberNegatives.includes(fSeq)) {
                            for (let seq = seqNumber; seq < fSeq; seq += _payloadSize) {
                                seqNumberNegatives.push(seq);
                                setTimeout(() => sendNegative(seq), 1000);
                            }
                        } else {
                            const idx = seqNumberNegatives.indexOf(fSeq);
                            if (idx > -1) seqNumberNegatives.splice(idx, 1);
                        }
                    }

                    messageChunkBytes[fSeq] = chunk;

                    if (fSeq === seqNumber && seqNumberNegatives.includes(fSeq)) {
                        const idx = seqNumberNegatives.indexOf(fSeq);
                        if (idx > -1) seqNumberNegatives.splice(idx, 1);
                    }

                    if (!seqNumberNegatives.includes(fSeq)) {
                        seqNumber = fSeq + _payloadSize;
                        index++;
                    } else {
                        return;
                    }

                    if (chunk.length < _payloadSize) {
                        received = fSeq + _payloadSize;
                    } else if (index === _windowSize) {
                        index = 0;
                        sendAck(fSeq + _payloadSize);
                    }
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                if (message === "Invalid checksum") {
                    seqNumberNegatives.push(seqNumber);
                    setTimeout(() => sendNegative(seqNumber), 100);
                } else {
                    console.error("receiving error", err);
                }
            }
        });

        sockMessage.on("close", () => {
            if (!received) {
                resolve();
                return;
            }

            const sortedKeys = Object.keys(messageChunkBytes)
                .map(Number)
                .sort((a, b) => a - b);

            if (isFile && fileName) {
                const fileData = Buffer.concat(sortedKeys.map((k) => messageChunkBytes[k]!));
                Bun.write(join(storingDirectory, fileName), fileData)
                    .then(() => console.log(`file ${fileName} received`))
                    .catch((err) => console.error("error writing file", err))
                    .finally(() => resolve());
            } else {
                let message = sortedKeys
                    .map((k) => messageChunkBytes[k]!.toString("utf-8"))
                    .join("");

                if (config.encryption && message.length % 2 !== 0) {
                    message = message.slice(0, -1);
                }

                console.log(
                    `${remoteIp}:${remotePort} | ${Math.floor((message.length + 1) / 3)} > ${message}`
                );
                resolve();
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Main listener
// ---------------------------------------------------------------------------

function listen(): void {
    sock.on("message", async (data: Buffer, rinfo: RemoteInfo) => {
        try {
            const fields = openMessage(data);

            if (config.debug) console.log("received", fields);

            switch (fields[0]) {
                case Type.REQ:
                case Type.REQ_M:
                    await receiveMessage(fields, rinfo.address, rinfo.port);
                    break;

                case Type.KEEP_A:
                    sock.send(createMessage(Type.KEEP_A), rinfo.port, rinfo.address);
                    break;
            }
        } catch (err) {
            console.error("receiving error", err);
        }
    });
}

// ---------------------------------------------------------------------------
// Sender side
// ---------------------------------------------------------------------------

async function sendMessage(
    ip: string,
    port: number,
    messageBytes: Buffer,
    fileNameInt: bigint | null = null
): Promise<void> {
    const sockMessage: Socket = createSocket("udp4");
    sockMessage.bind();

    return new Promise<void>((resolve, reject) => {
        const messageChunks: Record<number, Buffer> = {};
        for (let i = 0; i < messageBytes.length; i += payloadSize) {
            messageChunks[i] = messageBytes.subarray(i, i + payloadSize);
        }

        // Sentinel empty chunk when data ends exactly on a boundary
        if (messageBytes.length % payloadSize === 0) {
            messageChunks[messageBytes.length] = Buffer.alloc(0);
        }

        let approved = false;
        let index = 0;
        let attempts = 0;

        sockMessage.on("error", (err) => {
            console.error("Socket error:", err);
            sockMessage.close();
            reject(err);
        });

        function sendRequest(): void {
            if (attempts >= 3) {
                console.log("connection timed out");
                sockMessage.close();
                reject(new Error("Connection timeout"));
                return;
            }

            const reqArgs: (number | bigint)[] =
                fileNameInt !== null
                    ? [Type.REQ, windowSize, payloadSize, fileNameInt]
                    : [Type.REQ_M, windowSize, payloadSize];

            sockMessage.send(createMessage(...(reqArgs as [number, ...FieldValue[]])), port, ip);
            attempts++;

            setTimeout(() => {
                if (!approved) sendRequest();
            }, 3000);
        }

        function sendChunk(seqNumber: number): void {
            const chunk = messageChunks[seqNumber]!;
            const chunkInt = chunk.length > 0 ? bytesToBigInt(chunk) : 0n;
            sockMessage.send(createMessage(Type.DATA, seqNumber, chunkInt), port, ip);
        }

        function sendWindow(): void {
            for (let i = 0; i < windowSize; i++) {
                const key = index + i * payloadSize;
                if (!(key in messageChunks)) continue;

                if (config.broken && Math.random() < 0.2) {
                    if (config.debug) console.log("broking message", key);
                    const chunk = messageChunks[key]!;
                    const chunkInt = chunk.length > 0 ? bytesToBigInt(chunk) : 0n;
                    sockMessage.send(
                        corruptMessage(createMessage(Type.DATA, key, chunkInt)),
                        port,
                        ip
                    );
                    continue;
                } else if (config.broken && Math.random() < 0.2) {
                    if (config.debug) console.log("dropping message", key);
                    continue;
                }

                sendChunk(key);
            }
        }

        sockMessage.on("message", (data: Buffer) => {
            try {
                const fields = openMessage(data);

                if (config.debug) console.log("received", fields);

                if (fields[0] === Type.APR && !approved) {
                    approved = true;
                    index = fields[1] as number;
                    sendWindow();
                } else if (fields[0] === Type.NACK) {
                    sendChunk(fields[1] as number);
                } else if (fields[0] === Type.APR) {
                    const maxKey = Math.max(...Object.keys(messageChunks).map(Number));

                    if (maxKey + payloadSize === (fields[1] as number)) {
                        sockMessage.close();
                        resolve();
                    } else if ((fields[1] as number) in messageChunks) {
                        index = fields[1] as number;
                        sendWindow();
                    }
                }
            } catch (err) {
                if (config.debug) console.error("Error processing message:", err);
            }
        });

        sendRequest();
    });
}

// ---------------------------------------------------------------------------
// Session (keep-alive + interactive input)
// ---------------------------------------------------------------------------

async function session(ip: string, port: number): Promise<void> {
    let aliveConnection = false;
    const sockKeepAlive: Socket = createSocket("udp4");
    sockKeepAlive.bind();

    let timer: ReturnType<typeof setInterval> | null = null;

    function sendKeepAlive(): void {
        sockKeepAlive.send(createMessage(Type.KEEP_A), port, ip);

        const t = setTimeout(() => {
            console.log("exception on keep-alive connection: timeout");
            aliveConnection = false;
            if (timer) clearInterval(timer);
        }, 3000);

        sockKeepAlive.once("message", () => {
            clearTimeout(t);
            aliveConnection = true;
        });
    }

    return new Promise<void>((resolve) => {
        sendKeepAlive();

        setTimeout(async () => {
            if (!aliveConnection) {
                console.log("Failed to establish connection");
                sockKeepAlive.close();
                resolve();
                return;
            }

            timer = setInterval(sendKeepAlive, 1000);

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const promptMessage = async (): Promise<void> => {
                return new Promise<void>((done) => {
                    rl.question("enter message:\n", async (message) => {
                        if (timer) clearInterval(timer);

                        if (message === ">exit") {
                            rl.close();
                            sockKeepAlive.close();
                            resolve();
                            return;
                        }

                        try {
                            if (message.startsWith("\\")) {
                                const filePath = message.substring(1);
                                const file = Bun.file(filePath);
                                if (!(await file.exists())) {
                                    console.log("file not found");
                                } else {
                                    const fileData = Buffer.from(await file.arrayBuffer());
                                    const fileNameInt = bytesToBigInt(
                                        Buffer.from(filePath, "utf-8")
                                    );
                                    await sendMessage(ip, port, fileData, fileNameInt);
                                }
                            } else {
                                let messageToSend = message;

                                if (config.encryption) {
                                    const pairs: string[] = [];
                                    for (let i = 0; i < message.length; i += 2) {
                                        pairs.push(
                                            message.substring(i, i + 2).split("").reverse().join("")
                                        );
                                    }
                                    messageToSend = pairs.join(" ");
                                }

                                await sendMessage(ip, port, Buffer.from(messageToSend, "utf-8"));
                            }
                        } catch (err) {
                            console.error(err);
                            rl.close();
                            sockKeepAlive.close();
                            resolve();
                            return;
                        }

                        sendKeepAlive();
                        timer = setInterval(sendKeepAlive, 1000);

                        if (aliveConnection) {
                            done();
                            await promptMessage();
                        } else {
                            rl.close();
                            sockKeepAlive.close();
                            resolve();
                        }
                    });
                });
            };

            await promptMessage();
        }, 3000);
    });
}

// ---------------------------------------------------------------------------
// User-input loop (outer: connect to remote, change settings)
// ---------------------------------------------------------------------------

async function userInput(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const promptSocket = async (): Promise<void> => {
        return new Promise<void>((done) => {
            rl.question("enter ip and port number:\n", async (input) => {
                if (input.startsWith(">")) {
                    if (input.startsWith(">payload_size ")) {
                        const v = parseInt(input.split(" ")[1]!);
                        if (!isNaN(v)) {
                            payloadSize = v;
                            console.log(`Payload size set to ${payloadSize}`);
                        } else {
                            console.log("invalid input");
                        }
                    } else if (input.startsWith(">window_size ")) {
                        const v = parseInt(input.split(" ")[1]!);
                        if (!isNaN(v)) {
                            windowSize = v;
                            console.log(`Window size set to ${windowSize}`);
                        } else {
                            console.log("invalid input");
                        }
                    } else if (input.startsWith(">storing_directory ")) {
                        storingDirectory = input.split(" ")[1]!;
                        console.log(`Storing directory set to ${storingDirectory}`);
                    } else {
                        console.log("invalid command");
                    }
                    done();
                    await promptSocket();
                } else {
                    const parts = input.split(" ");
                    if (parts.length !== 2) {
                        console.log("invalid input");
                        done();
                        await promptSocket();
                        return;
                    }

                    const [ip, portStr] = parts as [string, string];
                    try {
                        await session(ip, parseInt(portStr));
                    } catch (err) {
                        console.error(err);
                    }
                    done();
                    await promptSocket();
                }
            });
        });
    };

    await promptSocket();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

sock.bind(config.port, config.ip, () => {
    console.log(`SNSS Server listening on ${config.ip}:${config.port}`);
    console.log("Debug mode:", config.debug);
    console.log("Broken mode:", config.broken);
    console.log("Encryption:", config.encryption);
    console.log("\nCommands:");
    console.log("  >payload_size <n>          - Set payload size");
    console.log("  >window_size <n>           - Set window size");
    console.log("  >storing_directory <path>  - Set file storage directory");
    console.log("  \\<filename>               - Send file (in session)");
    console.log("  >exit                      - Exit session");

    listen();
    userInput();
});

sock.on("error", (err) => {
    console.error("Socket error:", err);
    sock.close();
});

process.on("SIGINT", () => {
    console.log("\nShutting down server...");
    sock.close();
    process.exit(0);
});
