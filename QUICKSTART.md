# SNSS Protocol - Quick Start Guide

Get up and running with the JavaScript SNSS protocol in 2 minutes!

## Prerequisites

- Node.js 14.0 or higher
- No installation needed - zero dependencies!

## Quick Start (3 Steps)

### Step 1: Run the Test Suite

Verify everything works:

```bash
node test-client.js
```

Expected output:
```
=== SNSS Protocol Test Suite ===
...
=== All Tests Passed ===
```

### Step 2: Start Server A

Open **Terminal 1**:

```bash
node server.js -p 3141
```

You should see:
```
SNSS Server listening on localhost:3141
```

### Step 3: Start Server B and Connect

Open **Terminal 2**:

```bash
node server.js -p 3142
```

Then type:
```
127.0.0.1 3141
```

Wait 3 seconds for connection...

Now type a message:
```
Hello from Server B!
```

**Terminal 1** will display:
```
127.0.0.1:3142 | 6 > Hello from Server B!
```

🎉 **Success!** You're now running the SNSS protocol!

## Next Steps

### Send Messages Back

In **Terminal 1**, establish the reverse connection:
```
127.0.0.1 3142
Hello back from Server A!
```

### Send a File

Create a test file:
```bash
echo "Test file content" > test.txt
```

In a session, send it:
```
\test.txt
```

### Configure for Better Performance

Before connecting, set larger transfer parameters:
```
>payload_size 1024
>window_size 10
127.0.0.1 3142
```

### Enable Debug Mode

See what's happening under the hood:
```bash
node server.js -p 3141 -d true
```

### Test Error Handling

Simulate network problems:
```bash
node server.js -p 3141 -b true -d true
```

## Common Commands

**Configuration (before session):**
- `>window_size 10` - Set window size
- `>payload_size 1024` - Set payload size
- `>storing_directory ./files/` - Set file storage location

**In Session:**
- `Hello!` - Send text message
- `\filename.txt` - Send file
- `>exit` - Close session

**Command Line:**
- `-p 3141` - Port number
- `-a localhost` - IP address
- `-d true` - Debug mode
- `-b true` - Broken mode (simulate errors)
- `-h` - Help

## File Structure

```
.
├── message.js              # Protocol implementation
├── server.js               # Main server
├── test-client.js          # Test suite
├── package.json            # Node.js config
├── README-JS.md            # Full documentation
├── USAGE-EXAMPLES.md       # Detailed examples
├── IMPLEMENTATION-NOTES.md # Technical details
└── QUICKSTART.md           # This file
```

## Troubleshooting

**Problem:** `Error: listen EADDRINUSE`  
**Solution:** Port already in use, try different port: `-p 3143`

**Problem:** Connection timeout  
**Solution:** Check IP address, try `127.0.0.1` instead of `localhost`

**Problem:** File not found  
**Solution:** Use absolute path: `\/full/path/to/file.txt`

## Learn More

- **Full Documentation:** [README-JS.md](README-JS.md)
- **Usage Examples:** [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)
- **Technical Details:** [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md)
- **Original Spec:** [README.md](README.md)

## Pro Tips

1. **Start with debug mode** to understand protocol flow:
   ```bash
   node server.js -d true
   ```

2. **Test with broken mode** to see error recovery:
   ```bash
   node server.js -b true -d true
   ```

3. **Adjust window/payload** for your network:
   - Fast network: `>window_size 20` and `>payload_size 1472`
   - Slow network: `>window_size 3` and `>payload_size 256`

4. **Use npm scripts** for convenience:
   ```bash
   npm start      # Start server
   npm test       # Run tests
   ```

## That's It!

You now know how to:
- ✅ Run the test suite
- ✅ Start a server
- ✅ Connect two servers
- ✅ Send messages
- ✅ Send files
- ✅ Configure settings

Happy messaging! 🚀

---

**Need help?** Check [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md) for more examples.
