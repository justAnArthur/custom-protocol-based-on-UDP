s = "abCd141a"

print(''.join([s[i:i+2][::-1] for i in range(0, len(s), 2)]))