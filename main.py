import argparse
import random
import socket
import threading
import time

from message import *

parser = argparse.ArgumentParser()
parser.add_argument('-p', '--port', type=int, default=3141, help='Select the port to listen on')
parser.add_argument('-d', '--debug', type=bool, default=False, help='True/False to enable/disable debug mode')
args = parser.parse_args()

ip = 'localhost'
port = args.port
window_size = 1
payload_size = 1

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((ip, int(port)))


def receive_message(fields, ip, port):
    sock_message = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_message.settimeout(3.0)

    _window_size = fields[1]
    _payload_size = fields[2]
    seq_number = 0
    index = 0

    message_chunk_bytes = {}

    print(f'requested window size: {_window_size}')

    sock_message.sendto(create_message(*[Type.APR.value, seq_number]), (ip, int(port)))

    seq_number_negatives = []

    def send_negative(seq_number):
        nonlocal seq_number_negatives
        if seq_number in seq_number_negatives:
            sock_message.sendto(create_message(*[Type.NACK.value, seq_number]), (ip, int(port)))
            time.sleep(1.0)
            send_negative(seq_number)

    def send_ack(seq_number):
        print('sending ack', seq_number)
        # if random.randint(0, 6) < 2:
        #     print('changed data')
        #
        #     message = create_message(*[Type.APR.value, seq_number])
        #
        #     message = corrupt_message(message)
        #
        #     if random.randint(0, 6) > 2:
        #         sock_message.sendto(message, (ip, int(port)))
        #
        #     return
        sock_message.sendto(create_message(*[Type.APR.value, seq_number]), (ip, int(port)))

    received = False

    while True:
        if received is not False and seq_number_negatives == []:
            send_ack(received)
            break

        try:
            data, addr = sock_message.recvfrom(1472)

            fields = open_message(data)
        except TimeoutError or socket.error:
            print('connection timed out')
            break
        except BaseException as e:
            print('receiving error', e)
            continue

        if fields[0] == Type.DATA.value:
            chunk = fields[2].to_bytes((fields[2].bit_length() + 7) // 8, 'big')

            if fields[1] != seq_number:
                if fields[1] not in seq_number_negatives:
                    for seq_number in range(seq_number, fields[1], _payload_size):
                        seq_number_negatives.append(seq_number)
                        threading.Timer(1.0, send_negative, args=(seq_number,)).start()
                else:
                    seq_number_negatives.remove(fields[1])

            message_chunk_bytes[fields[1]] = chunk

            print('received chunk', fields[1], len(chunk), _payload_size, index, _window_size)

            if fields[1] not in seq_number_negatives:
                seq_number = fields[1] + _payload_size
                index += 1
            else:
                continue

            if len(chunk) < _payload_size:
                received = fields[1] + _payload_size
            elif index == _window_size:
                index = 0
                send_ack(fields[1] + _payload_size)

    print(''.join([message_chunk_bytes[key].decode('utf-8', 'ignore') for key in sorted(message_chunk_bytes.keys())]))


def listen(ip, port):
    while True:
        try:
            data, addr = sock.recvfrom(1472)

            fields = open_message(data)
        except BaseException:
            continue

        print(f"received message: {fields[0]} from {addr}")

        match fields[0]:
            case Type.REQ_M.value:
                receive_message(fields, *addr)
            case Type.KEEP_A.value:
                sock.sendto(create_message(*[Type.KEEP_A.value]), addr)


def send_message(ip, port, message):
    sock_message = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_message.settimeout(1.0)

    message_bytes = message.encode('utf-8')
    message_chunks = {i: message_bytes[i: i + payload_size] for i in range(0, len(message_bytes), payload_size)}

    is_message_with_remainder = len(message_bytes) % payload_size != 0
    if not is_message_with_remainder:
        message_chunks[len(message_bytes)] = b''

    print(message_chunks)

    approved = False
    index = 0

    for _ in range(0, 3):
        sock_message.sendto(create_message(*[Type.REQ_M.value, window_size, payload_size]), (ip, int(port)))

        try:
            data, addr = sock_message.recvfrom(1472)
            fields = open_message(data)
            ip, port = addr
            index = fields[1]
        except BaseException as e:
            print('receiving error', e)
            continue

        fields = open_message(data)

        if fields[0] == Type.APR.value:
            approved = True
            break

    if not approved:
        print('connection timed out')
        raise ConnectionError

    def send_chunk(seq_number):
        sock_message.sendto(
            create_message(*[Type.DATA.value, seq_number, int.from_bytes(message_chunks[seq_number], 'big')]),
            (ip, int(port)))

    listen_on_negative = threading.Event()

    def handle_negative(listen):
        while not listen.is_set():
            print('listening on negative', listen.is_set())
            try:
                data, addr = sock_message.recvfrom(1472)

                fields = open_message(data)

                print('received negative', data)
            except BaseException as e:
                print('receiving error', e)
                continue

            if fields[0] == Type.NACK.value:
                send_chunk(fields[1])

    sending = True

    while sending:
        # listen_on_negative.clear()
        # thread = threading.Thread(target=handle_negative, args=(listen_on_negative,))
        # thread.start()

        for seq_number, data in {key: message_chunks[key] for key in
                                 [index + i * payload_size for i in range(window_size)] if
                                 key in message_chunks}.items():
            # if random.randint(0, 6) < 2:
            #     print('changed data')
            #
            #     message = create_message(
            #         *[Type.DATA.value, seq_number, int.from_bytes(message_chunks[seq_number], 'big')])
            #
            #     message = corrupt_message(message)
            #
            #     if random.randint(0, 6) > 2:
            #         sock_message.sendto(message, (ip, int(port)))
            #
            #     continue

            send_chunk(seq_number)

        # listen_on_negative.set()
        #
        print('sent window')

        while True:
            print('listen on ack')
            try:
                data, addr = sock_message.recvfrom(1472)

                fields = open_message(data)

                print('received', fields[0], fields[1])

                if fields[0] == Type.NACK.value:
                    send_chunk(fields[1])
                elif fields[0] == Type.APR.value:

                    print('if send successfully', fields[1], is_message_with_remainder, payload_size, message_chunks,
                          message_chunks.keys())

                    if max(message_chunks.keys()) + payload_size == fields[1]:
                        sending = False
                        print('sent successfully')
                        sock_message.close()
                    elif fields[1] in message_chunks.keys():
                        index = fields[1]

                    break
            except BaseException as e:
                print('receiving error', 'hello', e)
                break


def session(ip, port):
    alive_connection = False
    sock_keep_alive = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_keep_alive.settimeout(3.0)

    timer = None

    def send_keep_alive():
        nonlocal timer, alive_connection
        print('sending keep alive', ip, port)
        sock_keep_alive.sendto(create_message(*[Type.KEEP_A.value]), (ip, port))

        try:
            data, addr = sock_keep_alive.recvfrom(1472)
        except BaseException as e:
            print('connection ', e)
            alive_connection = False
        else:
            alive_connection = True
            timer = threading.Timer(1.0, send_keep_alive)
            timer.start()

    send_keep_alive()

    while alive_connection:
        try:
            message = input('enter message:\n')
        except BaseException:
            timer.cancel()
            break

        timer.cancel()

        if message == '>exit':
            break

        try:
            send_message(ip, port, message)
        except ConnectionError:
            break

        send_keep_alive()

    sock_keep_alive.close()


def user_input():
    while True:
        try:
            _socket = input('enter port number:\n')

            if _socket.startswith('>payload_size '):
                try:
                    global payload_size
                    payload_size = int(_socket.split(' ')[1])
                except ValueError:
                    print('invalid input')
                continue
            elif _socket.startswith('>window_size '):
                try:
                    global window_size
                    window_size = int(port.split(' ')[1])
                except ValueError:
                    print('invalid input')
                continue
            else:
                _ip, _port = _socket.split(' ')
                ip = _ip
                port = int(_port)

        except BaseException as e:
            sock.close()
            print(e)
            exit()
        except ValueError:
            print('invalid input')
            continue

        session(ip, port)


input_thread = threading.Thread(target=user_input)
input_thread.daemon = True

# Start another thread that waits for UDP packets
recv_thread = threading.Thread(target=listen, args=(ip, port))
recv_thread.daemon = True

try:
    input_thread.start()
    recv_thread.start()
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    sock.close()
    exit()
except BaseException as e:
    print(e)
    exit(0)
