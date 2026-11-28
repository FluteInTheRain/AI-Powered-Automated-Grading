# -*- coding: utf-8 -*-
"""Bank-only problems (no buggy submissions). Format: see data/bank_extra/__init__.py."""

RUBRIC = {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10}
RUBRIC_EFF = {"correctness": 50, "efficiency": 25, "code_style": 15, "edge_case_handling": 10}

PROBLEMS = [
    {
        "id": "P37_climbing_stairs",
        "title": "Climbing Stairs",
        "category": "Dynamic Programming",
        "difficulty": "easy",
        "statement": (
            "Write a function climb_stairs(n) that returns the number of distinct ways to climb a staircase of n steps "
            "when each move goes up either 1 step or 2 steps. Two ways are different if the order of the moves differs. "
            "Assume n is at least 1. For n = 3 the answer is 3, because the ways are 1+1+1, 1+2 and 2+1."
        ),
        "func_name": "climb_stairs",
        "rubric": RUBRIC,
        "reference_solution": '''def climb_stairs(n):
    previous, current = 1, 1
    for _ in range(n - 1):
        previous, current = current, previous + current
    return current
''',
        "test_cases": [
            ((3,), 3), ((1,), 1), ((2,), 2), ((4,), 5), ((5,), 8), ((6,), 13), ((7,), 21),
            ((10,), 89), ((15,), 987), ((20,), 10946), ((30,), 1346269), ((45,), 1836311903),
        ],
    },
    {
        "id": "P38_coin_change",
        "title": "Coin Change (Fewest Coins)",
        "category": "Dynamic Programming",
        "difficulty": "medium",
        "statement": (
            "Write a function coin_change(coins, amount) that returns the smallest number of coins needed to make exactly "
            "amount, or -1 if it cannot be done. coins is a list of distinct positive integers and every coin value can be "
            "used any number of times. An amount of 0 needs 0 coins. For coins = [1, 2, 5] and amount = 11 the answer is 3 "
            "(5 + 5 + 1), and for coins = [2] and amount = 3 the answer is -1."
        ),
        "func_name": "coin_change",
        "rubric": RUBRIC_EFF,
        "reference_solution": '''def coin_change(coins, amount):
    unreachable = amount + 1
    fewest = [0] + [unreachable] * amount
    for total in range(1, amount + 1):
        for coin in coins:
            if coin <= total and fewest[total - coin] + 1 < fewest[total]:
                fewest[total] = fewest[total - coin] + 1
    return fewest[amount] if fewest[amount] != unreachable else -1
''',
        "test_cases": [
            (([1, 2, 5], 11), 3), (([2], 3), -1), (([1], 0), 0), (([1], 2), 2), (([1, 3, 4], 6), 2),
            (([2, 5, 10, 1], 27), 4), (([1, 5, 6, 9], 11), 2), (([5], 10), 2), (([2, 4], 7), -1),
            (([7, 13], 0), 0), (([3, 5], 1), -1), (([1, 2, 5], 100), 20), (([186, 419, 83, 408], 6249), 20),
        ],
    },
    {
        "id": "P39_longest_increasing_subsequence",
        "title": "Longest Increasing Subsequence",
        "category": "Dynamic Programming",
        "difficulty": "medium",
        "statement": (
            "Write a function length_of_lis(nums) that returns the length of the longest strictly increasing subsequence "
            "of the list nums. A subsequence keeps the original order but may skip elements, and equal neighbours do not "
            "count as increasing. An empty list gives 0. For nums = [10, 9, 2, 5, 3, 7, 101, 18] the answer is 4, "
            "for example 2, 3, 7, 18."
        ),
        "func_name": "length_of_lis",
        "rubric": RUBRIC_EFF,
        "reference_solution": '''def length_of_lis(nums):
    # tails[k] is the smallest possible last value of an increasing subsequence of length k + 1.
    tails = []
    for value in nums:
        low, high = 0, len(tails)
        while low < high:
            middle = (low + high) // 2
            if tails[middle] < value:
                low = middle + 1
            else:
                high = middle
        if low == len(tails):
            tails.append(value)
        else:
            tails[low] = value
    return len(tails)
''',
        "test_cases": [
            (([10, 9, 2, 5, 3, 7, 101, 18],), 4), (([],), 0), (([5],), 1), (([1, 2, 3, 4],), 4),
            (([4, 3, 2, 1],), 1), (([2, 2, 2],), 1), (([0, 1, 0, 3, 2, 3],), 4), (([3, 10, 2, 1, 20],), 3),
            (([-5, -4, -3],), 3), (([1, 3, 6, 7, 9, 4, 10, 5, 6],), 6),
            (([10, 22, 9, 33, 21, 50, 41, 60, 80],), 6), (([7, 7, 1, 2, 2, 3],), 3),
        ],
    },
    {
        "id": "P40_house_robber",
        "title": "House Robber",
        "category": "Dynamic Programming",
        "difficulty": "medium",
        "statement": (
            "Write a function rob(nums) where nums[i] is the amount of money in the i-th house along a street. You may "
            "take the money from any set of houses as long as you never take from two neighbouring houses. Return the "
            "largest total you can collect. An empty street gives 0. For nums = [2, 7, 9, 3, 1] the answer is 12, "
            "from the houses with 2, 9 and 1."
        ),
        "func_name": "rob",
        "rubric": RUBRIC,
        "reference_solution": '''def rob(nums):
    skipped, taken = 0, 0
    for money in nums:
        skipped, taken = taken, max(taken, skipped + money)
    return taken
''',
        "test_cases": [
            (([2, 7, 9, 3, 1],), 12), (([1, 2, 3, 1],), 4), (([],), 0), (([5],), 5), (([2, 1],), 2),
            (([1, 2],), 2), (([0, 0, 0],), 0), (([2, 1, 1, 2],), 4), (([5, 1, 1, 5],), 10),
            (([100, 1, 1, 100, 1],), 200), (([1, 3, 1, 3, 100],), 103), (([4, 1, 2, 7, 5, 3, 1],), 14),
        ],
    },
    {
        "id": "P41_count_primes",
        "title": "Count Primes Below N",
        "category": "Math",
        "difficulty": "medium",
        "statement": (
            "Write a function count_primes(n) that returns how many prime numbers are strictly less than n. n is a "
            "non-negative integer and can be as large as 100000, so testing every number by trial division up to itself "
            "is too slow. For n = 10 the answer is 4 (2, 3, 5 and 7), and for n = 2 the answer is 0."
        ),
        "func_name": "count_primes",
        "rubric": RUBRIC_EFF,
        "reference_solution": '''def count_primes(n):
    if n < 3:
        return 0
    is_prime = [True] * n
    is_prime[0] = is_prime[1] = False
    factor = 2
    while factor * factor < n:
        if is_prime[factor]:
            for multiple in range(factor * factor, n, factor):
                is_prime[multiple] = False
        factor += 1
    return sum(is_prime)
''',
        "test_cases": [
            ((10,), 4), ((0,), 0), ((1,), 0), ((2,), 0), ((3,), 1), ((4,), 2), ((5,), 2), ((7,), 3),
            ((20,), 8), ((25,), 9), ((26,), 9), ((49,), 15), ((50,), 15), ((100,), 25), ((1000,), 168), ((10000,), 1229), ((100000,), 9592),
        ],
    },
    {
        "id": "P42_pascal_triangle",
        "title": "Pascal's Triangle",
        "category": "Dynamic Programming",
        "difficulty": "easy",
        "statement": (
            "Write a function generate_pascal(n) that returns the first n rows of Pascal's triangle as a list of lists "
            "of integers. Each row starts and ends with 1, and every other entry is the sum of the two entries just above "
            "it in the previous row. n = 0 gives an empty list. For n = 3 the result is [[1], [1, 1], [1, 2, 1]]."
        ),
        "func_name": "generate_pascal",
        "rubric": RUBRIC,
        "reference_solution": '''def generate_pascal(n):
    rows = []
    for index in range(n):
        row = [1] * (index + 1)
        for position in range(1, index):
            row[position] = rows[index - 1][position - 1] + rows[index - 1][position]
        rows.append(row)
    return rows
''',
        "test_cases": [
            ((3,), [[1], [1, 1], [1, 2, 1]]),
            ((0,), []), ((1,), [[1]]), ((2,), [[1], [1, 1]]),
            ((4,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1]]),
            ((5,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1]]),
            ((6,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1]]),
            ((7,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1], [1, 6, 15, 20, 15, 6, 1]]),
            ((8,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1],
                    [1, 6, 15, 20, 15, 6, 1], [1, 7, 21, 35, 35, 21, 7, 1]]),
            ((11,), [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1],
                     [1, 6, 15, 20, 15, 6, 1], [1, 7, 21, 35, 35, 21, 7, 1], [1, 8, 28, 56, 70, 56, 28, 8, 1],
                     [1, 9, 36, 84, 126, 126, 84, 36, 9, 1], [1, 10, 45, 120, 210, 252, 210, 120, 45, 10, 1]]),
        ],
    },
    {
        "id": "P43_unique_paths_with_obstacles",
        "title": "Unique Paths With Obstacles",
        "category": "Dynamic Programming",
        "difficulty": "medium",
        "statement": (
            "Write a function unique_paths(grid) where grid is a non-empty rectangular list of lists containing 0 for a "
            "free cell and 1 for a blocked cell. A walker starts in the top-left cell, ends in the bottom-right cell, "
            "and each move goes one cell right or one cell down, never onto a blocked cell. Return the number of different "
            "paths. If the start or the end is blocked the answer is 0. For grid = [[0, 0, 0], [0, 1, 0], [0, 0, 0]] "
            "the answer is 2."
        ),
        "func_name": "unique_paths",
        "rubric": RUBRIC,
        "reference_solution": '''def unique_paths(grid):
    columns = len(grid[0])
    ways = [0] * columns
    ways[0] = 1
    for row in grid:
        for column in range(columns):
            if row[column] == 1:
                ways[column] = 0
            elif column > 0:
                ways[column] += ways[column - 1]
    return ways[-1]
''',
        "test_cases": [
            (([[0, 0, 0], [0, 1, 0], [0, 0, 0]],), 2), (([[0]],), 1), (([[1]],), 0), (([[0, 1]],), 0),
            (([[0, 0]],), 1), (([[0, 1], [0, 0]],), 1), (([[1, 0]],), 0), (([[0, 0], [0, 1]],), 0),
            (([[0, 0, 0], [0, 0, 0], [0, 0, 0]],), 6), (([[0], [0], [0]],), 1),
            (([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],), 20),
            (([[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [1, 0, 0, 0]],), 3),
            (([[0, 0, 1], [1, 0, 0], [0, 0, 0]],), 2),
        ],
    },
    {
        "id": "P44_knapsack_01",
        "title": "0/1 Knapsack",
        "category": "Dynamic Programming",
        "difficulty": "medium",
        "statement": (
            "Write a function knapsack(weights, values, capacity) where item i has weight weights[i] and value values[i], "
            "both non-negative integers, and capacity is a non-negative integer. Each item can be taken at most once. "
            "Return the largest total value of a selection whose total weight does not exceed capacity. With no items "
            "or no room the answer is 0. For weights = [1, 3, 4, 5], values = [1, 4, 5, 7] and capacity = 7 "
            "the answer is 9, from the items with weights 3 and 4."
        ),
        "func_name": "knapsack",
        "rubric": RUBRIC,
        "reference_solution": '''def knapsack(weights, values, capacity):
    best = [0] * (capacity + 1)
    for weight, value in zip(weights, values):
        for room in range(capacity, weight - 1, -1):
            best[room] = max(best[room], best[room - weight] + value)
    return best[capacity]
''',
        "test_cases": [
            (([1, 3, 4, 5], [1, 4, 5, 7], 7), 9), (([], [], 10), 0), (([2, 3], [3, 4], 0), 0),
            (([10, 20, 30], [60, 100, 120], 50), 220), (([1, 2, 3], [6, 10, 12], 5), 22), (([5], [10], 5), 10),
            (([5], [10], 4), 0), (([2, 3, 4, 5], [3, 4, 5, 6], 5), 7), (([1, 1, 1], [1, 1, 1], 2), 2),
            (([1], [100], 10), 100), (([0, 2], [5, 3], 1), 5), (([4, 5, 6], [10, 13, 16], 11), 29),
            (([3, 4, 5], [4, 5, 6], 9), 11),
        ],
    },
    {
        "id": "P45_integer_to_roman",
        "title": "Integer to Roman Numeral",
        "category": "Math",
        "difficulty": "medium",
        "statement": (
            "Write a function int_to_roman(num) that converts an integer from 1 to 3999 into its standard Roman numeral "
            "string. The symbols are I=1, V=5, X=10, L=50, C=100, D=500 and M=1000, and the subtractive forms IV, IX, XL, "
            "XC, CD and CM are used for 4, 9, 40, 90, 400 and 900. For num = 58 the answer is \"LVIII\", and for "
            "num = 1994 it is \"MCMXCIV\"."
        ),
        "func_name": "int_to_roman",
        "rubric": RUBRIC,
        "reference_solution": '''def int_to_roman(num):
    symbols = [
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
        (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    ]
    parts = []
    for value, symbol in symbols:
        count, num = divmod(num, value)
        parts.append(symbol * count)
    return "".join(parts)
''',
        "test_cases": [
            ((58,), "LVIII"), ((1994,), "MCMXCIV"), ((3999,), "MMMCMXCIX"), ((1,), "I"), ((3,), "III"),
            ((4,), "IV"), ((9,), "IX"), ((40,), "XL"), ((90,), "XC"), ((400,), "CD"), ((900,), "CM"),
            ((444,), "CDXLIV"), ((2024,), "MMXXIV"), ((1000,), "M"),
        ],
    },
    {
        "id": "P46_count_n_queens",
        "title": "Count N-Queens Solutions",
        "category": "Recursion & Backtracking",
        "difficulty": "hard",
        "statement": (
            "Write a function count_n_queens(n) that returns the number of ways to place n queens on an n by n chessboard "
            "so that no two queens attack each other, meaning no two share a row, a column or a diagonal. Placements "
            "that are rotations or mirror images of each other still count separately. n is between 1 and 8. "
            "For n = 4 the answer is 2, and for n = 2 and n = 3 the answer is 0."
        ),
        "func_name": "count_n_queens",
        "rubric": RUBRIC,
        "reference_solution": '''def count_n_queens(n):
    used_columns = set()
    used_down_diagonals = set()
    used_up_diagonals = set()

    def place(row):
        if row == n:
            return 1
        total = 0
        for column in range(n):
            if (column in used_columns or row - column in used_down_diagonals
                    or row + column in used_up_diagonals):
                continue
            used_columns.add(column)
            used_down_diagonals.add(row - column)
            used_up_diagonals.add(row + column)
            total += place(row + 1)
            used_columns.remove(column)
            used_down_diagonals.remove(row - column)
            used_up_diagonals.remove(row + column)
        return total

    return place(0)
''',
        "test_cases": [
            ((4,), 2), ((1,), 1), ((2,), 0), ((3,), 0), ((5,), 10), ((6,), 4), ((7,), 40), ((8,), 92),
        ],
    },
]
