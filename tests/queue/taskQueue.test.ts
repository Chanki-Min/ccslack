import { describe, expect, it } from "bun:test";
import { TaskQueue } from "../../src/queue/taskQueue";

describe("TaskQueue", () => {
  it("executes tasks up to concurrency limit", async () => {
    const queue = new TaskQueue(2);
    const order: number[] = [];

    const task = (id: number, ms: number) => async () => {
      order.push(id);
      await new Promise((r) => setTimeout(r, ms));
      return `done-${id}`;
    };

    const p1 = queue.enqueue(task(1, 50));
    const p2 = queue.enqueue(task(2, 50));
    const p3 = queue.enqueue(task(3, 10));

    // Tasks 1 and 2 start immediately, task 3 waits
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns task result", async () => {
    const queue = new TaskQueue(1);
    const result = await queue.enqueue(async () => "hello");
    expect(result).toBe("hello");
  });

  it("propagates errors", async () => {
    const queue = new TaskQueue(1);
    expect(
      queue.enqueue(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
  });

  it("reports pending count", () => {
    const queue = new TaskQueue(1);
    expect(queue.pendingCount).toBe(0);

    // Enqueue a long task to fill the slot
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    // This one should be pending
    queue.enqueue(async () => {});

    expect(queue.pendingCount).toBe(1);
  });

  it("rejects when queue is full", async () => {
    const queue = new TaskQueue(1, 2);

    // Fill the concurrency slot
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // Fill queue slots
    queue.enqueue(async () => {});
    queue.enqueue(async () => {});

    // This should be rejected
    expect(queue.enqueue(async () => {})).rejects.toThrow("Queue is full");
  });
});
