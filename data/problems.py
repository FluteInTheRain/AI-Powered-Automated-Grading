# -*- coding: utf-8 -*-
"""
Defines 16 programming problems, each with:
- statement: the problem statement
- rubric: 4 criteria with weights (sum = 100)
- test_cases: list of (input_args, expected_output) to run for real in the sandbox
- func_name: the function name the submission must define
- submissions: 4-5 solutions simulating different kinds of errors
"""

PROBLEMS = [
    {
        "id": "P01_two_sum",
        "statement": "Write a function two_sum(nums, target) that returns a list [i, j] (indices) such that nums[i] + nums[j] == target. Assume there is always exactly one answer, and you cannot use the same element twice.",
        "func_name": "two_sum",
        "rubric": {
            "correctness": 60,
            "efficiency": 15,       # O(n) using a hashmap instead of O(n^2)
            "code_style": 15,       # variable naming, comments, formatting
            "edge_case_handling": 10,  # empty input, no answer, negative numbers
        },
        "test_cases": [
            (([2, 7, 11, 15], 9), [0, 1]),
            (([3, 2, 4], 6), [1, 2]),
            (([3, 3], 6), [0, 1]),
            (([-1, -2, -3, -4, -5], -8), [2, 4]),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        complement = target - n
        if complement in seen:
            return [seen[complement], i]
        seen[n] = i
    return []
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_bruteforce_poor_style",
                "code": '''
def two_sum(nums,target):
 for i in range(len(nums)):
  for j in range(len(nums)):
   if i!=j:
    if nums[i]+nums[j]==target:
     return [i,j]
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n^2)", "style": "poor", "edge": "partial"}
            },
            {
                "sub_id": "S3_logic_bug_no_self_pair",
                "code": '''
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        complement = target - n
        if complement in seen and seen[complement] != i:
            return [seen[complement], i]
        seen[n] = i
    return []
''',
                "expected_profile": {"correctness": "fail_duplicate_case", "efficiency": "O(n)", "style": "clean", "edge": "broken_on_duplicates"}
            },
            {
                "sub_id": "S4_edge_case_bug_empty_target",
                "code": '''
def two_sum(nums, target):
    for i in range(len(nums) - 1):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return None
''',
                "expected_profile": {"correctness": "fail_return_type", "efficiency": "O(n^2)", "style": "medium", "edge": "wrong_return_on_no_answer"}
            },
            {
                "sub_id": "S5_wrong_completely",
                "code": '''
def two_sum(nums, target):
    return sorted(nums)[:2]
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(n log n)", "style": "medium", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P02_is_prime",
        "statement": "Write a function is_prime(n) that returns True if n is a prime number, False otherwise. n can be negative, 0, or 1.",
        "func_name": "is_prime",
        "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
        "test_cases": [
            ((2,), True), ((1,), False), ((0,), False), ((-5,), False),
            ((17,), True), ((18,), False), ((97,), True),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def is_prime(n):
    if n < 2:
        return False
    if n == 2:
        return True
    if n % 2 == 0:
        return False
    for i in range(3, int(n ** 0.5) + 1, 2):
        if n % i == 0:
            return False
    return True
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(sqrt n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_slow",
                "code": '''
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, n):
        if n % i == 0:
            return False
    return True
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S3_edge_case_bug_negative",
                "code": '''
def is_prime(n):
    if n < 2:
        return n == 1
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True
''',
                "expected_profile": {"correctness": "fail_negative_and_one", "efficiency": "O(sqrt n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_logic_bug_boundary",
                "code": '''
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5)):
        if n % i == 0:
            return False
    return True
''',
                "expected_profile": {"correctness": "fail_perfect_squares", "efficiency": "O(sqrt n)", "style": "clean", "edge": "off_by_one"}
            },
        ],
    },
    {
        "id": "P03_reverse_string",
        "statement": "Write a function reverse_string(s) that returns the string s reversed, without using [::-1] slicing or the built-in reversed() function.",
        "func_name": "reverse_string",
        "rubric": {"correctness": 50, "efficiency": 10, "code_style": 20, "edge_case_handling": 20},
        "test_cases": [
            (("hello",), "olleh"), (("",), ""), (("a",), "a"), (("ab cd",), "dc ba"),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def reverse_string(s):
    result = []
    for ch in s:
        result.insert(0, ch)
    return "".join(result)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n^2)_insert0", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_uses_forbidden_slicing",
                "code": '''
def reverse_string(s):
    return s[::-1]
''',
                "expected_profile": {"correctness": "pass_all_but_violates_constraint", "efficiency": "O(n)", "style": "clean", "edge": "handled",
                                       "note": "violates the problem's constraint despite a correct result - tests whether the rubric catches a 'constraint not followed' error"}
            },
            {
                "sub_id": "S3_edge_case_bug_empty",
                "code": '''
def reverse_string(s):
    result = ""
    for i in range(len(s) - 1, -1, -1):
        result += s[i]
    return result if s else None
''',
                "expected_profile": {"correctness": "fail_empty_string", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def reverse_string(s):
    return s.upper()
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(n)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P04_binary_search",
        "statement": "Write a function binary_search(arr, target) over an array arr sorted in ascending order, returning the index of target, or -1 if not found.",
        "func_name": "binary_search",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "test_cases": [
            (([1, 3, 5, 7, 9], 5), 2), (([1, 3, 5, 7, 9], 1), 0), (([1, 3, 5, 7, 9], 9), 4),
            (([1, 3, 5, 7, 9], 4), -1), (([], 3), -1), (([5], 5), 0),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(log n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_linear_scan",
                "code": '''
def binary_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)_not_binary", "style": "clean", "edge": "handled",
                                       "note": "correct result but doesn't use binary search - tests whether the rubric penalizes efficiency/approach"}
            },
            {
                "sub_id": "S3_logic_bug_infinite_loop_risk",
                "code": '''
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return -1
''',
                "expected_profile": {"correctness": "fail_last_element_or_timeout", "efficiency": "O(log n)_buggy", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_edge_case_bug_empty_array",
                "code": '''
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    mid = (lo + hi) // 2
    while arr[mid] != target and lo <= hi:
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
        mid = (lo + hi) // 2
    return mid if lo <= hi else -1
''',
                "expected_profile": {"correctness": "fail_empty_array_crash", "efficiency": "O(log n)", "style": "medium", "edge": "crashes_on_empty"}
            },
        ],
    },
    {
        "id": "P05_fibonacci",
        "statement": "Write a function fib(n) that returns the n-th Fibonacci number (fib(0)=0, fib(1)=1). n >= 0.",
        "func_name": "fib",
        "rubric": {"correctness": 50, "efficiency": 25, "code_style": 15, "edge_case_handling": 10},
        "test_cases": [
            ((0,), 0), ((1,), 1), ((2,), 1), ((5,), 5), ((10,), 55), ((20,), 6765),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_iterative",
                "code": '''
def fib(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_but_exponential",
                "code": '''
def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)
''',
                "expected_profile": {"correctness": "pass_all_slow_on_large_n", "efficiency": "O(2^n)", "style": "clean", "edge": "handled",
                                       "note": "correct but will time out for large n - tests whether the rubric penalizes efficiency"}
            },
            {
                "sub_id": "S3_logic_bug_offset",
                "code": '''
def fib(n):
    a, b = 1, 1
    for _ in range(n):
        a, b = b, a + b
    return a
''',
                "expected_profile": {"correctness": "fail_off_by_one_shift", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def fib(n):
    return n * 2
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P06_sum_of_digits",
        "statement": "Write a function sum_digits(n) that returns the sum of the digits of a positive integer n. If n is negative, take its absolute value before computing.",
        "func_name": "sum_digits",
        "rubric": {"correctness": 55, "efficiency": 10, "code_style": 15, "edge_case_handling": 20},
        "test_cases": [
            ((123,), 6), ((0,), 0), ((-45,), 9), ((7,), 7), ((999,), 27),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def sum_digits(n):
    n = abs(n)
    total = 0
    while n > 0:
        total += n % 10
        n //= 10
    return total
''',
                "expected_profile": {"correctness": "fail_zero_case", "efficiency": "O(d)", "style": "clean", "edge": "broken_on_zero"},
                "note": "apparent hidden bug: n=0 would return 0 since the while loop never runs - ACTUALLY correct since total starts at 0, kept in to sanity-check the sandbox"
            },
            {
                "sub_id": "S2_edge_case_bug_negative",
                "code": '''
def sum_digits(n):
    total = 0
    while n > 0:
        total += n % 10
        n //= 10
    return total
''',
                "expected_profile": {"correctness": "fail_negative_case", "efficiency": "O(d)", "style": "clean", "edge": "broken_on_negative"}
            },
            {
                "sub_id": "S3_correct_string_approach",
                "code": '''
def sum_digits(n):
    return sum(int(d) for d in str(abs(n)))
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(d)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def sum_digits(n):
    return len(str(n))
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(d)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P07_palindrome_check",
        "statement": "Write a function is_palindrome(s) that returns True if the string s is a palindrome, ignoring spaces and case.",
        "func_name": "is_palindrome",
        "rubric": {"correctness": 55, "efficiency": 10, "code_style": 15, "edge_case_handling": 20},
        "test_cases": [
            (("racecar",), True), (("hello",), False), (("A man a plan a canal Panama",), True),
            (("",), True), (("ab",), False),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def is_palindrome(s):
    cleaned = "".join(ch.lower() for ch in s if ch != " ")
    return cleaned == cleaned[::-1]
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_edge_case_bug_no_lowercase",
                "code": '''
def is_palindrome(s):
    cleaned = s.replace(" ", "")
    return cleaned == cleaned[::-1]
''',
                "expected_profile": {"correctness": "fail_case_sensitivity", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S3_edge_case_bug_no_space_removal",
                "code": '''
def is_palindrome(s):
    cleaned = s.lower()
    return cleaned == cleaned[::-1]
''',
                "expected_profile": {"correctness": "fail_spaces_not_removed", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def is_palindrome(s):
    return len(s) % 2 == 0
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P08_fizzbuzz",
        "statement": "Write a function fizzbuzz(n) that returns a list of strings from 1 to n: 'Fizz' if divisible by 3, 'Buzz' if divisible by 5, 'FizzBuzz' if divisible by both, otherwise the string of the number itself.",
        "func_name": "fizzbuzz",
        "rubric": {"correctness": 60, "efficiency": 10, "code_style": 15, "edge_case_handling": 15},
        "test_cases": [
            ((5,), ["1", "2", "Fizz", "4", "Buzz"]),
            ((15,), ["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"]),
            ((1,), ["1"]),
            ((0,), []),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def fizzbuzz(n):
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_logic_bug_order",
                "code": '''
def fizzbuzz(n):
    result = []
    for i in range(1, n + 1):
        if i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        elif i % 15 == 0:
            result.append("FizzBuzz")
        else:
            result.append(str(i))
    return result
''',
                "expected_profile": {"correctness": "fail_fizzbuzz_never_reached", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S3_edge_case_bug_zero",
                "code": '''
def fizzbuzz(n):
    result = []
    for i in range(1, n):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result
''',
                "expected_profile": {"correctness": "fail_off_by_one_range", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def fizzbuzz(n):
    return list(range(1, n + 1))
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(n)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P09_count_vowels",
        "statement": "Write a function count_vowels(s) that returns the number of vowels (a, e, i, o, u, case-insensitive) in the string s. Do not count 'y' as a vowel.",
        "func_name": "count_vowels",
        "rubric": {"correctness": 55, "efficiency": 10, "code_style": 15, "edge_case_handling": 20},
        "test_cases": [
            (("hello",), 2), (("HELLO",), 2), (("",), 0), (("xyz",), 0), (("AEIOUaeiou",), 10), (("Sky",), 0),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def count_vowels(s):
    vowels = set("aeiouAEIOU")
    return sum(1 for ch in s if ch in vowels)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_poor_style",
                "code": '''
def count_vowels(s):
    c=0
    for i in range(len(s)):
        if s[i]=='a' or s[i]=='e' or s[i]=='i' or s[i]=='o' or s[i]=='u' or s[i]=='A' or s[i]=='E' or s[i]=='I' or s[i]=='O' or s[i]=='U':
            c=c+1
    return c
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "poor", "edge": "handled"}
            },
            {
                "sub_id": "S3_edge_case_bug_case_sensitive",
                "code": '''
def count_vowels(s):
    vowels = set("aeiou")
    return sum(1 for ch in s if ch in vowels)
''',
                "expected_profile": {"correctness": "fail_uppercase", "efficiency": "O(n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def count_vowels(s):
    return len(s)
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P10_is_anagram",
        "statement": "Write a function is_anagram(s1, s2) that returns True if s1 and s2 are anagrams of each other (same letters, same counts, case-insensitive, ignoring spaces), False otherwise.",
        "func_name": "is_anagram",
        "rubric": {"correctness": 55, "efficiency": 15, "code_style": 15, "edge_case_handling": 15},
        "test_cases": [
            (("listen", "silent"), True),
            (("Dormitory", "dirty room"), True),
            (("hello", "world"), False),
            (("", ""), True),
            (("a", "ab"), False),
            (("Astronomer", "Moon starer"), True),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def is_anagram(s1, s2):
    normalize = lambda s: sorted(s.lower().replace(" ", ""))
    return normalize(s1) == normalize(s2)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n log n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_bruteforce_counter",
                "code": '''
def is_anagram(s1, s2):
    a = s1.lower().replace(" ", "")
    b = s2.lower().replace(" ", "")
    if len(a) != len(b):
        return False
    a_list = list(a)
    for ch in b:
        found = False
        for i in range(len(a_list)):
            if a_list[i] == ch:
                a_list.pop(i)
                found = True
                break
        if not found:
            return False
    return True
''',
                "expected_profile": {"correctness": "pass_all_slow", "efficiency": "O(n^2)", "style": "medium", "edge": "handled",
                                       "note": "correct but quadratic due to repeated list.pop - tests whether efficiency check catches non-obvious O(n^2)"}
            },
            {
                "sub_id": "S3_edge_case_bug_spaces",
                "code": '''
def is_anagram(s1, s2):
    normalize = lambda s: sorted(s.lower())
    return normalize(s1) == normalize(s2)
''',
                "expected_profile": {"correctness": "fail_spaces", "efficiency": "O(n log n)", "style": "clean", "edge": "broken"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def is_anagram(s1, s2):
    return len(s1) == len(s2)
''',
                "expected_profile": {"correctness": "fail_most", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P11_caesar_cipher",
        "statement": "Write a function caesar_encrypt(s, shift) that shifts every letter in s forward by `shift` positions in the alphabet, wrapping around from z back to a (and Z back to A). Non-letter characters are left unchanged. Preserve the original case of each letter.",
        "func_name": "caesar_encrypt",
        "rubric": {"correctness": 55, "efficiency": 10, "code_style": 15, "edge_case_handling": 20},
        "test_cases": [
            (("abc", 1), "bcd"),
            (("xyz", 1), "yza"),
            (("Hello, World!", 3), "Khoor, Zruog!"),
            (("abc", 0), "abc"),
            (("XYZ", 2), "ZAB"),
            (("", 5), ""),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def caesar_encrypt(s, shift):
    result = []
    for ch in s:
        if ch.isupper():
            result.append(chr((ord(ch) - ord('A') + shift) % 26 + ord('A')))
        elif ch.islower():
            result.append(chr((ord(ch) - ord('a') + shift) % 26 + ord('a')))
        else:
            result.append(ch)
    return "".join(result)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_poor_style",
                "code": '''
def caesar_encrypt(s,shift):
    r=""
    for c in s:
        if c.isupper(): r+=chr((ord(c)-65+shift)%26+65)
        elif c.islower(): r+=chr((ord(c)-97+shift)%26+97)
        else: r+=c
    return r
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "poor", "edge": "handled"}
            },
            {
                "sub_id": "S3_edge_case_bug_no_wraparound",
                "code": '''
def caesar_encrypt(s, shift):
    result = []
    for ch in s:
        if ch.isalpha():
            result.append(chr(ord(ch) + shift))
        else:
            result.append(ch)
    return "".join(result)
''',
                "expected_profile": {"correctness": "fail_wraparound", "efficiency": "O(n)", "style": "clean", "edge": "broken",
                                       "note": "wraps into non-letter ASCII range for letters near the end of the alphabet"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def caesar_encrypt(s, shift):
    return s
''',
                "expected_profile": {"correctness": "fail_all_nonzero_shift", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P12_valid_parentheses",
        "statement": "Write a function valid_parentheses(s) that returns True if every opening bracket in s ('(', '[', '{') has a matching closing bracket in the correct order, False otherwise. s may also contain other characters, which should be ignored.",
        "func_name": "valid_parentheses",
        "rubric": {"correctness": 60, "efficiency": 10, "code_style": 15, "edge_case_handling": 15},
        "test_cases": [
            (("()",), True),
            (("()[]{}",), True),
            (("(]",), False),
            (("([)]",), False),
            (("{[]}",), True),
            (("",), True),
            (("(",), False),
            (("[[[",), False),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def valid_parentheses(s):
    pairs = {')': '(', ']': '[', '}': '{'}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_poor_style",
                "code": '''
def valid_parentheses(s):
    st=[]
    p={')':'(',']':'[','}':'{'}
    for c in s:
        if c=='(' or c=='[' or c=='{': st.append(c)
        elif c==')' or c==']' or c=='}':
            if len(st)==0: return False
            if st[len(st)-1]!=p[c]: return False
            st=st[:len(st)-1]
    if len(st)==0: return True
    return False
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "poor", "edge": "handled"}
            },
            {
                "sub_id": "S3_logic_bug_no_leftover_check",
                "code": '''
def valid_parentheses(s):
    pairs = {')': '(', ']': '[', '}': '{'}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or stack.pop() != pairs[ch]:
                return False
    return True
''',
                "expected_profile": {"correctness": "fail_unclosed_brackets", "efficiency": "O(n)", "style": "clean", "edge": "broken",
                                       "note": "never checks for leftover unmatched opening brackets, e.g. '(' returns True incorrectly"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def valid_parentheses(s):
    return s.count('(') == s.count(')')
''',
                "expected_profile": {"correctness": "fail_order_and_bracket_types", "efficiency": "O(n)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P13_merge_sorted_lists",
        "statement": "Write a function merge_sorted_lists(a, b) that merges two sorted (ascending) lists of integers into a single sorted (ascending) list, keeping all duplicates.",
        "func_name": "merge_sorted_lists",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 10, "edge_case_handling": 15},
        "test_cases": [
            (([1, 3, 5], [2, 4, 6]), [1, 2, 3, 4, 5, 6]),
            (([], [1, 2, 3]), [1, 2, 3]),
            (([1, 2, 3], []), [1, 2, 3]),
            (([], []), []),
            (([1, 1, 2], [1, 3]), [1, 1, 1, 2, 3]),
            (([5], [1]), [1, 5]),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def merge_sorted_lists(a, b):
    result = []
    i, j = 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            result.append(a[i])
            i += 1
        else:
            result.append(b[j])
            j += 1
    result.extend(a[i:])
    result.extend(b[j:])
    return result
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n+m)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_but_sort_based",
                "code": '''
def merge_sorted_lists(a, b):
    return sorted(a + b)
''',
                "expected_profile": {"correctness": "pass_all_slow", "efficiency": "O((n+m)log(n+m))", "style": "clean", "edge": "handled",
                                       "note": "correct output but doesn't exploit that both inputs are already sorted - tests whether efficiency check catches this"}
            },
            {
                "sub_id": "S3_edge_case_bug_empty_list",
                "code": '''
def merge_sorted_lists(a, b):
    result = []
    i, j = 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            result.append(a[i])
            i += 1
        else:
            result.append(b[j])
            j += 1
    return result
''',
                "expected_profile": {"correctness": "fail_leftover_elements", "efficiency": "O(n+m)", "style": "clean", "edge": "broken",
                                       "note": "drops the remaining tail of whichever list wasn't fully consumed"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def merge_sorted_lists(a, b):
    return a + b
''',
                "expected_profile": {"correctness": "fail_not_sorted", "efficiency": "O(n+m)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P14_factorial",
        "statement": "Write a recursive function factorial(n) that returns n! (the factorial of n). factorial(0) = 1. Assume n >= 0.",
        "func_name": "factorial",
        "rubric": {"correctness": 55, "efficiency": 10, "code_style": 15, "edge_case_handling": 20},
        "test_cases": [
            ((0,), 1), ((1,), 1), ((2,), 2), ((5,), 120), ((10,), 3628800),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_poor_style",
                "code": '''
def factorial(n):
    if n<=1:
        return 1
    else:
        return n*factorial(n-1)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(n)", "style": "medium", "edge": "handled"}
            },
            {
                "sub_id": "S3_edge_case_bug_wrong_base_case",
                "code": '''
def factorial(n):
    if n == 1:
        return 1
    return n * factorial(n - 1)
''',
                "expected_profile": {"correctness": "fail_zero_case", "efficiency": "O(n)", "style": "clean", "edge": "broken",
                                       "note": "missing n==0 base case causes infinite recursion / RecursionError for factorial(0)"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def factorial(n):
    return n
''',
                "expected_profile": {"correctness": "fail_all_except_0_1", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P15_gcd_euclidean",
        "statement": "Write a recursive function gcd(a, b) that returns the greatest common divisor of non-negative integers a and b, using the Euclidean algorithm (gcd(a, 0) = a; gcd(a, b) = gcd(b, a % b) for b != 0).",
        "func_name": "gcd",
        "rubric": {"correctness": 55, "efficiency": 15, "code_style": 15, "edge_case_handling": 15},
        "test_cases": [
            ((48, 18), 6), ((17, 5), 1), ((0, 5), 5), ((5, 0), 5), ((100, 75), 25), ((7, 7), 7),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_clean",
                "code": '''
def gcd(a, b):
    if b == 0:
        return a
    return gcd(b, a % b)
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(log(min(a,b)))", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_but_subtraction_based",
                "code": '''
def gcd(a, b):
    if a == 0:
        return b
    if b == 0:
        return a
    if a == b:
        return a
    if a > b:
        return gcd(a - b, b)
    return gcd(a, b - a)
''',
                "expected_profile": {"correctness": "pass_all_slow", "efficiency": "O(max(a,b))", "style": "medium", "edge": "handled",
                                       "note": "correct but uses repeated subtraction instead of modulo - much slower for large inputs, tests efficiency check"}
            },
            {
                "sub_id": "S3_edge_case_bug_no_zero_handling",
                "code": '''
def gcd(a, b):
    if a % b == 0:
        return b
    return gcd(b, a % b)
''',
                "expected_profile": {"correctness": "fail_b_zero", "efficiency": "O(log(min(a,b)))", "style": "clean", "edge": "broken",
                                       "note": "ZeroDivisionError when b=0, e.g. gcd(5, 0)"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def gcd(a, b):
    return min(a, b) if min(a, b) != 0 else max(a, b)
''',
                "expected_profile": {"correctness": "fail_most", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
    {
        "id": "P16_power",
        "statement": "Write a recursive function power(x, n) that returns x raised to the power n (x ** n), where n is a non-negative integer. For full efficiency credit, use fast exponentiation (O(log n)) rather than multiplying x by itself n times.",
        "func_name": "power",
        "rubric": {"correctness": 50, "efficiency": 20, "code_style": 15, "edge_case_handling": 15},
        "test_cases": [
            ((2, 10), 1024), ((3, 0), 1), ((5, 1), 5), ((2, 1), 2), ((1, 100), 1), ((0, 5), 0),
        ],
        "submissions": [
            {
                "sub_id": "S1_correct_fast_exponentiation",
                "code": '''
def power(x, n):
    if n == 0:
        return 1
    half = power(x, n // 2)
    if n % 2 == 0:
        return half * half
    return half * half * x
''',
                "expected_profile": {"correctness": "pass_all", "efficiency": "O(log n)", "style": "clean", "edge": "handled"}
            },
            {
                "sub_id": "S2_correct_but_linear",
                "code": '''
def power(x, n):
    if n == 0:
        return 1
    return x * power(x, n - 1)
''',
                "expected_profile": {"correctness": "pass_all_slow", "efficiency": "O(n)", "style": "clean", "edge": "handled",
                                       "note": "correct but linear recursion instead of the requested fast exponentiation - tests efficiency check"}
            },
            {
                "sub_id": "S3_edge_case_bug_no_base_case",
                "code": '''
def power(x, n):
    half = power(x, n // 2)
    if n % 2 == 0:
        return half * half
    return half * half * x
''',
                "expected_profile": {"correctness": "fail_all", "efficiency": "O(log n)", "style": "clean", "edge": "broken",
                                       "note": "missing n==0 base case causes infinite recursion for every input"}
            },
            {
                "sub_id": "S4_wrong_completely",
                "code": '''
def power(x, n):
    return x * n
''',
                "expected_profile": {"correctness": "fail_all_except_trivial", "efficiency": "O(1)", "style": "clean", "edge": "not_handled"}
            },
        ],
    },
]
