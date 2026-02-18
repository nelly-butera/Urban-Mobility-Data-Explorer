# Manual Algorithm: Top-K with Custom Min Heap

## Why we made this
For these endpoints:
- `/api/profitability/top-zones`
- `/api/flow/top-routes`

We need top N rows by score.
We do not use built-in sort helper for final ranking logic.

## Custom data structure
- File: `src/basic_ds/TinyTopHeap.js`
- Wrapper use: `src/work_steps/TopZonePicker.js`

## Simple idea
1. Keep a min heap with only `k` rows.
2. First, fill heap until size is `k`.
3. After that, compare new score with heap root (smallest score).
4. If new score is bigger, replace root and fix heap.
5. At end, pop heap and build descending result.

This is better than sorting all rows when we only need top few.

## Pseudo-code
```text
FUNCTION GET_TOP_K(rows, k, score_fn):
    heap = empty min_heap

    FOR each row IN rows:
        score = score_fn(row)
        IF heap.size < k:
            heap.push(row, score)
        ELSE IF score > heap.min().score:
            heap.replace_min(row, score)

    result = array(size = heap.size)
    i = heap.size - 1
    WHILE heap not empty:
        result[i] = heap.pop_min().row
        i = i - 1

    RETURN result
```

## Complexity
- `n` = number of candidate rows
- `k` = top limit requested
- Time: `O(n log k)`
- Space: `O(k)`
