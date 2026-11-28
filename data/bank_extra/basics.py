# -*- coding: utf-8 -*-
"""Bank-only problems (no buggy submissions). Format: see data/bank_extra/__init__.py."""

_RUBRIC = {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10}

PROBLEMS = [
    {
        "id": "P57_leap_year",
        "title": "Leap Year",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function is_leap_year(year) that takes a positive integer year and returns True if it is a leap "
            "year in the Gregorian calendar and False otherwise. A year is a leap year when it is divisible by 4, "
            "except that years divisible by 100 are not leap years, unless they are also divisible by 400. For "
            "example, 2024 and 2000 are leap years, while 2023 and 1900 are not."
        ),
        "func_name": "is_leap_year",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def is_leap_year(year):
    if year % 400 == 0:
        return True
    if year % 100 == 0:
        return False
    return year % 4 == 0
''',
        "test_cases": [
            ((2024,), True),
            ((2023,), False),
            ((1900,), False),
            ((2000,), True),
            ((2100,), False),
            ((1600,), True),
            ((4,), True),
            ((1,), False),
            ((100,), False),
            ((400,), True),
            ((1996,), True),
            ((2019,), False),
            ((1800,), False),
            ((2400,), True),
        ],
    },
    {
        "id": "P58_perfect_number",
        "title": "Perfect Number",
        "category": "Math",
        "difficulty": "easy",
        "statement": (
            "Write a function is_perfect_number(n) that takes a positive integer n and returns True if n equals the "
            "sum of its proper divisors (all positive divisors of n except n itself), otherwise False. For n = 6 the "
            "proper divisors are 1, 2 and 3, which add up to 6, so the answer is True. For n = 12 they add up to 16, "
            "so the answer is False. The number 1 has no proper divisors, so their sum is 0 and it is not "
            "perfect."
        ),
        "func_name": "is_perfect_number",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def is_perfect_number(n):
    if n < 2:
        return False
    total = 1
    divisor = 2
    while divisor * divisor <= n:
        if n % divisor == 0:
            total += divisor
            other = n // divisor
            if other != divisor:
                total += other
        divisor += 1
    return total == n
''',
        "test_cases": [
            ((6,), True),
            ((28,), True),
            ((12,), False),
            ((1,), False),
            ((2,), False),
            ((496,), True),
            ((8128,), True),
            ((8,), False),
            ((497,), False),
            ((4,), False),
            ((9,), False),
            ((100,), False),
            ((27,), False),
        ],
    },
    {
        "id": "P59_decimal_to_binary",
        "title": "Decimal to Binary",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function decimal_to_binary(n) that takes a non-negative integer n and returns its binary "
            "representation as a string of '0' and '1' characters, with no '0b' prefix and no leading zeros. The "
            "number 0 is returned as '0'. For n = 10 the answer is '1010', and for n = 1 the answer is '1'. Do not "
            "use the built-in bin or format functions."
        ),
        "func_name": "decimal_to_binary",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def decimal_to_binary(n):
    if n == 0:
        return "0"
    digits = []
    while n > 0:
        digits.append(str(n % 2))
        n //= 2
    return "".join(reversed(digits))
