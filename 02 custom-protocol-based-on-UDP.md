- [ ] 📅 2023-12-04
- [ ] 📅 2023-11-19 navbar

--- 

- [ ] Handling data lost
- [ ] Handling error detection
- [ ] Change fragment size from receiver
    - Max fragment size to not be fragmented on Data-Link layer
- [ ] Communication is closed only by hand
- [ ] Debugging
    - Fragmented with SEQ number
    - If errored
    - On success tell where

## Header Structure

_1472 bytes (1500–8 bytes for UDP header and 20 bytes for IPv4 header)_.

The header structure itself will not be absolute and will be modified with respect to the type of segment being
forwarded. Because of the logic of this protocol, it will not affect in any area if a packet arrives with a different
type.

| REQ (0x011) | Checksum | Window size | Payload size | Filename |
|-------------|----------|-------------|--------------|----------|
| 3 bits      | 18 bits  | 8 bits      | 11 bits      | ...      |

- Sender sends when it wants to send a file.

---

| REQ_M (0x010) | Checksum | Window size | Payload size | 
|---------------|----------|-------------|--------------|
| 3 bits        | 18 bits  | 8 bits      | 11 bits      |

- Sender sends when it wants to send message.

---

| Data (0x000) | Checksum | SEQ Number | Data |
|--------------|----------|------------|------|
| 3 bits       | 21 bits  | 32 bits    | ...  |

- Chunk of message (file)

---

| APR (0x100) | Checksum | SEQ Number | 
|-------------|----------|------------|
| 3 bits      | 21 bits  | 32 bits    |

- Acknowledge the received window.
- And as sender understands which window to send next.

---

| NACK (0x101) | Checksum | SEQ Number | 
|--------------|----------|------------|
| 3 bits       | 21 bits  | 32 bits    | 

- Negative acknowledge the received packet.

---

| KEEP-A (0x110) |  
|----------------|
| 3 bits         | 

- If one endpoint sends it to another - another must answer with the same packet to confirm that another endpoint is
  alive and ready for sending the packet.

---

- **SEQ Number**
    - Used to mark segment with unique identification.
    - _32 bits -> 2^32 = 4,294,967,296 segments to send_.
      _1472 - (21+32+3) = 1465_.
      _4,294,967,296 * 1465 ~ **6.25 GB is maximum**_.
- **Checksum**
    - Checksum field used to avoid any bit errors.
    - _Will be used "Internet
      Checksum":
      [Calculating the Checksum,
      with a taste](https://www.securitynik.com/2015/08/calculating-udp-checksum-with-taste-of_3.html)_.
    - ```python
      def compute_checksum(bits_length, *data):
      checksum = sum(data)

      while checksum.bit_length() > bits_length:
        # Split the checksum into two halves
        mask = (1 << (checksum.bit_length() // 2)) - 1
        low_bits = checksum & mask
        high_bits = checksum >> (checksum.bit_length() // 2)

        checksum = low_bits + high_bits

      return checksum
      ```

## ARQ Method

In the pursuit of optimizing the sending of the file, I have chosen the idea of using a negative acknowledgement
number and acknowledge a specific group of packets.

**Acknowledging a specific group of packets** implies that after the sender transmits a window size of packets, it
awaits a positive acknowledgment (ACK) from the receiver confirming the successful reception of that particular batch or
group of packets before proceeding with further transmissions.

While receiving packets, the **receiver has the capability to flag certain packets as erroneous**, requesting their
retransmission, all the while concurrently continuing to receive subsequent packets in parallel.

## The user journey

This sequence diagram shows the user's journey of sending a message from Alice to Bob.
Where boxes are like computer poll with ports and participants are the ports.

```mermaid
sequenceDiagram
    box Alice
        participant M1 as 77
        participant R11 as 65001
        participant R12 as 65002
    end
    box Bob
        participant M2 as 88
        participant R21 as 64001
    end

    rect rgb(8, 159, 143)
        note right of M1: Alice opens session by typing port.

        loop every second
            R11 ->> M2: KEEP-A
            M2 ->> R11: KEEP-A
        end

        rect rgb(0, 137, 138)
            note right of M1: Alice enters the message.
            R12 ->> M2: REQ_M
            R21 ->> R12: APR

            loop while not send all bytes
                loop window size
                    R12 ->> R21: Data

                    opt dropped packet or checksum error
                        R21 ->> R12: NACK
                    end
                end
                R21 ->> R12: APR
            end

        end

        loop every second
            R11 ->> M2: KEEP-A
            M2 ->> R11: KEEP-A
        end

    end
```

## Code

### Libraries

The program implementation will be written in `Python 3.10.11`.
And will use the following libraries_, maybe some will be added during development, but they are the
main ones_:

- `socket`
- `sys`
- `threading`

The program would leverage threading to its fullest extent, aiming to achieve full-duplex communication capabilities.

### Example

```python
def listen(ip, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


sock.bind((ip, int(port)))

while True:
    data, addr = sock.recvfrom(1472)
print(f"Received message: {data.decode()} from {addr}")


def request(ip, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


print('sending request')


def send():
    sock.sendto("request".encode(), (ip, int(port)))


threading.Timer(5.0, send).start()

send()

while True:
    data, addr = sock.recvfrom(1472)
print(f"Received message: {data.decode()} from {addr}")


def wait_for_input():
    while True:
        user_input = input("enter port and message:\n").split(' ')


request('localhost', user_input[0])

# Start a thread that waits for user input
input_thread = threading.Thread(target=wait_for_input)
input_thread.start()

# Start another thread that waits for UDP packets
recv_thread = threading.Thread(target=listen, args=(ip, port))
recv_thread.start()
```

## linked W

- [Learning by practicing: Calculating the TCP Checksum, with a taste of scapy + Wireshark (security.com)](https://www.securitynik.com/2015/08/calculating-udp-checksum-with-taste-of_3.html)
- [Python, how to read bytes from a file and save it? — Stack Overflow](https://stackoverflow.com/questions/6787233/python-how-to-read-bytes-from-file-and-save-it)

