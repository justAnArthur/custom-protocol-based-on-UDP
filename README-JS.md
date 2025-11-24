# SNSS Protocol - JavaScript/Node.js Implementation

This is a JavaScript/Node.js implementation of the **Sync 'n' Send Spectacle (SNSS)** protocol, maintaining full compatibility with the original Python implementation.

## Overview

SNSS is a custom protocol built on UDP that provides reliable message and file transfer with:
- Custom ARQ (Automatic Repeat Request) method with windowing
- Checksum-based error detection
- Support for message and file transfers
- Keep-alive mechanism for connection management
- Configurable window size and payload size

## Requirements

- Node.js >= 14.0.0
- No external dependencies (uses only Node.js built-in modules)

## Installation

No installation required - just Node.js!

```bash
# Make scripts executable (optional)
chmod +x server.js test-client.js
```

## Usage

### Starting the Server

```bash
node server.js [options]

Options:
  -p, --port <number>        Port to listen on (default: 3141)
  -a, --ip <address>         IP address to bind (default: localhost)
  -d, --debug <true|false>   Enable debug mode (default: false)
  -b, --broken <true|false>  Enable random message corruption/dropping (default: false)
  -e, --encryption <true|false> Enable simple encryption (default: false)
  -h, --help                 Show help message
```

### Examples

**Start a basic server:**
```bash
node server.js -p 3141
```

**Start server with debug mode:**
```bash
node server.js -p 3141 -d true
```

**Start server with simulated network errors:**
```bash
node server.js -p 3142 -b true -d true
```

### Testing the Protocol

Run the test suite:
```bash
node test-client.js
```

This will run a comprehensive test suite that validates:
- Message type definitions
- Checksum calculations
- All message types (KEEP_A, APR, NACK, DATA, REQ_M, REQ)
- Message corruption detection
- Message chunking and reconstruction

### Running Two Servers for Communication

**Terminal 1:**
```bash
node server.js -p 3141
```

**Terminal 2:**
```bash
node server.js -p 3142
```

Then in Terminal 2, enter:
```
127.0.0.1 3141
```

Now you can send messages between the two servers!

## Application States

The application has two states:

### 1. Opened State
- Ready to accept incoming messages
- Can configure settings with commands:
  - `>window_size <number>` - Set window size
  - `>payload_size <number>` - Set payload size  
  - `>storing_directory <path>` - Set file storage directory

### 2. In Session State
- Active connection with another endpoint
- Send messages by typing text
- Send files with `\<filename>` (file must exist)
- Exit session with `>exit`

## Protocol Features

### Message Types

| Type   | Binary | Description                |
|--------|--------|----------------------------|
| REQ    | 011    | File transfer request      |
| REQ_M  | 010    | Message transfer request   |
| APR    | 100    | Acknowledgment            |
| NACK   | 101    | Negative acknowledgment   |
| DATA   | 000    | Data chunk                |
| KEEP_A | 110    | Keep-alive packet         |

### Header Structures

**REQ (File Request):**
```
| Type | Checksum | Window | Payload | Filename |
| 3b   | 18b      | 8b     | 11b     | variable |
```

**REQ_M (Message Request):**
```
| Type | Checksum | Window | Payload |
| 3b   | 18b      | 8b     | 11b     |
```

**DATA:**
```
| Type | Checksum | SeqNum | Data     |
| 3b   | 21b      | 32b    | variable |
```

**APR/NACK:**
```
| Type | Checksum | SeqNum |
| 3b   | 21b      | 32b    |
```

**KEEP_A:**
```
| Type | Checksum |
| 3b   | 21b      |
```

## File Structure

- **`message.js`** - Core protocol message handling
  - Message packing/unpacking
  - Checksum calculation and validation
  - Type definitions and masks

- **`server.js`** - Main server implementation
  - UDP socket management
  - Message/file sending and receiving
  - Session management with keep-alive
  - User input handling

- **`test-client.js`** - Test suite
  - Unit tests for all message types
  - Protocol functionality demonstration
  - Usage examples

## API Reference

### message.js

```javascript
const { Type, createMessage, openMessage, computeChecksum } = require('./message');

// Create a message
const msg = createMessage(Type.APR, seqNumber);

// Parse and validate a message
const fields = openMessage(msgBuffer);

// Calculate checksum
const checksum = computeChecksum(21, type, field1, field2);
```

### Key Functions

**`createMessage(type, ...fields)`**
- Creates a message with proper checksum
- Returns: Buffer

**`openMessage(messageBuffer)`**
- Parses and validates message
- Throws error if checksum invalid
- Returns: Array of fields

**`computeChecksum(bitsLength, ...data)`**
- Computes Internet Checksum
- Returns: Number

## Error Handling

The protocol includes robust error handling:

1. **Checksum Validation** - All messages are validated
2. **NACK System** - Requests retransmission of corrupted/lost packets
3. **Timeout Handling** - Automatic retries with exponential backoff
4. **Sequence Number Tracking** - Detects missing packets

## Protocol Flow

### Message Exchange
```
Client                          Server
  |                               |
  |------- REQ_M (request) ------>|
  |<------ APR (approved) --------|
  |                               |
  |------- DATA (chunk 1) ------->|
  |------- DATA (chunk 2) ------->|
  |------- DATA (chunk N) ------->|
  |<------ APR (ack window) ------|
  |                               |
  (repeat for all windows)
  |                               |
  |<------ APR (complete) --------|
```

### Keep-Alive
```
Client                          Server
  |                               |
  |------ KEEP_A (ping) --------->|
  |<----- KEEP_A (pong) ----------|
  |                               |
  (every 1 second while in session)
```

## Compatibility

This JavaScript implementation is **fully compatible** with the Python version:
- Same message structure and binary format
- Same protocol behavior and semantics
- Can communicate with Python clients/servers
- Identical checksum algorithm

## Testing

The test suite validates:
- ✓ Message type definitions
- ✓ Checksum calculations
- ✓ All message types (KEEP_A, APR, NACK, DATA, REQ_M, REQ)
- ✓ Message corruption detection
- ✓ Message splitting and reconstruction
- ✓ File transfer simulation

Run tests with:
```bash
node test-client.js
```

## Differences from Python Version

While maintaining full protocol compatibility, the JavaScript implementation has some structural differences:

1. **Async/Await** - Uses modern async patterns instead of threading
2. **Event-driven** - Leverages Node.js event loop for concurrency
3. **Buffer API** - Uses Node.js Buffer instead of Python bytes
4. **BigInt** - Uses native BigInt for large numbers
5. **dgram Module** - Uses Node.js built-in UDP socket support

## Troubleshooting

**Connection timeout:**
- Check firewall settings
- Verify IP and port are correct
- Ensure both endpoints are running

**Checksum errors:**
- May indicate network issues
- Enable debug mode: `-d true`
- Try broken mode to test error handling: `-b true`

**File not found:**
- File must exist in the same directory (or use absolute path)
- Check file permissions

## Future Enhancements

Potential improvements:
- Add encryption support (AES)
- Implement congestion control
- Add support for multiple simultaneous transfers
- Create web-based UI
- Add statistics and monitoring

## License

Same as the original Python implementation (ISC).

## Credits

JavaScript port of the SNSS protocol, originally implemented in Python by justAnArthur.
