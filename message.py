import unittest
from enum import Enum


class Type(Enum):
    REQ = int('011', 2)
    REQ_M = int('010', 2)
    APR = int('100', 2)
    NACK = int('101', 2)
    DATA = int('000', 2)
    KEEP_A = int('110', 2)


class Mask(Enum):
    #            checksum, hash, window, filename
    REQ = [0b111, 0x1FFFFF, (1 << 256) - 1, 0xFF, '_']
    #            checksum, window
    REQ_M = [0b111, 0x1FFFFF, 0xFF, '_']
    #            checksum, seq_number
    APR = [0b111, 0x1FFFFF, (1 << 32) - 1]
    #            checksum, seq_number
    NACK = [0b111, 0x1FFFFF, (1 << 32) - 1]
    #            checksum, seq_number, data
    DATA = [0b111, 0x1FFFFF, (1 << 32) - 1, '_']
    #
    KEEP_A = [0b111, 0x1FFFFF]


def unpack_message(message_bytes):
    type = Type(message_bytes[0] >> 5)

    message_mask = Mask[type.name].value

    message_bits = ''.join(format(byte, '08b') for byte in message_bytes)

    fields = []
    for index, mask_field in enumerate(message_mask):
        if mask_field == '_':
            fields.append(int(message_bits, 2))
            break

        fields.append(int(message_bits[:mask_field.bit_length()], 2))
        message_bits = message_bits[mask_field.bit_length():]

    return fields


def pack_message(type, *fields):
    message_type = Type(type)

    message_mask = Mask[message_type.name].value

    fields = (type,) + fields

    message_bits = ''
    for index, mask_field in enumerate(message_mask):

        if mask_field == '_':
            message_bits += bin(fields[index])[2:].zfill(((fields[index].bit_length() + 7) // 8) * 8)
            break

        message_bits += bin(fields[index] & mask_field)[2:].zfill(mask_field.bit_length())

    return bytes([int(message_bits[i:i + 8], 2) for i in range(0, len(message_bits), 8)])


def compute_checksum(bits_length, *data):
    checksum = sum(data)

    while checksum.bit_length() > bits_length:
        # Split the checksum into two halves
        mask = (1 << (checksum.bit_length() // 2)) - 1
        low_bits = checksum & mask
        high_bits = checksum >> (checksum.bit_length() // 2)

        checksum = low_bits + high_bits

    return checksum


def create_message(type, *fields):
    checksum = compute_checksum(21, *((type,) + fields))
    fields = (checksum,) + fields
    return pack_message(type, *fields)


def open_message(message):
    fields = unpack_message(message)
    checksum = fields.pop(1)
    if checksum != compute_checksum(21, *fields):
        raise ValueError('Invalid checksum')
    return fields

def corrupt_message(message):
     return message[:1] + bytes([ord('a')]) + message[2:]

class Message(unittest.TestCase):
    def test__compute_checksum(self):
        fields = [
            Type.REQ.value,
            0x3398d424e5d1a1f2657dc06680dee743aced01dd177b69c32a09c70f1f362bb9,
            1, int('<3 U )'.encode().hex(), 16)
        ]
        self.assertEqual(compute_checksum(8, *fields), 31)
        self.assertEqual(compute_checksum(21, *fields), 173013)

    def test__pack_message_01(self):
        fields = [
            Type.REQ.value, 0xffff,
            0x3398d424e5d1a1f2657dc06680dee743aced01dd177b69c32a09c70f1f362bb9,
            1, int('<3 U )'.encode().hex(), 16)
        ]
        message = pack_message(*fields)
        _fields = unpack_message(message)
        print(_fields[-1].to_bytes((_fields[-1].bit_length() + 7) // 8, 'big').decode())
        self.assertEqual(fields, _fields)

    def test__create_message_01(self):
        fields = [
            Type.REQ.value,  # without checksum
            0x3398d424e5d1a1f2657dc06680dee743aced01dd177b69c32a09c70f1f362bb9,
            1, int('<3 U )'.encode().hex(), 16)
        ]
        message = create_message(*fields)
        _fields = unpack_message(message)
        self.assertEqual(173013, _fields[1])

    def test__open_message(self):
        fields = [
            Type.REQ.value,  # without checksum
            0x3398d424e5d1a1f2657dc06680dee743aced01dd177b69c32a09c70f1f362bb9,
            1, int('<3 U )'.encode().hex(), 16)
        ]
        message = create_message(*fields)
        _fields = open_message(message)
        self.assertEqual(fields, _fields)

        message = message[:1] + bytes([ord('a')]) + message[2:]
        with self.assertRaises(ValueError):
            _fields = open_message(message)

    if __name__ == '__main__':
        unittest.main()
