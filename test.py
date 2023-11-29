# # The string to be split
# message = "Some information needed to be divided into chunks of certain bytes"
#
# # The size of each chunk in bytes
# chunk_size = 10
#
# # Convert the string to bytes
# byte_msg = message.encode('utf-8')
#
# # Split the byte string into chunks
# byte_chunks = [byte_msg[i: i + chunk_size] for i in range(0, len(byte_msg), chunk_size)]
#
# # Decode each chunk back into a string
# chunks = [bytes_chunk.decode('utf-8', 'ignore') for bytes_chunk in byte_chunks]
#
# message_map = {i * 10: chunk for i, chunk in enumerate(chunks)}
#
# for key, value in message_map.items():
#     print(f'Key: {key}, Value: {value}', len(value.encode('utf-8')))

for i in range(5, 6):
    print(i)