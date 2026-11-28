# -*- coding: utf-8 -*-
"""Bank-only problems (no buggy submissions). Format: see data/bank_extra/__init__.py."""

_R = {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10}
_R_EFF = {"correctness": 50, "efficiency": 25, "code_style": 15, "edge_case_handling": 10}

PROBLEMS = [
    {
        "id": "P17_longest_common_prefix",
        "title": "Longest Common Prefix",
        "category": "Strings",
        "difficulty": "easy",
        "statement": (
            "Write a function longest_common_prefix(strs) that takes a list of strings and returns the longest "
            "string that is a prefix of every string in the list. If the strings share no prefix, or the list is "
            "empty, return an empty string. For strs = [\"flower\", \"flow\", \"flight\"] the answer is \"fl\", and "
            "for strs = [\"dog\", \"car\"] the answer is \"\"."
        ),
        "func_name": "longest_common_prefix",
        "rubric": _R,
        "reference_solution": (
            "def longest_common_prefix(strs):\n"
            "    if not strs:\n"
            "        return \"\"\n"
            "    prefix = strs[0]\n"
            "    for word in strs[1:]:\n"
            "        while not word.startswith(prefix):\n"
            "            prefix = prefix[:-1]\n"
            "    return prefix\n"
        ),
        "test_cases": [
            ((["flower", "flow", "flight"],), "fl"),
            ((["dog", "racecar", "car"],), ""),
            (([],), ""),
            ((["alone"],), "alone"),
            ((["", "abc"],), ""),
            ((["abc", ""],), ""),
            ((["same", "same", "same"],), "same"),
            ((["ab", "abc", "abcd"],), "ab"),
            ((["abcd", "abc", "ab"],), "ab"),
            ((["interview", "internet", "interval", "internal"],), "inter"),
            ((["a", "b"],), ""),
            ((["aaa", "aa", "aaaa"],), "aa"),
            ((["xyz", "xyw", "xya"],), "xy"),
        ],
    },
    {
        "id": "P18_reverse_words",
        "title": "Reverse Words in a Sentence",
        "category": "Strings",
        "difficulty": "easy",
        "statement": (
            "Write a function reverse_words(s) that takes a string s made of words separated by spaces and "
            "returns the words in reverse order, joined by exactly one space. The input may have leading, "
            "trailing or repeated spaces, and none of them should appear in the result. For s = \"the sky is "
            "blue\" the answer is \"blue is sky the\", and for s = \"  hello   world  \" the answer is "
            "\"world hello\". A string with no words gives \"\"."
        ),
        "func_name": "reverse_words",
        "rubric": _R,
        "reference_solution": (
            "def reverse_words(s):\n"
            "    words = s.split()\n"
            "    return \" \".join(reversed(words))\n"
        ),
        "test_cases": [
            (("the sky is blue",), "blue is sky the"),
            (("  hello   world  ",), "world hello"),
            (("",), ""),
            (("   ",), ""),
            (("single",), "single"),
            ((" single ",), "single"),
            (("a b",), "b a"),
            (("a  b   c",), "c b a"),
            (("one two three four five",), "five four three two one"),
            (("   leading",), "leading"),
            (("trailing   ",), "trailing"),
            (("x y x",), "x y x"),
            (("abc def",), "def abc"),
        ],
    },
    {
        "id": "P19_run_length_encode",
        "title": "Run Length Encoding",
        "category": "Strings",
        "difficulty": "easy",
        "statement": (
            "Write a function run_length_encode(s) that compresses a string of lowercase letters by replacing "
            "each run of the same letter with the letter followed by the length of the run. Always write the "
            "count, even when it is 1. For s = \"aaabcc\" the answer is \"a3b1c2\", and for s = \"abab\" the "
            "answer is \"a1b1a1b1\". Runs longer than 9 use all their digits, so twelve a's give \"a12\". The "
            "empty string gives \"\"."
        ),
        "func_name": "run_length_encode",
        "rubric": _R,
        "reference_solution": (
            "def run_length_encode(s):\n"
            "    parts = []\n"
            "    i = 0\n"
            "    while i < len(s):\n"
            "        j = i\n"
            "        while j < len(s) and s[j] == s[i]:\n"
            "            j += 1\n"
            "        parts.append(s[i] + str(j - i))\n"
            "        i = j\n"
            "    return \"\".join(parts)\n"
        ),
        "test_cases": [
            (("aaabcc",), "a3b1c2"),
            (("",), ""),
            (("a",), "a1"),
            (("abab",), "a1b1a1b1"),
            (("aaaaaaaaaaaa",), "a12"),
            (("z" * 103,), "z103"),
            (("aabbaa",), "a2b2a2"),
            (("abc",), "a1b1c1"),
            (("aaaaaaaaaab",), "a10b1"),
            (("baaaaaaaaa",), "b1a9"),
            (("xxyyyz",), "x2y3z1"),
            (("mississippi",), "m1i1s2i1s2i1p2i1"),
        ],
    },
    {
        "id": "P20_first_unique_char",
        "title": "First Non-Repeating Character",
        "category": "Strings",
        "difficulty": "easy",
        "statement": (
            "Write a function first_unique_char(s) that returns the index of the first character in s that "
            "appears exactly once in the whole string. If every character repeats, or s is empty, return -1. "
            "For s = \"leetcode\" the answer is 0, for s = \"loveleetcode\" the answer is 2, and for "
            "s = \"aabb\" the answer is -1."
        ),
        "func_name": "first_unique_char",
        "rubric": _R,
        "reference_solution": (
            "def first_unique_char(s):\n"
            "    counts = {}\n"
            "    for ch in s:\n"
            "        counts[ch] = counts.get(ch, 0) + 1\n"
            "    for index, ch in enumerate(s):\n"
            "        if counts[ch] == 1:\n"
            "            return index\n"
            "    return -1\n"
        ),
        "test_cases": [
            (("leetcode",), 0),
            (("loveleetcode",), 2),
            (("aabb",), -1),
            (("",), -1),
            (("a",), 0),
            (("aa",), -1),
            (("aab",), 2),
            (("abcabcd",), 6),
            (("abba",), -1),
            (("abbac",), 4),
            (("zxyzx",), 2),
            (("aabbccdde",), 8),
            (("xaax",), -1),
        ],
    },
    {
        "id": "P21_isomorphic_strings",
        "title": "Isomorphic Strings",
        "category": "Strings",
        "difficulty": "easy",
        "statement": (
            "Write a function is_isomorphic(s, t) that returns True when the characters of s can be replaced "
            "one for one to produce t, and False otherwise. Every occurrence of a character must be replaced "
            "by the same character, and two different characters of s may not be replaced by the same "
            "character. A character may be replaced by itself. The strings have the same length. For s = "
            "\"egg\" and t = \"add\" the answer is True, for s = \"foo\" and t = \"bar\" it is False, and for "
            "s = \"ab\" and t = \"aa\" it is False."
        ),
        "func_name": "is_isomorphic",
        "rubric": _R,
        "reference_solution": (
            "def is_isomorphic(s, t):\n"
            "    forward = {}\n"
            "    backward = {}\n"
            "    for a, b in zip(s, t):\n"
            "        if forward.setdefault(a, b) != b:\n"
            "            return False\n"
            "        if backward.setdefault(b, a) != a:\n"
            "            return False\n"
            "    return True\n"
        ),
        "test_cases": [
            (("egg", "add"), True),
            (("foo", "bar"), False),
            (("ab", "aa"), False),
            (("aa", "ab"), False),
            (("", ""), True),
            (("a", "b"), True),
            (("paper", "title"), True),
            (("badc", "baba"), False),
            (("abc", "abc"), True),
            (("abca", "zbxz"), True),
            (("abca", "zbxy"), False),
            (("abab", "cdcd"), True),
            (("abab", "cccc"), False),
            (("13", "42"), True),
        ],
    },
    {
        "id": "P22_longest_substring_no_repeat",
        "title": "Longest Substring Without Repeating Characters",
        "category": "Strings",
        "difficulty": "medium",
        "statement": (
            "Write a function length_of_longest_substring(s) that returns the length of the longest "
            "contiguous piece of s in which no character appears twice. For s = \"abcabcbb\" the answer is 3 "
            "(the piece \"abc\"), for s = \"bbbbb\" the answer is 1, and for s = \"pwwkew\" the answer is 3 "
            "(the piece \"wke\"). Note that a piece must be contiguous, so \"pwke\" does not count. The empty "
            "string gives 0. The string can be long, so aim for a single pass."
        ),
        "func_name": "length_of_longest_substring",
        "rubric": _R_EFF,
        "reference_solution": (
            "def length_of_longest_substring(s):\n"
            "    last_seen = {}\n"
            "    start = 0\n"
            "    best = 0\n"
            "    for index, ch in enumerate(s):\n"
            "        if ch in last_seen and last_seen[ch] >= start:\n"
            "            start = last_seen[ch] + 1\n"
            "        last_seen[ch] = index\n"
            "        best = max(best, index - start + 1)\n"
            "    return best\n"
        ),
        "test_cases": [
            (("abcabcbb",), 3),
            (("bbbbb",), 1),
            (("pwwkew",), 3),
            (("",), 0),
            (("a",), 1),
            (("au",), 2),
            (("dvdf",), 3),
            (("abba",), 2),
            (("tmmzuxt",), 5),
            (("abcdef",), 6),
            (("aab",), 2),
            (("cdd",), 2),
            (("abcb",), 3),
            (("a b a",), 3),
        ],
    },
    {
        "id": "P23_longest_palindromic_substring",
        "title": "Longest Palindromic Substring",
        "category": "Strings",
        "difficulty": "medium",
        "statement": (
            "Write a function longest_palindrome(s) that returns the longest contiguous substring of s that "
            "reads the same forwards and backwards. If several palindromic substrings share the longest "
            "length, return the one that starts earliest in s. For s = \"babad\" the answer is \"bab\" "
            "(\"aba\" has the same length but starts later), for s = \"cbbd\" the answer is \"bb\", and for "
            "s = \"abc\" the answer is \"a\". The empty string gives \"\"."
        ),
        "func_name": "longest_palindrome",
        "rubric": _R,
        "reference_solution": (
            "def longest_palindrome(s):\n"
            "    best_start, best_len = 0, 0\n"
            "    for center in range(2 * len(s) - 1):\n"
            "        left = center // 2\n"
            "        right = left + center % 2\n"
            "        while left >= 0 and right < len(s) and s[left] == s[right]:\n"
            "            left -= 1\n"
            "            right += 1\n"
            "        length = right - left - 1\n"
            "        if length > best_len:\n"
            "            best_start, best_len = left + 1, length\n"
            "    return s[best_start:best_start + best_len]\n"
        ),
        "test_cases": [
            (("babad",), "bab"),
            (("cbbd",), "bb"),
            (("abc",), "a"),
            (("",), ""),
            (("a",), "a"),
            (("aa",), "aa"),
            (("racecar",), "racecar"),
            (("forgeeksskeegfor",), "geeksskeeg"),
            (("abacdfgdcaba",), "aba"),
            (("abcbaxyzzyx",), "xyzzyx"),
            (("xabbay",), "abba"),
            (("aaaa",), "aaaa"),
            (("abcdcbefe",), "bcdcb"),
            (("ac",), "a"),
            (("aabaa" + "c",), "aabaa"),
            (("abb",), "bb"),
            (("cabab",), "aba"),
        ],
    },
    {
        "id": "P24_decode_string",
        "title": "Decode Nested Repeats",
        "category": "Strings",
        "difficulty": "medium",
        "statement": (
            "Write a function decode_string(s) that expands an encoded string. The encoding k[text] means the "
            "text inside the brackets is repeated k times, where k is a positive integer that may have more "
            "than one digit. Encodings can be nested, and plain letters can appear anywhere between them. The "
            "input is always well formed, contains only lowercase letters, digits and square brackets, and "
            "digits appear only as repeat counts. For s = \"3[a]2[bc]\" the answer is \"aaabcbc\", and for "
            "s = \"2[a2[b]]c\" the answer is \"abbabbc\"."
        ),
        "func_name": "decode_string",
        "rubric": _R,
        "reference_solution": (
            "def decode_string(s):\n"
            "    stack = []\n"
            "    current = \"\"\n"
            "    count = 0\n"
            "    for ch in s:\n"
            "        if ch.isdigit():\n"
            "            count = count * 10 + int(ch)\n"
            "        elif ch == \"[\":\n"
            "            stack.append((current, count))\n"
            "            current, count = \"\", 0\n"
            "        elif ch == \"]\":\n"
            "            previous, repeat = stack.pop()\n"
            "            current = previous + current * repeat\n"
            "        else:\n"
            "            current += ch\n"
            "    return current\n"
        ),
        "test_cases": [
            (("3[a]2[bc]",), "aaabcbc"),
            (("2[a2[b]]c",), "abbabbc"),
            (("",), ""),
            (("abc",), "abc"),
            (("1[x]",), "x"),
            (("10[a]",), "aaaaaaaaaa"),
            (("2[ab]3[c]d",), "ababcccd"),
            (("a2[b]c",), "abbc"),
            (("2[2[2[a]]]",), "aaaaaaaa"),
            (("3[a2[c]]",), "accaccacc"),
            (("2[a]2[b]",), "aabb"),
            (("x3[y]z",), "xyyyz"),
            (("12[ab]",), "ab" * 12),
            (("2[]a",), "a"),
            (("2[ab3[c]]",), "abcccabccc"),
        ],
    },
    {
        "id": "P25_min_window_substring",
        "title": "Minimum Window Substring",
        "category": "Strings",
        "difficulty": "hard",
        "statement": (
            "Write a function min_window(s, t) that returns the shortest contiguous substring of s that "
            "contains every character of t, counting repeats: if t has two a's, the window needs at least two "
            "a's. If several windows share the shortest length, return the leftmost one. If no window works, "
            "or t is empty, return \"\". For s = \"ADOBECODEBANC\" and t = \"ABC\" the answer is \"BANC\", for "
            "s = \"aa\" and t = \"aa\" the answer is \"aa\", and for s = \"a\" and t = \"aa\" the answer is "
            "\"\". Uppercase and lowercase letters are different characters. Aim for a single pass over s."
        ),
        "func_name": "min_window",
        "rubric": _R_EFF,
        "reference_solution": (
            "def min_window(s, t):\n"
            "    if not t:\n"
            "        return \"\"\n"
            "    need = {}\n"
            "    for ch in t:\n"
            "        need[ch] = need.get(ch, 0) + 1\n"
            "    missing = len(t)\n"
            "    best_start, best_len = 0, len(s) + 1\n"
            "    left = 0\n"
            "    for right, ch in enumerate(s):\n"
            "        if need.get(ch, 0) > 0:\n"
            "            missing -= 1\n"
            "        need[ch] = need.get(ch, 0) - 1\n"
            "        while missing == 0:\n"
            "            if right - left + 1 < best_len:\n"
            "                best_start, best_len = left, right - left + 1\n"
            "            need[s[left]] += 1\n"
            "            if need[s[left]] > 0:\n"
            "                missing += 1\n"
            "            left += 1\n"
            "    return s[best_start:best_start + best_len] if best_len <= len(s) else \"\"\n"
        ),
        "test_cases": [
            (("ADOBECODEBANC", "ABC"), "BANC"),
            (("aa", "aa"), "aa"),
            (("a", "aa"), ""),
            (("a", "a"), "a"),
            (("a", "b"), ""),
            (("", "a"), ""),
            (("abc", ""), ""),
            (("abc", "cba"), "abc"),
            (("aab", "ab"), "ab"),
            (("abab", "ab"), "ab"),
            (("bba", "ab"), "ba"),
            (("aaflslflsldkalskaaa", "aaa"), "aaa"),
            (("xyzabcxyz", "zx"), "xyz"),
            (("Aa", "a"), "a"),
            (("cabwefgewcwaefgcf", "cae"), "cwae"),
        ],
    },
    {
        "id": "P26_edit_distance",
        "title": "Edit Distance",
        "category": "Strings",
        "difficulty": "hard",
        "statement": (
            "Write a function edit_distance(word1, word2) that returns the smallest number of single "
            "character edits needed to turn word1 into word2. An edit is one of: insert a character, delete a "
            "character, or replace a character with another. For word1 = \"horse\" and word2 = \"ros\" the "
            "answer is 3 (replace h with r, delete r, delete e), and for word1 = \"kitten\" and word2 = "
            "\"sitting\" the answer is 3. Turning \"\" into \"abc\" takes 3 insertions. Both strings may be "
            "empty."
        ),
        "func_name": "edit_distance",
        "rubric": _R_EFF,
        "reference_solution": (
            "def edit_distance(word1, word2):\n"
            "    previous = list(range(len(word2) + 1))\n"
            "    for i, a in enumerate(word1, start=1):\n"
            "        current = [i]\n"
            "        for j, b in enumerate(word2, start=1):\n"
            "            if a == b:\n"
            "                current.append(previous[j - 1])\n"
            "            else:\n"
            "                current.append(1 + min(previous[j - 1], previous[j], current[j - 1]))\n"
            "        previous = current\n"
            "    return previous[-1]\n"
        ),
        "test_cases": [
            (("horse", "ros"), 3),
            (("kitten", "sitting"), 3),
            (("", ""), 0),
            (("", "abc"), 3),
            (("abc", ""), 3),
            (("abc", "abc"), 0),
            (("a", "b"), 1),
            (("intention", "execution"), 5),
            (("abc", "yabd"), 2),
            (("sunday", "saturday"), 3),
            (("ab", "ba"), 2),
            (("abcdef", "azced"), 3),
            (("aaa", "a"), 2),
            (("flaw", "lawn"), 2),
        ],
    },
]
