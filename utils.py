from enum import Enum


def int_to_bytes(num):
    return num.to_bytes((num.bit_length() + 7) // 8, 'big') or b'\0'


# calculates the 2-bytes checksum
def calc_checksum(*data):
    checksum = 0
    for datum in data:
        chunks = [datum[-(i + 2):len(datum) - i] for i in range(0, len(datum), 2)][::-1]
        for chunk in chunks:
            checksum += int.from_bytes(chunk, 'big')

    if checksum > 0xFFFF:
        return calc_checksum(int_to_bytes(checksum))

    return checksum ^ 0xFFFF


#
# print(calc_checksum(
#     b'\xC0\xA8\x00\x1F',
#     b'\xC0\xA8\x00\x1E',
#     b'\x00\x06',
#     b'\x00\x16',
#     b'\x00\x14',
#     b'\x00\x0A',
#     b'\x00\x00\x00\x0A',
#     b'\x00\x00\x00\x00',
#     b'\x50\x02',
#     b'\x20\x00',
#     b'Hi'
# ))

class Type(Enum):
    DATA = 0
    REQ = 1
    APR = 2
    CSUM = 3


def pack_segment(type, second, third):
    checksum = calc_checksum(type.to_bytes(1, 'big'), second + third)

    return (type << 14 | (checksum & 0x3FFF)).to_bytes(2, 'big') + second + third


def parse_segment(bytes):
    type = Type(bytes[0] >> 6)
    checksum = int.from_bytes(bytes[0:2], 'big') & 0x3FFF
    calculated_checksum = calc_checksum(type.value.to_bytes(1, 'big'), bytes[2:]) & 0x3FFF

    if checksum != calculated_checksum:
        print('checksum is wrong')

    third = None

    match type:
        case Type.DATA:
            second = int.from_bytes(bytes[2:6], 'big')
            third = bytes[6:]
        case Type.REQ:
            second = ''.join(format(byte, '02x') for byte in bytes[2:34])
            # second = bytes[2:34]
            third = bytes[34:].decode()
        case Type.APR:
            second = int.from_bytes(bytes[2:6], 'big')
            third = bytes[6:]
        case Type.CSUM:
            second = ''.join(format(byte, '02x') for byte in bytes[2:34])
            third = bytes[34:].decode()

    return type, second, third


# bytes = pack_segment(
#     Type.REQ.value,
#     bytes.fromhex('a168522e5c21717106ea854536dd62be5c55cc12312d541b34527c91bae8036d'),
#     'first file'.encode()
# )
#
# print(bytes)
#
# bits = ' '.join(["{0:b}".format(b).zfill(8) for b in bytes])
#
# print(bits)
#
# print(parse_segment(bytes))


bytes = pack_segment(
    Type.DATA.value,
    (1).to_bytes(4, 'big'),
    'hello, hello'.encode()
)

print(bytes)

bits = ' '.join(["{0:b}".format(b).zfill(8) for b in bytes])

print(bits)

print(parse_segment(bytes))
