import argparse
import random
import socket
import threading
import time

from message import *

parser = argparse.ArgumentParser()
parser.add_argument('-p', '--port', type=int, default=3141, help='Select the port to listen on')
parser.add_argument('-a', '--ip', type=str, default='localhost', help='Select the ip to listen on')
parser.add_argument('-d', '--debug', type=bool, default=False, help='True/False to enable/disable debug mode')
parser.add_argument('-b', '--broken', type=bool, default=False,
                    help='True/False to enable/disable randomly corrupting and dropping messages')
args = parser.parse_args()

ip = args.ip
port = args.port
window_size = 1
payload_size = 1

storing_directory = '.\\'

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((ip, int(port)))


def receive_message(fields, ip, port):
    sock_message = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_message.settimeout(3.0)

    is_file = fields[0] == Type.REQ.value
    fileName = None
    if is_file:
        fileName = fields[3].to_bytes((fields[3].bit_length() + 7) // 8, 'big').decode('utf-8', 'ignore')

    _window_size = fields[1]
    _payload_size = fields[2]
    seq_number = 0
    index = 0

    message_chunk_bytes = {}

    sock_message.sendto(create_message(*[Type.APR.value, seq_number]), (ip, int(port)))

    seq_number_negatives = []

    def send_negative(seq_number):
        nonlocal seq_number_negatives
        if seq_number in seq_number_negatives:
            sock_message.sendto(create_message(*[Type.NACK.value, seq_number]), (ip, int(port)))
            time.sleep(1.0)
            send_negative(seq_number)

    def send_ack(seq_number):
        message = create_message(*[Type.APR.value, seq_number])

        if args.broken and random.randint(0, 10) < 2:
            if args.debug:
                print('broking message', seq_number)
            message = corrupt_message(message)
        elif args.broken and random.randint(0, 10) < 2:
            if args.debug:
                print('dropping message', seq_number)
            return

        sock_message.sendto(message, (ip, int(port)))

    received = False

    timeout_index = 0

    while True:
        if timeout_index > 2:
            break

        if received is not False and seq_number_negatives == []:
            send_ack(received)
            break

        try:
            data, addr = sock_message.recvfrom(1472)

            fields = open_message(data)

            timeout_index = 0
        except TimeoutError:
            timeout_index += 1
            continue
        except ValueError:
            seq_number_negatives.append(seq_number)
            threading.Timer(0.1, send_negative, args=(seq_number,)).start()
            continue
        except BaseException as e:
            print('receiving error', e)
            break

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

            if fields[1] == seq_number and fields[1] in seq_number_negatives:
                seq_number_negatives.remove(fields[1])

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

    if received:
        if is_file:
            with open(storing_directory + fileName, 'wb') as file:
                for key in sorted(message_chunk_bytes.keys()):
                    file.write(message_chunk_bytes[key])

            print(f'file {fileName} received')
        else:
            print(ip, ':', port, '>',
                  ''.join(
                      [message_chunk_bytes[key].decode('utf-8', 'ignore') for key in
                       sorted(message_chunk_bytes.keys())]))


def listen(ip, port):
    while True:
        try:
            data, addr = sock.recvfrom(1472)

            fields = open_message(data)
        except BaseException as e:
            print('receiving error', e)
            continue

        if args.debug:
            print('received', fields)

        match fields[0]:
            case Type.REQ.value:
                receive_message(fields, *addr)
            case Type.REQ_M.value:
                receive_message(fields, *addr)
            case Type.KEEP_A.value:
                sock.sendto(create_message(*[Type.KEEP_A.value]), addr)


def send_message(ip, port, message_bytes, file=None):
    sock_message = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_message.settimeout(3.0)

    message_chunks = {i: message_bytes[i: i + payload_size] for i in range(0, len(message_bytes), payload_size)}

    is_message_with_remainder = len(message_bytes) % payload_size != 0
    if not is_message_with_remainder:
        message_chunks[len(message_bytes)] = b''

    approved = False
    index = 0

    for _ in range(0, 3):
        req_arguments = [Type.REQ_M.value, window_size, payload_size]

        if file is not None:
            req_arguments[0] = Type.REQ.value
            req_arguments.append(file)

        sock_message.sendto(create_message(*req_arguments), (ip, int(port)))

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

    sending = True

    while sending:
        for seq_number, data in {key: message_chunks[key] for key in
                                 [index + i * payload_size for i in range(window_size)] if
                                 key in message_chunks}.items():

            if args.broken and random.randint(0, 10) < 2:
                if args.debug:
                    print('broking message', seq_number)
                sock_message.sendto(corrupt_message(
                    create_message(*[Type.DATA.value, seq_number, int.from_bytes(message_chunks[seq_number], 'big')])),
                    (ip, int(port)))
                continue
            elif args.broken and random.randint(0, 10) < 2:
                if args.debug:
                    print('dropping message', seq_number)
                continue

            send_chunk(seq_number)

        while True:
            try:
                data, addr = sock_message.recvfrom(1472)

                fields = open_message(data)

                if args.debug:
                    print('received', fields)

                if fields[0] == Type.NACK.value:
                    send_chunk(fields[1])
                elif fields[0] == Type.APR.value:

                    if max(message_chunks.keys()) + payload_size == fields[1]:
                        sending = False
                        sock_message.close()
                    elif fields[1] in message_chunks.keys():
                        index = fields[1]

                    break
            except TimeoutError:
                break
            except ValueError:
                break
            except BaseException as e:
                print('receiving error', e)
                sending = False
                break


def session(ip, port):
    alive_connection = False
    sock_keep_alive = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_keep_alive.settimeout(3.0)

    timer = None

    def send_keep_alive():
        nonlocal timer, alive_connection
        sock_keep_alive.sendto(create_message(*[Type.KEEP_A.value]), (ip, port))

        try:
            data, addr = sock_keep_alive.recvfrom(1472)
        except BaseException as e:
            print('exception on keep-alive connection ', e)
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
            if message.startswith('\\'):
                try:
                    with open(message[1:], 'rb') as file:
                        send_message(ip, port, file.read(), int.from_bytes(message[1:].encode('utf-8'), 'big'))
                        continue
                except FileNotFoundError:
                    print('file not found')
                    continue

            send_message(ip, port, message.encode('utf-8'))
        except BaseException as e:
            print(e)
            break

        send_keep_alive()

    sock_keep_alive.close()


def user_input():
    while True:
        try:
            _socket = input('enter ip and port number:\n')

            if _socket.startswith('>'):
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
                        window_size = int(_socket.split(' ')[1])
                    except ValueError:
                        print('invalid input')
                    continue
                elif _socket.startswith('>storing_directory '):
                    try:
                        global storing_directory
                        storing_directory = _socket.split(' ')[1]
                    except ValueError:
                        print('invalid input')
                    continue
                else:
                    print('invalid command')
                    continue
            else:
                _ip, _port = _socket.split(' ')
                ip = _ip
                port = int(_port)

        except BaseException as e:
            print(e)
            continue
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
    exit()
except BaseException as e:
    print(e)
    exit(0)
