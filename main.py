import argparse
import random
import socket
import threading
import time

from message import *

parser = argparse.ArgumentParser()
parser.add_argument('-p', '--port', type=int, default=3141, help='Select the port to listen on')
args = parser.parse_args()

ip = 'localhost'
port = args.port
window_size = 1
data_payload_size = 1

sock_m = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def listen(ip, port):
    sock_m.bind((ip, int(port)))

    while True:
        data, addr = sock_m.recvfrom(1472)

        fields = open_message(data)

        # print(f"received message: {Type(fields[0])} from {addr}")

        match fields[0]:
            case Type.REQ_M.value:
                receive_message(fields, *addr)
            case Type.KEEP_A.value:
                sock_m.sendto(create_message(*[Type.KEEP_A.value]), addr)


def receive_message(fields, ip, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # sock.settimeout(3.0)
    requested_seq_number = 0

    sock.sendto(create_message(*[Type.APR.value, requested_seq_number]), (ip, int(port)))

    negative_received = []

    def send_negative(seq_number):
        # print('sending negative\n')
        negative_received.append(seq_number)
        sock.sendto(create_message(*[Type.NACK.value, seq_number]), (ip, int(port)))

    message_chunk_bytes = {}
    _data_payload_size = None
    message_end_riched = False

    while True:
        data, addr = sock.recvfrom(1472)
        fields = open_message(data)
        # print(f"received message: {fields[1]}, requested: {requested_seq_number} from {addr}")

        if fields[1] != requested_seq_number and fields[1] not in negative_received:
            for seq_number in range(requested_seq_number, fields[1]):
                send_negative(seq_number)

        chunk_bytes = fields[2].to_bytes((fields[2].bit_length() + 7) // 8, 'big')

        if fields[1] not in negative_received:
            requested_seq_number = fields[1] + len(chunk_bytes)
        else:
            negative_received.remove(fields[1])

        if fields[2] != 0:
            message_chunk_bytes[fields[1]] = chunk_bytes

        if _data_payload_size is None:
            _data_payload_size = len(chunk_bytes)

        if len(chunk_bytes) < _data_payload_size:
            message_end_riched = True

        if message_end_riched and negative_received == []:
            break

    print('received message:',
          b''.join(message_chunk_bytes[key] for key in sorted(message_chunk_bytes)).decode('utf-8', 'ignore'), '\n')
    sock.close()


def send_message(ip, port, message):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # sock.settimeout(3.0)

    message_bytes = message.encode('utf-8')
    message_chunk_bytes = {i * data_payload_size: message_bytes[i: i + data_payload_size] for i in
                           range(0, len(message_bytes), data_payload_size)}

    listen_on = threading.Event()

    def listen_on_negative(listen_on):
        while not listen_on.is_set():
            data, addr = sock.recvfrom(1472)
            fields = open_message(data)

            if fields[0] == Type.NACK.value:
                sock.sendto(create_message(
                    *[Type.DATA.value, fields[1], int.from_bytes(message_chunk_bytes[fields[1]], 'big')]), addr)

    def wait_on_approve():
        sock.sendto(create_message(*[Type.REQ_M.value, window_size]), (ip, int(port)))
        try:
            data, addr = sock.recvfrom(1472)
            fields = open_message(data)

            if fields[0] == Type.APR.value:

                # todo set seq_number from approve

                listen_on_negative_thread = threading.Thread(target=listen_on_negative, args=(listen_on,))
                # listen_on_negative_thread.daemon = True
                listen_on_negative_thread.start()

                for seq_number, chunk in message_chunk_bytes.items():
                    # print('sending data', seq_number, '\n')

                    # !randomly drop packets
                    if random.randint(0, 5) < 2:
                        continue

                    sock.sendto(create_message(*[Type.DATA.value, seq_number, int.from_bytes(chunk, 'big')]), addr)

                if len(message_chunk_bytes) < 1472:
                    sock.sendto(create_message(*[Type.DATA.value, len(message), 0]), addr)

                ...
                return
        except Exception as e:
            print(e)
            listen_on.set()
            sock.close()
            return

    wait_on_approve()


def init_session(ip, port):
    alive = False
    sock_alive = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_alive.settimeout(1.0)
    message_bytes_alive = create_message(*[Type.KEEP_A.value])

    timer = None

    def identify_alive():
        nonlocal alive, timer
        sock_alive.sendto(message_bytes_alive, (ip, int(port)))
        try:
            data = sock_alive.recvfrom(1472)
            alive = True

            timer = threading.Timer(1.0, identify_alive)
            timer.start()
        except Exception as e:
            print('no connection to host\n')
            alive = False
            sock_alive.close()

    identify_alive()

    while alive:
        user_input = input('enter message:\n')
        timer.cancel()

        if user_input == '>exit':
            break

        send_message(ip, port, user_input)
        identify_alive()


def wait_for_input():
    while True:
        user_input = input("enter port:\n")

        if user_input.startswith('>window_size '):
            try:
                global window_size
                window_size = int(user_input.split(' ')[1])
            except ValueError:
                ...
            continue

        init_session('localhost', user_input)


# Start a thread that waits for user input
input_thread = threading.Thread(target=wait_for_input)
input_thread.daemon = True
input_thread.start()

# Start another thread that waits for UDP packets
recv_thread = threading.Thread(target=listen, args=(ip, port))
recv_thread.daemon = True
recv_thread.start()

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    exit(0)
