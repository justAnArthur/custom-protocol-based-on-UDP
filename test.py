def int_complement(num):
    return num ^ 0xFFFF

num = 14910
complement = int_complement(num)
print(f"The binary complement of {num} is {complement}")