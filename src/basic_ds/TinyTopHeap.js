/**
 * - This is manual min heap for top-k problem.
 * - We do not use built-in sort for ranking part.
 * - Keep only k best rows to save memory.
 */
class TinyTopHeap {
  constructor(limit, getScore) {
    this.limit = Math.max(0, Number(limit) || 0);
    this.getScore = getScore;
    this.heap = [];
  }

  add(item) {
    if (this.limit <= 0) {
      return;
    }

    const score = this.#safeScore(this.getScore(item));
    const node = { item, score };

    // Fill heap first.
    if (this.heap.length < this.limit) {
      this.heap.push(node);
      this.#moveUp(this.heap.length - 1);
      return;
    }

    // Root is smallest score in min heap.
    if (score <= this.heap[0].score) {
      return;
    }

    // Replace root if new score is better.
    this.heap[0] = node;
    this.#moveDown(0);
  }

  getHighToLow() {
    // We pop from min heap and fill from back side.
    const saved = this.heap.slice();
    const out = new Array(saved.length);
    let write = saved.length - 1;
    while (this.heap.length > 0) {
      const popped = this.#popSmallest();
      out[write] = popped.item;
      write -= 1;
    }
    this.heap = saved;
    return out;
  }

  #safeScore(value) {
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  }

  #parentIndex(i) {
    return Math.floor((i - 1) / 2);
  }

  #leftIndex(i) {
    return 2 * i + 1;
  }

  #rightIndex(i) {
    return 2 * i + 2;
  }

  #swap(i, j) {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }

  #moveUp(index) {
    let i = index;
    while (i > 0) {
      const p = this.#parentIndex(i);
      if (this.heap[p].score <= this.heap[i].score) {
        break;
      }
      this.#swap(i, p);
      i = p;
    }
  }

  #moveDown(index) {
    let i = index;
    while (true) {
      const left = this.#leftIndex(i);
      const right = this.#rightIndex(i);
      let small = i;

      if (left < this.heap.length && this.heap[left].score < this.heap[small].score) {
        small = left;
      }
      if (right < this.heap.length && this.heap[right].score < this.heap[small].score) {
        small = right;
      }
      if (small === i) {
        break;
      }
      this.#swap(i, small);
      i = small;
    }
  }

  #popSmallest() {
    if (this.heap.length === 1) {
      return this.heap.pop();
    }
    const root = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.#moveDown(0);
    return root;
  }
}

module.exports = { TinyTopHeap };
