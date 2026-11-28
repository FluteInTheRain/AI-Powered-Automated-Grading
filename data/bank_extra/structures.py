# -*- coding: utf-8 -*-
"""Bank-only problems (no buggy submissions). Format: see data/bank_extra/__init__.py."""

_RUBRIC = {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10}
_RUBRIC_EFF = {"correctness": 50, "efficiency": 25, "code_style": 15, "edge_case_handling": 10}

_SUDOKU_PARTIAL = ["53..7....", "6..195...", ".98....6.", "8...6...3", "4..8.3..1", "7...2...6", ".6....28.", "...419..5", "....8..79"]
_SUDOKU_SOLVED = ["534678912", "672195348", "198342567", "859761423", "426853791", "713924856", "961537284", "287419635", "345286179"]
_SUDOKU_EMPTY = ["........."] * 9


def _with(board, r, c, ch):
    rows = list(board)
    rows[r] = rows[r][:c] + ch + rows[r][c + 1:]
    return rows


PROBLEMS = [
    {
        "id": "P47_merge_intervals",
        "title": "Merge Overlapping Intervals",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": (
            "Write a function merge_intervals(intervals) that takes a list of closed intervals, each given as a "
            "two element list [start, end] with start <= end, in any order. Two intervals overlap when they share at "
            "least one point, so [1, 4] and [4, 5] overlap but [1, 2] and [3, 4] do not. Merge every group of "
            "overlapping intervals into one interval covering all of them and return the merged intervals as a list "
            "of [start, end] lists sorted by start. For intervals = [[1, 3], [2, 6], [8, 10]] the answer is "
            "[[1, 6], [8, 10]]. An empty input gives an empty list."
        ),
        "func_name": "merge_intervals",
        "rubric": _RUBRIC,
        "reference_solution": (
            "def merge_intervals(intervals):\n"
            "    merged = []\n"
            "    for start, end in sorted(intervals):\n"
            "        if merged and start <= merged[-1][1]:\n"
            "            merged[-1][1] = max(merged[-1][1], end)\n"
            "        else:\n"
            "            merged.append([start, end])\n"
            "    return merged\n"
        ),
        "test_cases": [
            (([[1, 3], [2, 6], [8, 10], [15, 18]],), [[1, 6], [8, 10], [15, 18]]),
            (([],), []),
            (([[5, 5]],), [[5, 5]]),
            (([[1, 4], [4, 5]],), [[1, 5]]),
            (([[1, 4], [0, 4]],), [[0, 4]]),
            (([[1, 4], [2, 3]],), [[1, 4]]),
            (([[8, 10], [1, 3], [2, 6]],), [[1, 6], [8, 10]]),
            (([[1, 2], [3, 4]],), [[1, 2], [3, 4]]),
            (([[-5, -1], [-3, 2], [4, 4]],), [[-5, 2], [4, 4]]),
            (([[1, 10], [2, 3], [4, 5], [6, 7]],), [[1, 10]]),
            (([[2, 3], [2, 3], [2, 3]],), [[2, 3]]),
            (([[1, 5], [2, 3], [4, 8], [10, 12], [11, 11]],), [[1, 8], [10, 12]]),
        ],
    },
    {
        "id": "P48_top_k_frequent",
        "title": "Top K Frequent Values",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function top_k_frequent(nums, k) that takes a list of integers nums and an integer k with "
            "1 <= k <= the number of distinct values in nums. Return a list with the k values that occur most often. "
            "Order the list by frequency from highest to lowest, and when two values occur equally often put the "
            "smaller value first. For nums = [4, 4, 5, 5, 6] and k = 2 the answer is [4, 5], and for "
            "nums = [1, 1, 1, 2, 2, 3] and k = 2 it is [1, 2]."
        ),
        "func_name": "top_k_frequent",
        "rubric": _RUBRIC,
        "reference_solution": (
            "from collections import Counter\n\n"
            "def top_k_frequent(nums, k):\n"
            "    counts = Counter(nums)\n"
            "    ranked = sorted(counts, key=lambda value: (-counts[value], value))\n"
            "    return ranked[:k]\n"
        ),
        "test_cases": [
            (([1, 1, 1, 2, 2, 3], 2), [1, 2]),
            (([1], 1), [1]),
            (([4, 4, 5, 5, 6], 2), [4, 5]),
            (([5, 5, 4, 4, 6], 2), [4, 5]),
            (([3, 3, 3, 2, 2, 1], 3), [3, 2, 1]),
            (([-1, -1, -2], 1), [-1]),
            (([-1, -2, -2, -1, 0], 2), [-2, -1]),
            (([7, 7, 7, 7], 1), [7]),
            (([1, 2, 3], 2), [1, 2]),
            (([1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 2), [4, 3]),
            (([9, 8, 8, 9, 7, 7], 3), [7, 8, 9]),
            (([0, 0, 0, 1, 1, 2], 1), [0]),
            (([2, 1, 1, 2, 3], 2), [1, 2]),
        ],
    },
    {
        "id": "P49_group_anagrams",
        "title": "Group Anagrams",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function group_anagrams(words) that takes a list of lowercase words and groups together the "
            "words that are anagrams of each other, meaning they use exactly the same letters the same number of "
            "times. Return a list of groups, where each group is a list of words sorted alphabetically (repeated "
            "words stay, repeated as many times as given) and the list of groups is itself sorted, comparing groups "
            "as lists. For words = ['eat', 'tea', 'tan', 'ate', 'nat', 'bat'] the answer is "
            "[['ate', 'eat', 'tea'], ['bat'], ['nat', 'tan']]. An empty input gives an empty list."
        ),
        "func_name": "group_anagrams",
        "rubric": _RUBRIC,
        "reference_solution": (
            "def group_anagrams(words):\n"
            "    groups = {}\n"
            "    for word in words:\n"
            "        key = ''.join(sorted(word))\n"
            "        groups.setdefault(key, []).append(word)\n"
            "    return sorted(sorted(group) for group in groups.values())\n"
        ),
        "test_cases": [
            ((["eat", "tea", "tan", "ate", "nat", "bat"],), [["ate", "eat", "tea"], ["bat"], ["nat", "tan"]]),
            (([],), []),
            ((["a"],), [["a"]]),
            ((["a", "a"],), [["a", "a"]]),
            (([""],), [[""]]),
            ((["", ""],), [["", ""]]),
            ((["ab", "ba", "abc", "cab", "bca"],), [["ab", "ba"], ["abc", "bca", "cab"]]),
            ((["abc", "def"],), [["abc"], ["def"]]),
            ((["listen", "silent", "enlist", "google", "gogole"],), [["enlist", "listen", "silent"], ["gogole", "google"]]),
            ((["aab", "aba", "baa", "abb"],), [["aab", "aba", "baa"], ["abb"]]),
            ((["zz", "z"],), [["z"], ["zz"]]),
            ((["bob", "obb", "bbo", "boo"],), [["bbo", "bob", "obb"], ["boo"]]),
            ((["tab", "bat", "abt", "cat"],), [["abt", "bat", "tab"], ["cat"]]),
        ],
    },
    {
        "id": "P50_daily_temperatures",
        "title": "Days Until a Warmer Temperature",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function daily_temperatures(temps) that takes a list of integer temperatures, one per day. "
            "Return a list of the same length where entry i is the number of days you have to wait after day i to "
            "reach a strictly warmer temperature, or 0 if no later day is warmer. For temps = [70, 60, 80] the "
            "answer is [2, 1, 0]: day 0 waits two days for 80, day 1 waits one day, and day 2 never gets a warmer "
            "day. Equal temperatures do not count as warmer. An empty input gives an empty list."
        ),
        "func_name": "daily_temperatures",
        "rubric": _RUBRIC_EFF,
        "reference_solution": (
            "def daily_temperatures(temps):\n"
            "    waits = [0] * len(temps)\n"
            "    pending = []  # indices of days still waiting, temperatures non-increasing\n"
            "    for day, temp in enumerate(temps):\n"
            "        while pending and temps[pending[-1]] < temp:\n"
            "            earlier = pending.pop()\n"
            "            waits[earlier] = day - earlier\n"
            "        pending.append(day)\n"
            "    return waits\n"
        ),
        "test_cases": [
            (([73, 74, 75, 71, 69, 72, 76, 73],), [1, 1, 4, 2, 1, 1, 0, 0]),
            (([],), []),
            (([50],), [0]),
            (([30, 40, 50, 60],), [1, 1, 1, 0]),
            (([60, 50, 40, 30],), [0, 0, 0, 0]),
            (([50, 50, 50],), [0, 0, 0]),
            (([30, 60, 90],), [1, 1, 0]),
            (([-5, -10, 0],), [2, 1, 0]),
            (([70, 60, 80, 65, 90],), [2, 1, 2, 1, 0]),
            (([89, 62, 70, 58, 47, 47, 46, 76, 100, 70],), [8, 1, 5, 4, 3, 2, 1, 1, 0, 0]),
            (([10, 20, 10, 20],), [1, 0, 1, 0]),
        ],
    },
    {
        "id": "P51_evaluate_rpn",
        "title": "Evaluate Reverse Polish Notation",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function evaluate_rpn(tokens) that evaluates an arithmetic expression in reverse Polish "
            "notation. tokens is a list of strings, each either an integer such as '4' or '-11' or one of the "
            "operators '+', '-', '*', '/'. An operator takes the two most recent values, with the earlier one as "
            "the left operand. Division of integers truncates toward zero, so 7 / -2 is -3 and -1 / 2 is 0. The "
            "expression is always valid and never divides by zero. Return the final integer. For "
            "tokens = ['2', '1', '+', '3', '*'] the answer is 9, and for ['4', '13', '5', '/', '+'] it is 6."
        ),
        "func_name": "evaluate_rpn",
        "rubric": _RUBRIC,
        "reference_solution": (
            "def evaluate_rpn(tokens):\n"
            "    values = []\n"
            "    for token in tokens:\n"
            "        if token in ('+', '-', '*', '/'):\n"
            "            right = values.pop()\n"
            "            left = values.pop()\n"
            "            if token == '+':\n"
            "                values.append(left + right)\n"
            "            elif token == '-':\n"
            "                values.append(left - right)\n"
            "            elif token == '*':\n"
            "                values.append(left * right)\n"
            "            else:\n"
            "                quotient = abs(left) // abs(right)\n"
            "                values.append(quotient if (left < 0) == (right < 0) else -quotient)\n"
            "        else:\n"
            "            values.append(int(token))\n"
            "    return values[0]\n"
        ),
        "test_cases": [
            ((["2", "1", "+", "3", "*"],), 9),
            ((["4", "13", "5", "/", "+"],), 6),
            ((["10", "6", "9", "3", "+", "-11", "*", "/", "*", "17", "+", "5", "+"],), 22),
            ((["7"],), 7),
            ((["-7", "2", "/"],), -3),
            ((["7", "-2", "/"],), -3),
            ((["-7", "-2", "/"],), 3),
            ((["3", "4", "-"],), -1),
            ((["5", "1", "2", "+", "4", "*", "+", "3", "-"],), 14),
            ((["0", "3", "/"],), 0),
            ((["1", "2", "/"],), 0),
            ((["-1", "2", "/"],), 0),
            ((["2", "3", "4", "*", "-"],), -10),
            ((["-1", "-1", "/"],), 1),
            ((["-1", "1", "/"],), -1),
            ((["7", "-1", "/"],), -7),
        ],
    },
    {
        "id": "P52_min_stack_ops",
        "title": "Stack With Minimum Queries",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function min_stack_ops(ops) that simulates a stack of integers. ops is a list of operations, "
            "each a list: ['push', x] puts x on top, ['pop'] removes the top value, ['top'] reads the top value "
            "and ['min'] reads the smallest value currently on the stack. Operations are always valid, so pop, "
            "top and min are never used on an empty stack. Return a list with the results of the 'top' and 'min' "
            "operations in the order they occur (push and pop produce no result). For "
            "ops = [['push', 3], ['push', 1], ['min'], ['pop'], ['min']] the answer is [1, 3]. Each operation "
            "should take constant time."
        ),
        "func_name": "min_stack_ops",
        "rubric": _RUBRIC_EFF,
        "reference_solution": (
            "def min_stack_ops(ops):\n"
            "    values = []\n"
            "    minimums = []  # minimums[i] is the smallest value among values[: i + 1]\n"
            "    results = []\n"
            "    for op in ops:\n"
            "        name = op[0]\n"
            "        if name == 'push':\n"
            "            values.append(op[1])\n"
            "            minimums.append(min(op[1], minimums[-1]) if minimums else op[1])\n"
            "        elif name == 'pop':\n"
            "            values.pop()\n"
            "            minimums.pop()\n"
            "        elif name == 'top':\n"
            "            results.append(values[-1])\n"
            "        else:\n"
            "            results.append(minimums[-1])\n"
            "    return results\n"
        ),
        "test_cases": [
            (([["push", 3], ["push", 5], ["min"], ["push", 2], ["min"], ["pop"], ["min"], ["top"]],), [3, 2, 3, 5]),
            (([["push", 1], ["top"]],), [1]),
            (([],), []),
            (([["push", 1], ["pop"]],), []),
            (([["push", 2], ["push", 2], ["push", 1], ["min"], ["pop"], ["min"], ["pop"], ["min"]],), [1, 2, 2]),
            (([["push", -1], ["push", -3], ["min"], ["top"], ["pop"], ["min"], ["top"]],), [-3, -3, -1, -1]),
            (([["push", 5], ["push", 4], ["push", 3], ["pop"], ["pop"], ["min"]],), [5]),
            (([["push", 1], ["push", 2], ["push", 3], ["min"], ["top"], ["pop"], ["top"], ["min"]],), [1, 3, 2, 1]),
            (([["push", 0], ["min"], ["push", 0], ["pop"], ["min"]],), [0, 0]),
            (([["push", 3], ["push", 1], ["push", 2], ["pop"], ["min"], ["pop"], ["min"], ["pop"], ["push", 9], ["min"], ["top"]],), [1, 3, 9, 9]),
            (([["push", 7], ["push", 7], ["pop"], ["min"]],), [7]),
            (([["push", 10], ["push", -10], ["min"], ["pop"], ["min"]],), [-10, 10]),
            (([["push", 4], ["push", 8], ["top"], ["pop"], ["top"]],), [8, 4]),
        ],
    },
    {
        "id": "P53_valid_sudoku",
        "title": "Validate a Sudoku Board",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function valid_sudoku(board) that takes a 9 by 9 Sudoku board as a list of 9 strings of 9 "
            "characters each. A character is a digit from '1' to '9' or '.' for an empty cell. Return True if no "
            "digit repeats within any row, within any column, or within any of the nine 3 by 3 boxes (rows 0 to 2, "
            "3 to 5 and 6 to 8 crossed with columns 0 to 2, 3 to 5 and 6 to 8), and False otherwise. Only the "
            "filled cells are checked: a board that follows these rules is valid even if it could never be "
            "completed. An empty board is valid, and a row such as '5.5......' makes the board invalid."
        ),
        "func_name": "valid_sudoku",
        "rubric": _RUBRIC,
        "reference_solution": (
            "def valid_sudoku(board):\n"
            "    rows = [set() for _ in range(9)]\n"
            "    columns = [set() for _ in range(9)]\n"
            "    boxes = [set() for _ in range(9)]\n"
            "    for r in range(9):\n"
            "        for c in range(9):\n"
            "            digit = board[r][c]\n"
            "            if digit == '.':\n"
            "                continue\n"
            "            box = (r // 3) * 3 + c // 3\n"
            "            if digit in rows[r] or digit in columns[c] or digit in boxes[box]:\n"
            "                return False\n"
            "            rows[r].add(digit)\n"
            "            columns[c].add(digit)\n"
            "            boxes[box].add(digit)\n"
            "    return True\n"
        ),
        "test_cases": [
            ((_SUDOKU_PARTIAL,), True),
            ((_with(_SUDOKU_PARTIAL, 0, 2, "5"),), False),
            ((_with(_SUDOKU_PARTIAL, 8, 0, "5"),), False),
            ((_with(_SUDOKU_PARTIAL, 0, 2, "6"),), False),
            ((_SUDOKU_EMPTY,), True),
            ((_SUDOKU_SOLVED,), True),
            ((_with(_SUDOKU_SOLVED, 0, 0, "3"),), False),
            ((_with(_with(_SUDOKU_EMPTY, 0, 0, "1"), 4, 4, "1"),), True),
            ((_with(["12345678."] + ["........."] * 8, 1, 8, "9"),), True),
            ((_with(_with(_SUDOKU_EMPTY, 6, 6, "1"), 8, 8, "1"),), False),
            ((_with(_with(_SUDOKU_EMPTY, 3, 0, "7"), 3, 8, "7"),), False),
            ((_with(_with(_SUDOKU_EMPTY, 0, 5, "2"), 8, 5, "2"),), False),
        ],
    },
    {
        "id": "P54_largest_rectangle_histogram",
        "title": "Largest Rectangle in a Histogram",
        "category": "Data Structures",
        "difficulty": "hard",
        "statement": (
            "Write a function largest_rectangle(heights) that takes a list of non-negative integers, the heights "
            "of adjacent histogram bars that each have width 1. Return the area of the largest rectangle that fits "
            "inside the histogram, where the rectangle covers a run of consecutive bars and its height cannot be "
            "taller than the shortest bar in that run. For heights = [2, 1, 5, 6, 2, 3] the answer is 10, from the "
            "bars of height 5 and 6 (height 5, width 2). An empty list gives 0. A solution that runs in linear "
            "time is expected."
        ),
        "func_name": "largest_rectangle",
        "rubric": _RUBRIC_EFF,
        "reference_solution": (
            "def largest_rectangle(heights):\n"
            "    best = 0\n"
            "    stack = []  # indices of bars with strictly increasing heights\n"
            "    for i, height in enumerate(list(heights) + [0]):\n"
            "        start = i\n"
            "        while stack and stack[-1][1] >= height:\n"
            "            start, top = stack.pop()\n"
            "            best = max(best, top * (i - start))\n"
            "        stack.append((start, height))\n"
            "    return best\n"
        ),
        "test_cases": [
            (([2, 1, 5, 6, 2, 3],), 10),
            (([],), 0),
            (([5],), 5),
            (([0],), 0),
            (([2, 4],), 4),
            (([1, 1, 1, 1],), 4),
            (([6, 5, 4, 3, 2, 1],), 12),
            (([1, 2, 3, 4, 5, 6],), 12),
            (([0, 9, 0, 9],), 9),
            (([2, 1, 2],), 3),
            (([3, 6, 5, 7, 4, 8, 1, 0],), 20),
            (([5, 5, 1, 7, 1, 1, 5, 2, 7, 6],), 12),
            (([4, 2, 0, 3, 2, 5],), 6),
        ],
    },
    {
        "id": "P55_sliding_window_maximum",
        "title": "Sliding Window Maximum",
        "category": "Data Structures",
        "difficulty": "hard",
        "statement": (
            "Write a function sliding_window_max(nums, k) that takes a non-empty list of integers nums and a "
            "window size k with 1 <= k <= len(nums). The window starts at the left end of the list and moves one "
            "position to the right each step until it reaches the right end. Return a list with the largest value "
            "inside the window at every position, so the result has len(nums) - k + 1 entries. For "
            "nums = [1, 3, -1, -3, 5] and k = 3 the answer is [3, 3, 5]. A solution that runs in linear time is "
            "expected."
        ),
        "func_name": "sliding_window_max",
        "rubric": _RUBRIC_EFF,
        "reference_solution": (
            "from collections import deque\n\n"
            "def sliding_window_max(nums, k):\n"
            "    maxima = []\n"
            "    candidates = deque()  # indices in the window, values non-increasing\n"
            "    for i, value in enumerate(nums):\n"
            "        while candidates and nums[candidates[-1]] <= value:\n"
            "            candidates.pop()\n"
            "        candidates.append(i)\n"
            "        if candidates[0] <= i - k:\n"
            "            candidates.popleft()\n"
            "        if i >= k - 1:\n"
            "            maxima.append(nums[candidates[0]])\n"
            "    return maxima\n"
        ),
        "test_cases": [
            (([1, 3, -1, -3, 5, 3, 6, 7], 3), [3, 3, 5, 5, 6, 7]),
            (([1], 1), [1]),
            (([1, -1], 1), [1, -1]),
            (([9, 11], 2), [11]),
            (([4, 3, 2, 1], 2), [4, 3, 2]),
            (([1, 2, 3, 4], 2), [2, 3, 4]),
            (([2, 2, 2], 2), [2, 2]),
            (([5, 1, 1, 1, 1], 3), [5, 1, 1]),
            (([-4, -2, -5, -1], 3), [-2, -1]),
            (([7, 2, 4], 3), [7]),
            (([1, 3, 1, 2, 0, 5], 3), [3, 3, 2, 5]),
            (([8, 7, 6, 5, 4, 3], 4), [8, 7, 6]),
            (([1, 3, 1, 2, 0, 5], 1), [1, 3, 1, 2, 0, 5]),
        ],
    },
    {
        "id": "P56_word_break",
        "title": "Word Break",
        "category": "Data Structures",
        "difficulty": "medium",
        "statement": (
            "Write a function word_break(s, words) that takes a lowercase string s and a list of non-empty "
            "lowercase words. Return True if s can be split into a sequence of one or more words from the list, "
            "placed one after another with nothing left over, and False otherwise. A word may be used any number "
            "of times. For s = 'applepie' and words = ['apple', 'pie'] the answer is True, and for s = 'abc' and "
            "words = ['ab', 'bc'] it is False. The empty string can always be split (into zero words), so it "
            "gives True."
        ),
        "func_name": "word_break",
        "rubric": _RUBRIC,
        "reference_solution": (
            "def word_break(s, words):\n"
            "    word_set = set(words)\n"
            "    lengths = {len(word) for word in word_set}\n"
            "    reachable = [False] * (len(s) + 1)  # reachable[i]: s[:i] can be split\n"
            "    reachable[0] = True\n"
            "    for end in range(1, len(s) + 1):\n"
            "        for length in lengths:\n"
            "            if length <= end and reachable[end - length] and s[end - length:end] in word_set:\n"
            "                reachable[end] = True\n"
            "                break\n"
            "    return reachable[len(s)]\n"
        ),
        "test_cases": [
            (("applepie", ["apple", "pie"]), True),
            (("", ["a"]), True),
            (("catsandog", ["cats", "dog", "sand", "and", "cat"]), False),
            (("catsanddog", ["cats", "dog", "sand", "and", "cat"]), True),
            (("aaaaaaa", ["aaaa", "aaa"]), True),
            (("aaaaaaa", ["aaaa", "aa"]), False),
            (("abcd", ["a", "abc", "b", "cd"]), True),
            (("a", []), False),
            (("ab", ["a", "b"]), True),
            (("cars", ["car", "ca", "rs"]), True),
            (("goalspecial", ["go", "goal", "goals", "special"]), True),
            (("abc", ["ab", "bc"]), False),
            (("abcd", ["ab", "abc", "cd"]), True),
            (("x", ["x", "x"]), True),
        ],
    },
]
