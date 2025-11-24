# SNSS Protocol - Usage Examples

This document provides practical examples for using the JavaScript implementation of the SNSS protocol.

## Quick Start

### 1. Running the Test Suite

First, verify everything works by running the test suite:

```bash
node test-client.js
```

You should see:
```
=== SNSS Protocol Test Suite ===
...
=== All Tests Passed ===
```

### 2. Basic Two-Server Communication

**Terminal 1 (Server A):**
```bash
node server.js -p 3141
```

**Terminal 2 (Server B):**
```bash
node server.js -p 3142
```

In Terminal 2, establish a session with Server A:
```
enter ip and port number:
127.0.0.1 3141
```

After the connection is established, you can send messages:
```
enter message:
Hello from Server B!
```

Server A (Terminal 1) will display:
```
127.0.0.1:3142 | 6 > Hello from Server B!
```

### 3. Sending Messages Back and Forth

Once a session is established in one direction, you can establish the reverse connection.

**In Terminal 1 (Server A):**
```
enter ip and port number:
127.0.0.1 3142

enter message:
Hello back from Server A!
```

Now both servers can send messages to each other simultaneously!

### 4. File Transfer

Create a test file:
```bash
echo "This is a test file content" > testfile.txt
```

In a session, send the file:
```
enter message:
\testfile.txt
```

The receiving server will save the file in its storage directory (current directory by default).

### 5. Configuration Examples

**Set custom window size and payload size:**

```bash
node server.js -p 3141
```

Then before establishing a session:
```
enter ip and port number:
>window_size 10
Window size set to 10

enter ip and port number:
>payload_size 512
Payload size set to 512

enter ip and port number:
127.0.0.1 3142
```

**Set custom storage directory for received files:**
```
enter ip and port number:
>storing_directory /tmp/snss-files/
Storing directory set to /tmp/snss-files/
```

### 6. Debug Mode

Enable debug mode to see detailed protocol operations:

```bash
node server.js -p 3141 -d true
```

You'll see output like:
```
received [ 2, 1, 1024 ]  # REQ_M with window=1, payload=1024
received [ 4, 0 ]        # APR with seq=0
received [ 0, 0, 2309... ] # DATA with seq=0
```

### 7. Testing Error Handling (Broken Mode)

Simulate network errors with broken mode:

**Terminal 1:**
```bash
node server.js -p 3141 -b true -d true
```

**Terminal 2:**
```bash
node server.js -p 3142 -b true -d true
```

Messages will be randomly corrupted or dropped, and you'll see the protocol's error recovery:
```
broking message 0
dropping message 1024
received [ 5, 0 ]  # NACK requesting retransmission
```

### 8. Encryption Mode

Enable simple character-pair encryption:

```bash
node server.js -p 3141 -e true
```

Messages will be encrypted by reversing character pairs:
- Input: `"Hello"` 
- Encrypted: `"eH ll o"`

### 9. Complete Example Workflow

**Setup:**
```bash
# Terminal 1
node server.js -p 5000 -d true

# Terminal 2  
node server.js -p 5001 -d true
```

**In Terminal 1:**
```
# Configure
>payload_size 256
>window_size 5

# Connect
127.0.0.1 5001

# Send message
Hello, this is a test!

# Send file
\README-JS.md

# Exit session
>exit
```

**In Terminal 2:**
```
# You'll see received messages:
127.0.0.1:5000 | 7 > Hello, this is a test!
file README-JS.md received

# Connect back
127.0.0.1 5000

# Reply
Thanks, message received!
>exit
```

## Testing with Python Server

The JavaScript implementation is fully compatible with the Python version:

**Terminal 1 (Python):**
```bash
python main.py -p 3141
```

**Terminal 2 (JavaScript):**
```bash
node server.js -p 3142
```

Then establish connection from either side - they should communicate seamlessly!

## Advanced Usage

### Programmatic Usage

You can also use the protocol programmatically:

```javascript
const dgram = require('dgram');
const { Type, createMessage, openMessage } = require('./message');

// Create a socket
const sock = dgram.createSocket('udp4');

// Send a KEEP_A message
const keepAlive = createMessage(Type.KEEP_A);
sock.send(keepAlive, 3141, '127.0.0.1', (err) => {
    if (err) console.error(err);
    else console.log('Keep-alive sent!');
});

// Receive and parse messages
sock.on('message', (msg, rinfo) => {
    try {
        const fields = openMessage(msg);
        console.log('Received:', fields);
    } catch (err) {
        console.error('Invalid message:', err.message);
    }
});

sock.bind(3142);
```

### Custom Message Types

```javascript
const { Type, createMessage } = require('./message');

// Create APR (acknowledgment)
const ack = createMessage(Type.APR, 1024);

// Create NACK (negative acknowledgment)  
const nack = createMessage(Type.NACK, 512);

// Create DATA message
const data = Buffer.from('Hello!', 'utf-8');
const dataBigInt = BigInt('0x' + data.toString('hex'));
const dataMsg = createMessage(Type.DATA, 0, dataBigInt);
```

## Troubleshooting Examples

### Issue: Connection Timeout

**Symptoms:**
```
exception on keep-alive connection: timeout
Failed to establish connection
```

**Solutions:**
1. Check the remote server is running
2. Verify IP address and port are correct
3. Check firewall settings
4. Try using `127.0.0.1` instead of `localhost`

### Issue: Checksum Errors

**Symptoms:**
```
receiving error Error: Invalid checksum
```

**Solutions:**
1. May indicate actual network corruption
2. Enable debug mode to see details: `-d true`
3. Use broken mode to test error recovery: `-b true`

### Issue: File Not Found

**Symptoms:**
```
file not found
```

**Solutions:**
1. Use absolute path: `\/absolute/path/to/file.txt`
2. Or place file in same directory as server
3. Check file permissions

## Performance Tips

1. **Adjust Window Size**: Larger window = faster transfer but more retransmissions on error
   ```
   >window_size 10
   ```

2. **Optimize Payload Size**: Smaller payload = less data lost per packet error
   ```
   >payload_size 512
   ```

3. **Network Quality**: Use broken mode to test in poor network conditions
   ```bash
   node server.js -b true
   ```

## Session Management

**Exit a session:**
```
>exit
```

**Start new session after exit:**
```
127.0.0.1 3142
```

**Multiple sequential sessions:**
```
# Session 1
127.0.0.1 3141
Hello!
>exit

# Session 2  
127.0.0.1 3142
Hi there!
>exit
```

## Best Practices

1. **Always use debug mode during development**
   ```bash
   node server.js -d true
   ```

2. **Test with broken mode before production**
   ```bash
   node server.js -b true
   ```

3. **Configure window and payload sizes based on network conditions**
   - Fast, reliable network: Large window (10-20), large payload (1024-1472)
   - Slow, unreliable network: Small window (1-3), small payload (256-512)

4. **Use absolute paths for file transfers**
   ```
   \/home/user/documents/file.pdf
   ```

5. **Monitor debug output for performance tuning**

## Command Reference

**Before session (configuration):**
- `>window_size <number>` - Set transfer window size
- `>payload_size <number>` - Set chunk size in bytes  
- `>storing_directory <path>` - Set where to save received files

**During session:**
- `<text>` - Send text message
- `\<filepath>` - Send file
- `>exit` - Close session

**Command line options:**
- `-p, --port` - Port number
- `-a, --ip` - IP address
- `-d, --debug` - Debug mode (true/false)
- `-b, --broken` - Simulate errors (true/false)
- `-e, --encryption` - Enable encryption (true/false)