''',
        "test_cases": [
            ((10,), "1010"),
            ((0,), "0"),
            ((1,), "1"),
            ((2,), "10"),
            ((5,), "101"),
            ((8,), "1000"),
            ((255,), "11111111"),
            ((256,), "100000000"),
            ((1023,), "1111111111"),
            ((64,), "1000000"),
            ((100,), "1100100"),
            ((7,), "111"),
            ((12,), "1100"),
        ],
    },
    {
        "id": "P60_binary_to_decimal",
        "title": "Binary to Decimal",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function binary_to_decimal(bits) that takes a non-empty string made only of the characters '0' "
            "and '1' and returns the integer it represents in base 2. The string may start with zeros. For bits = "
            "'1010' the answer is 10, and for bits = '0001' the answer is 1. Do not use int(bits, 2)."
        ),
        "func_name": "binary_to_decimal",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def binary_to_decimal(bits):
    value = 0
    for ch in bits:
        value = value * 2 + (1 if ch == "1" else 0)
    return value
''',
        "test_cases": [
            (("1010",), 10),
            (("0",), 0),
            (("1",), 1),
            (("0001",), 1),
            (("11111111",), 255),
            (("100000",), 32),
            (("101",), 5),
            (("1111111111",), 1023),
            (("00000",), 0),
            (("10000000000",), 1024),
            (("110",), 6),
            (("1100100",), 100),
        ],
    },
    {
        "id": "P61_matrix_transpose",
        "title": "Matrix Transpose",
        "category": "Matrices",
        "difficulty": "easy",
        "statement": (
            "Write a function transpose(matrix) that takes a matrix given as a list of rows (all rows have the same "
            "length, and the matrix may be rectangular) and returns its transpose as a new list of rows, so that "
            "the element at row i and column j of the input ends up at row j and column i of the output. An empty "
            "matrix [] gives []. For matrix = [[1, 2, 3], [4, 5, 6]] the answer is [[1, 4], [2, 5], [3, 6]]."
        ),
        "func_name": "transpose",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def transpose(matrix):
    if not matrix:
        return []
    rows = len(matrix)
    cols = len(matrix[0])
    return [[matrix[r][c] for r in range(rows)] for c in range(cols)]
''',
        "test_cases": [
            (([[1, 2, 3], [4, 5, 6]],), [[1, 4], [2, 5], [3, 6]]),
            (([[1, 2], [3, 4], [5, 6]],), [[1, 3, 5], [2, 4, 6]]),
            (([[7]],), [[7]]),
            (([[1, 2, 3, 4]],), [[1], [2], [3], [4]]),
            (([[1], [2], [3]],), [[1, 2, 3]]),
            (([[1, 2], [3, 4]],), [[1, 3], [2, 4]]),
            (([],), []),
            (([[-1, 0], [5, -7]],), [[-1, 5], [0, -7]]),
            (([[1, 2, 3], [4, 5, 6], [7, 8, 9]],), [[1, 4, 7], [2, 5, 8], [3, 6, 9]]),
            (([[1, 1], [1, 1], [2, 2]],), [[1, 1, 2], [1, 1, 2]]),
            (([[1, 2, 3, 4], [5, 6, 7, 8]],), [[1, 5], [2, 6], [3, 7], [4, 8]]),
        ],
    },
    {
        "id": "P62_bubble_sort_swaps",
        "title": "Bubble Sort Swap Count",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function bubble_sort_swaps(nums) that returns how many swaps plain bubble sort performs on the "
            "list nums, without changing nums. Bubble sort repeats passes over the list; in each pass it looks at "
            "every adjacent pair from left to right and swaps the two elements when the left one is strictly "
            "greater than the right one. It stops after a pass that makes no swap. Equal neighbours are never "
            "swapped. For nums = [3, 1, 2] the answer is 2 (3 swaps with 1, then 3 swaps with 2), and for nums = "
            "[1, 2, 3] the answer is 0."
        ),
        "func_name": "bubble_sort_swaps",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def bubble_sort_swaps(nums):
    items = list(nums)
    swaps = 0
    swapped = True
    while swapped:
        swapped = False
        for i in range(len(items) - 1):
            if items[i] > items[i + 1]:
                items[i], items[i + 1] = items[i + 1], items[i]
                swaps += 1
                swapped = True
    return swaps
''',
        "test_cases": [
            (([3, 1, 2],), 2),
            (([],), 0),
            (([5],), 0),
            (([1, 2, 3],), 0),
            (([3, 2, 1],), 3),
            (([2, 2, 1],), 2),
            (([1, 1, 1],), 0),
            (([5, 4, 3, 2, 1],), 10),
            (([2, 1, 4, 3],), 2),
            (([4, 3, 2, 1, 5],), 6),
            (([1, 5, 2, 5, 0],), 5),
            (([-1, -3, -2],), 2),
            (([2, 1],), 1),
        ],
    },
    {
        "id": "P63_second_largest",
        "title": "Second Largest Distinct Value",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function second_largest(nums) that takes a list of integers (possibly empty, possibly with "
            "repeats and negative values) and returns the second largest distinct value in it. If the list has fewer "
            "than two distinct values, return -1. For nums = [3, 1, 2] the answer is 2, for nums = [5, 5, 4] the "
            "answer is 4, and for nums = [7, 7, 7] the answer is -1."
        ),
        "func_name": "second_largest",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def second_largest(nums):
    largest = None
    second = None
    for value in nums:
        if largest is None or value > largest:
            if largest is not None:
                second = largest
            largest = value
        elif value != largest and (second is None or value > second):
            second = value
    return -1 if second is None else second
''',
        "test_cases": [
            (([3, 1, 2],), 2),
            (([5, 5, 5],), -1),
            (([],), -1),
            (([4],), -1),
            (([1, 2],), 1),
            (([2, 2, 1],), 1),
            (([5, 5, 4, 4],), 4),
            (([-3, -1, -2],), -2),
            (([0, -1],), -1),
            (([10, 9, 10, 8],), 9),
            (([1, 2, 3, 4, 5],), 4),
            (([7, 7, 7, 6],), 6),
            (([5, 4, 5, 3],), 4),
        ],
    },
    {
        "id": "P64_armstrong_numbers_in_range",
        "title": "Armstrong Numbers in a Range",
        "category": "Math",
        "difficulty": "easy",
        "statement": (
            "Write a function armstrong_numbers_in_range(lo, hi) that returns a list of all Armstrong numbers n with "
            "lo <= n <= hi, in increasing order. A non-negative integer is an Armstrong number when it equals the "
            "sum of its digits, each raised to the power of the number of digits. For example 153 is one, because "
            "1^3 + 5^3 + 3^3 = 153, and every single digit number (including 0) is one. If lo > hi, or the range "
            "holds none, return an empty list. For lo = 100 and hi = 400 the answer is [153, 370, 371]."
        ),
        "func_name": "armstrong_numbers_in_range",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def armstrong_numbers_in_range(lo, hi):
    result = []
    for n in range(lo, hi + 1):
        digits = str(n)
        power = len(digits)
        if sum(int(d) ** power for d in digits) == n:
            result.append(n)
    return result
''',
        "test_cases": [
            ((100, 400), [153, 370, 371]),
            ((1, 200), [1, 2, 3, 4, 5, 6, 7, 8, 9, 153]),
            ((100, 999), [153, 370, 371, 407]),
            ((0, 9), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            ((10, 152), []),
            ((153, 153), [153]),
            ((370, 371), [370, 371]),
            ((5, 3), []),
            ((1, 10000), [1, 2, 3, 4, 5, 6, 7, 8, 9, 153, 370, 371, 407, 1634, 8208, 9474]),
            ((9474, 9475), [9474]),
            ((0, 0), [0]),
            ((400, 1700), [407, 1634]),
            ((10, 99), []),
        ],
    },
    {
        "id": "P65_spiral_matrix",
        "title": "Spiral Order of a Matrix",
        "category": "Matrices",
        "difficulty": "medium",
        "statement": (
            "Write a function spiral_order(matrix) that takes a rectangular matrix given as a list of rows and "
            "returns a flat list with all its elements in clockwise spiral order: start at the top left corner, go "
            "right along the top row, then down the last column, then left along the bottom row, then up the first "
            "column, and keep spiralling inward until every element is used exactly once. An empty matrix [] gives "
            "[]. For matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]] the answer is [1, 2, 3, 6, 9, 8, 7, 4, 5]."
        ),
        "func_name": "spiral_order",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def spiral_order(matrix):
    if not matrix:
        return []
    result = []
    top, bottom = 0, len(matrix) - 1
    left, right = 0, len(matrix[0]) - 1
    while top <= bottom and left <= right:
        for col in range(left, right + 1):
            result.append(matrix[top][col])
        for row in range(top + 1, bottom + 1):
            result.append(matrix[row][right])
        if top < bottom and left < right:
            for col in range(right - 1, left - 1, -1):
                result.append(matrix[bottom][col])
            for row in range(bottom - 1, top, -1):
                result.append(matrix[row][left])
        top += 1
        bottom -= 1
        left += 1
        right -= 1
    return result
''',
        "test_cases": [
            (([[1, 2, 3], [4, 5, 6], [7, 8, 9]],), [1, 2, 3, 6, 9, 8, 7, 4, 5]),
            (([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],), [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7]),
            (([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],), [1, 2, 3, 6, 9, 12, 11, 10, 7, 4, 5, 8]),
            (([[1, 2, 3]],), [1, 2, 3]),
            (([[1], [2], [3]],), [1, 2, 3]),
            (([[7]],), [7]),
            (([[1, 2], [3, 4]],), [1, 2, 4, 3]),
            (([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]],), [1, 2, 3, 4, 5, 10, 9, 8, 7, 6]),
            (([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],), [1, 2, 4, 6, 8, 10, 9, 7, 5, 3]),
            (([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]],),
             [1, 2, 3, 4, 5, 10, 15, 14, 13, 12, 11, 6, 7, 8, 9]),
            (([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],),
             [1, 2, 3, 4, 8, 12, 16, 15, 14, 13, 9, 5, 6, 7, 11, 10]),
            (([],), []),
        ],
    },
    {
        "id": "P66_pyramid_pattern",
        "title": "Star Pyramid Pattern",
        "category": "Basics",
        "difficulty": "easy",
        "statement": (
            "Write a function star_pyramid(n) that takes a non-negative integer n and returns a list of n strings "
            "that form a centered pyramid of '*' characters. The string at index i (counting from 0) has exactly "
            "n - 1 - i spaces, then 2 * i + 1 stars, and nothing after the stars, so the pyramid is centered and no string "
            "has trailing spaces. For n = 3 the answer is ['  *', ' "
            "***', '*****']. For n = 0 the answer is an empty list."
        ),
        "func_name": "star_pyramid",
        "rubric": dict(_RUBRIC),
        "reference_solution": '''def star_pyramid(n):
    rows = []
    for i in range(n):
        rows.append(" " * (n - 1 - i) + "*" * (2 * i + 1))
    return rows
''',
        "test_cases": [
            ((3,), ["  *", " ***", "*****"]),
            ((0,), []),
            ((1,), ["*"]),
            ((2,), [" *", "***"]),
            ((4,), ["   *", "  ***", " *****", "*******"]),
            ((5,), ["    *", "   ***", "  *****", " *******", "*********"]),
            ((6,), ["     *", "    ***", "   *****", "  *******", " *********", "***********"]),
            ((7,), ["      *", "     ***", "    *****", "   *******", "  *********", " ***********", "*************"]),
            ((8,), ["       *", "      ***", "     *****", "    *******", "   *********", "  ***********", " *************", "***************"]),
            ((9,), ["        *", "       ***", "      *****", "     *******", "    *********", "   ***********", "  *************", " ***************", "*****************"]),
        ],
    },
]
