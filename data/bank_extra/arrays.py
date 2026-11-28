# -*- coding: utf-8 -*-
"""Bank-only problems (no buggy submissions). Format: see data/bank_extra/__init__.py."""

PROBLEMS = [
    {
        "id": "P27_max_subarray_sum",
        "title": "Maximum Subarray Sum",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function max_subarray_sum(nums) that takes a non-empty list of integers and returns the largest sum of any contiguous, non-empty run of elements. For nums = [1, -2, 3, 4], the answer is 7 (the run 3, 4). If every number is negative, the answer is the least negative one, so for nums = [-3, -1, -2] it is -1.",
        "func_name": "max_subarray_sum",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def max_subarray_sum(nums):
    best = current = nums[0]
    for value in nums[1:]:
        current = max(value, current + value)
        best = max(best, current)
    return best
''',
        "test_cases": [
            (([1, -2, 3, 4],), 7),
            (([5],), 5),
            (([-3, -1, -2],), -1),
            (([-4],), -4),
            (([2, 3, 4],), 9),
            (([0, 0, 0],), 0),
            (([-2, 1, -3, 4, -1, 2, 1, -5, 4],), 6),
            (([4, -1, 2, 1],), 6),
            (([-1, 5, -10, 6],), 6),
            (([8, -19, 5, -4, 20],), 21),
            (([1, -1, 1, -1, 1],), 1),
            (([-5, 2],), 2),
            (([3, -4, 2, -1, 6, -10, 1],), 7),
        ],
    },
    {
        "id": "P28_move_zeroes",
        "title": "Move Zeroes to the End",
        "category": "Arrays & Search",
        "difficulty": "easy",
        "statement": "Write a function move_zeroes(nums) that returns a new list containing the same numbers as nums, with every 0 moved to the end. The non-zero numbers must keep their original relative order. For nums = [0, 1, 0, 3], the result is [1, 3, 0, 0]. The input list should not be changed.",
        "func_name": "move_zeroes",
        "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def move_zeroes(nums):
    non_zeros = [value for value in nums if value != 0]
    zero_count = len(nums) - len(non_zeros)
    return non_zeros + [0] * zero_count
''',
        "test_cases": [
            (([0, 1, 0, 3],), [1, 3, 0, 0]),
            (([],), []),
            (([0],), [0]),
            (([7],), [7]),
            (([0, 0, 0],), [0, 0, 0]),
            (([1, 2, 3],), [1, 2, 3]),
            (([3, 0, 2, 0, 1],), [3, 2, 1, 0, 0]),
            (([0, 0, 5],), [5, 0, 0]),
            (([4, 4, 0, 4],), [4, 4, 4, 0]),
            (([-1, 0, -2, 0],), [-1, -2, 0, 0]),
            (([5, 3, 0],), [5, 3, 0]),
            (([2, 1, 0, 0, 3, 0, 1],), [2, 1, 3, 1, 0, 0, 0]),
        ],
    },
    {
        "id": "P29_remove_duplicates_sorted",
        "title": "Remove Duplicates from Sorted List",
        "category": "Arrays & Search",
        "difficulty": "easy",
        "statement": "Write a function remove_duplicates_sorted(nums) that takes a list of integers sorted in non-decreasing order and returns a new list in which each value appears only once, still in sorted order. For nums = [1, 1, 2, 3, 3], the result is [1, 2, 3]. An empty list gives an empty list.",
        "func_name": "remove_duplicates_sorted",
        "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def remove_duplicates_sorted(nums):
    unique = []
    for value in nums:
        if not unique or value != unique[-1]:
            unique.append(value)
    return unique
''',
        "test_cases": [
            (([1, 1, 2, 3, 3],), [1, 2, 3]),
            (([],), []),
            (([4],), [4]),
            (([2, 2, 2, 2],), [2]),
            (([1, 2, 3],), [1, 2, 3]),
            (([-3, -3, -1, 0, 0, 5],), [-3, -1, 0, 5]),
            (([0, 0, 1, 1, 1, 2, 2, 3, 3, 4],), [0, 1, 2, 3, 4]),
            (([1, 1],), [1]),
            (([1, 2],), [1, 2]),
            (([5, 6, 6, 7, 7, 7, 8],), [5, 6, 7, 8]),
            (([-2, -2, -2, -1],), [-2, -1]),
            (([1, 2, 2],), [1, 2]),
        ],
    },
    {
        "id": "P30_rotate_array",
        "title": "Rotate List to the Right",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function rotate_array(nums, k) that returns a new list with nums rotated to the right by k positions, where k is a non-negative integer that may be larger than the length of the list. Rotating right by one moves the last element to the front. For nums = [1, 2, 3, 4, 5] and k = 2, the result is [4, 5, 1, 2, 3]. An empty list stays empty for any k.",
        "func_name": "rotate_array",
        "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def rotate_array(nums, k):
    if not nums:
        return []
    shift = k % len(nums)
    if shift == 0:
        return list(nums)
    return nums[-shift:] + nums[:-shift]
''',
        "test_cases": [
            (([1, 2, 3, 4, 5], 2), [4, 5, 1, 2, 3]),
            (([1, 2, 3], 0), [1, 2, 3]),
            (([], 3), []),
            (([9], 4), [9]),
            (([1, 2, 3], 3), [1, 2, 3]),
            (([1, 2, 3], 4), [3, 1, 2]),
            (([1, 2, 3, 4, 5, 6, 7], 3), [5, 6, 7, 1, 2, 3, 4]),
            (([1, 2], 1), [2, 1]),
            (([1, 2, 3, 4], 10), [3, 4, 1, 2]),
            (([-1, -100, 3, 99], 2), [3, 99, -1, -100]),
            (([1, 2, 3, 4, 5], 1), [5, 1, 2, 3, 4]),
            (([1, 2, 3, 4, 5], 4), [2, 3, 4, 5, 1]),
            (([1, 1, 2], 1), [2, 1, 1]),
        ],
    },
    {
        "id": "P31_best_time_to_buy_stock",
        "title": "Best Time to Buy and Sell Stock",
        "category": "Arrays & Search",
        "difficulty": "easy",
        "statement": "Write a function best_time_to_buy_stock(prices) where prices[i] is the price of a stock on day i. You may buy on one day and sell on a later day, once only. Return the largest profit you can make, or 0 if no profitable trade exists. For prices = [7, 1, 5, 3, 6, 4], the answer is 5 (buy at 1, sell at 6). For prices = [5, 4, 3], the answer is 0.",
        "func_name": "best_time_to_buy_stock",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def best_time_to_buy_stock(prices):
    best_profit = 0
    lowest_price = None
    for price in prices:
        if lowest_price is None or price < lowest_price:
            lowest_price = price
        else:
            best_profit = max(best_profit, price - lowest_price)
    return best_profit
''',
        "test_cases": [
            (([7, 1, 5, 3, 6, 4],), 5),
            (([5, 4, 3],), 0),
            (([],), 0),
            (([6],), 0),
            (([1, 2],), 1),
            (([2, 1],), 0),
            (([3, 3, 3],), 0),
            (([1, 2, 3, 4, 5],), 4),
            (([2, 4, 1],), 2),
            (([3, 2, 6, 5, 0, 3],), 4),
            (([10, 1, 2, 9, 0, 3],), 8),
            (([0, 5, 0, 7],), 7),
            (([9, 1, 8, 2, 7],), 7),
        ],
    },
    {
        "id": "P32_product_except_self",
        "title": "Product of Array Except Self",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function product_except_self(nums) that returns a list result of the same length as nums, where result[i] is the product of all elements of nums except nums[i]. Do not use division, because nums may contain zeros. For nums = [1, 2, 3, 4], the result is [24, 12, 8, 6]. For nums = [5], the result is [1], since the product of no numbers is 1.",
        "func_name": "product_except_self",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def product_except_self(nums):
    size = len(nums)
    result = [1] * size
    prefix = 1
    for i in range(size):
        result[i] = prefix
        prefix *= nums[i]
    suffix = 1
    for i in range(size - 1, -1, -1):
        result[i] *= suffix
        suffix *= nums[i]
    return result
''',
        "test_cases": [
            (([1, 2, 3, 4],), [24, 12, 8, 6]),
            (([5],), [1]),
            (([],), []),
            (([2, 3],), [3, 2]),
            (([0, 1, 2, 3],), [6, 0, 0, 0]),
            (([1, 0, 3, 0],), [0, 0, 0, 0]),
            (([-1, 1, 0, -3, 3],), [0, 0, 9, 0, 0]),
            (([-2, 3, -4],), [-12, 8, -6]),
            (([1, 1, 1],), [1, 1, 1]),
            (([0],), [1]),
            (([2, 2, 2, 2],), [8, 8, 8, 8]),
            (([4, 0],), [0, 4]),
            (([3, -1, 2],), [-2, 6, -3]),
        ],
    },
    {
        "id": "P33_container_most_water",
        "title": "Container With Most Water",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function container_most_water(heights) where heights[i] is the height of a vertical wall standing at position i. Choose two different walls i < j to form a container; its water capacity is (j - i) * min(heights[i], heights[j]). Return the largest capacity over all pairs, or 0 if there are fewer than two walls. For heights = [1, 8, 6, 2, 5, 4, 8, 3, 7], the answer is 49. For heights = [3, 4], the answer is 3.",
        "func_name": "container_most_water",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def container_most_water(heights):
    left, right = 0, len(heights) - 1
    best = 0
    while left < right:
        width = right - left
        best = max(best, width * min(heights[left], heights[right]))
        if heights[left] < heights[right]:
            left += 1
        else:
            right -= 1
    return best
''',
        "test_cases": [
            (([1, 8, 6, 2, 5, 4, 8, 3, 7],), 49),
            (([3, 4],), 3),
            (([],), 0),
            (([5],), 0),
            (([1, 1],), 1),
            (([0, 0, 0],), 0),
            (([4, 3, 2, 1, 4],), 16),
            (([1, 2, 1],), 2),
            (([2, 3, 10, 5, 7, 8, 9],), 36),
            (([1, 2, 4, 3],), 4),
            (([10, 1, 1, 1, 1, 1, 1, 10],), 70),
            (([9, 8, 7, 6, 5],), 20),
            (([1, 2, 3, 4, 5],), 6),
            (([6, 0, 0, 0, 6],), 24),
        ],
    },
    {
        "id": "P34_three_sum",
        "title": "Three Sum",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function three_sum(nums) that returns every distinct triplet [a, b, c] of values from nums that adds up to 0, using three different positions of the list. Each triplet must be sorted in ascending order, no triplet may appear twice, and the list of triplets must itself be sorted in ascending order. For nums = [-1, 0, 1, 2, -1, -4], the result is [[-1, -1, 2], [-1, 0, 1]]. If there is no such triplet, return an empty list.",
        "func_name": "three_sum",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def three_sum(nums):
    ordered = sorted(nums)
    triplets = []
    for i in range(len(ordered) - 2):
        if i > 0 and ordered[i] == ordered[i - 1]:
            continue
        left, right = i + 1, len(ordered) - 1
        while left < right:
            total = ordered[i] + ordered[left] + ordered[right]
            if total < 0:
                left += 1
            elif total > 0:
                right -= 1
            else:
                triplets.append([ordered[i], ordered[left], ordered[right]])
                left += 1
                right -= 1
                while left < right and ordered[left] == ordered[left - 1]:
                    left += 1
    return triplets
''',
        "test_cases": [
            (([-1, 0, 1, 2, -1, -4],), [[-1, -1, 2], [-1, 0, 1]]),
            (([],), []),
            (([0],), []),
            (([0, 0],), []),
            (([0, 0, 0],), [[0, 0, 0]]),
            (([0, 0, 0, 0, 0],), [[0, 0, 0]]),
            (([1, 2, 3],), []),
            (([-1, 0, 1],), [[-1, 0, 1]]),
            (([-2, 0, 1, 1, 2],), [[-2, 0, 2], [-2, 1, 1]]),
            (([3, -2, 1, 0, -1, 2, -3],), [[-3, 0, 3], [-3, 1, 2], [-2, -1, 3], [-2, 0, 2], [-1, 0, 1]]),
            (([-1, -1, -1, 2, 2],), [[-1, -1, 2]]),
            (([-4, -2, -2, -2, 0, 1, 2, 2, 2, 3, 3, 4, 4, 6, 6],), [[-4, -2, 6], [-4, 0, 4], [-4, 1, 3], [-4, 2, 2], [-2, -2, 4], [-2, 0, 2]]),
            (([-5, 2, 3, 5, -1],), [[-5, 2, 3]]),
            (([2, -1, -1],), [[-1, -1, 2]]),
        ],
    },
    {
        "id": "P35_search_rotated_sorted_array",
        "title": "Search in Rotated Sorted List",
        "category": "Arrays & Search",
        "difficulty": "medium",
        "statement": "Write a function search_rotated_sorted_array(nums, target) where nums holds distinct integers that were sorted in ascending order and then rotated, so that a suffix of the sorted list was moved to the front (for example [4, 5, 6, 7, 0, 1, 2]). Return the index of target in nums, or -1 if it is not there. For nums = [4, 5, 6, 7, 0, 1, 2] and target = 0, the answer is 4. The intended solution runs in O(log n) time.",
        "func_name": "search_rotated_sorted_array",
        "rubric": {"correctness": 50, "efficiency": 25, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def search_rotated_sorted_array(nums, target):
    low, high = 0, len(nums) - 1
    while low <= high:
        mid = (low + high) // 2
        if nums[mid] == target:
            return mid
        if nums[low] <= nums[mid]:
            if nums[low] <= target < nums[mid]:
                high = mid - 1
            else:
                low = mid + 1
        else:
            if nums[mid] < target <= nums[high]:
                low = mid + 1
            else:
                high = mid - 1
    return -1
''',
        "test_cases": [
            (([4, 5, 6, 7, 0, 1, 2], 0), 4),
            (([4, 5, 6, 7, 0, 1, 2], 3), -1),
            (([], 5), -1),
            (([1], 1), 0),
            (([1], 0), -1),
            (([3, 1], 1), 1),
            (([3, 1], 3), 0),
            (([1, 2, 3, 4, 5], 4), 3),
            (([9, 11, 15, 2, 4, 6], 10), -1),
            (([4, 5, 6, 7, 0, 1, 2], 4), 0),
            (([4, 5, 6, 7, 0, 1, 2], 2), 6),
            (([6, 7, 8, 1, 2, 3, 4, 5], 8), 2),
            (([6, 7, 8, 1, 2, 3, 4, 5], 1), 3),
            (([-3, -1, 4, 9, -8, -6], -6), 5),
            (([8, 9, 2, 3, 4, 5, 6, 7], 10), -1),
            (([8, 9, 2, 3, 4, 5, 6, 7], 1), -1),
            (([8, 9, 2, 3, 4, 5, 6, 7], 7), 7),
        ],
    },
    {
        "id": "P36_trapping_rain_water",
        "title": "Trapping Rain Water",
        "category": "Arrays & Search",
        "difficulty": "hard",
        "statement": "Write a function trapping_rain_water(heights) where heights[i] is the height of a bar of width 1 at position i, and every height is a non-negative integer. After rain, water collects in the gaps between bars. Return the total units of water held. The water above position i is min(tallest bar at or left of i, tallest bar at or right of i) minus heights[i]. For heights = [3, 0, 2], the answer is 2. For heights = [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1], the answer is 6.",
        "func_name": "trapping_rain_water",
        "rubric": {"correctness": 55, "efficiency": 20, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": '''def trapping_rain_water(heights):
    left, right = 0, len(heights) - 1
    left_max = right_max = 0
    water = 0
    while left < right:
        if heights[left] < heights[right]:
            left_max = max(left_max, heights[left])
            water += left_max - heights[left]
            left += 1
        else:
            right_max = max(right_max, heights[right])
            water += right_max - heights[right]
            right -= 1
    return water
''',
        "test_cases": [
            (([3, 0, 2],), 2),
            (([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1],), 6),
            (([],), 0),
            (([5],), 0),
            (([2, 5],), 0),
            (([1, 2, 3, 4],), 0),
            (([4, 3, 2, 1],), 0),
            (([4, 2, 0, 3, 2, 5],), 9),
            (([2, 0, 2],), 2),
            (([3, 3, 3],), 0),
            (([5, 0, 0, 0, 5],), 15),
            (([5, 2, 1, 2, 1, 5],), 14),
            (([1, 0, 2, 0, 1],), 2),
            (([6, 1, 4, 0, 3],), 6),
        ],
    },
]
