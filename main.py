import socket
import sys
import threading

ip = 'localhost'
port = sys.argv[1]


def approving(data, addr):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    sock.sendto("approved".encode(), addr)


def listen(ip, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    sock.bind((ip, int(port)))

    while True:
        data, addr = sock.recvfrom(1472)
        print(f"Received message: {data.decode()} from {addr}")

        if data.decode() == 'request':
            sock.sendto("approved".encode(), addr)


def request(ip, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

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
