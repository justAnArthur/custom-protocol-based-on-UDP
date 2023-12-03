payload_size = 1
window_size = 1
index = 0

message_bytes = 'Удобный поиск поможет вам получить доступ более чем к 125 000 словам англо-русского словаря, который продолжает пополняться. К подавляющему большинству слов вы можете посмотреть варианты перевода, примеры использования, словосочетания, транскрипцию, а также прослушать американское и британское произношение слова'.encode('utf-8')
message_chunks = {i: message_bytes[i: i + payload_size] for i in range(0, len(message_bytes), payload_size)}

if len(message_bytes) % payload_size == 0:
    message_chunks[len(message_chunks)] = b''

print(max(message_chunks.keys()))

# for seq_number, data in {key: message_chunks[key] for key in
#                          [index + i * payload_size for i in range(window_size)] if
#                          key in message_chunks}.items():
#     print(seq_number, data)
