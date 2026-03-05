type Task<T> = () => Promise<T>;

interface QueueItem {
  task: Task<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class TaskQueue {
  private readonly maxConcurrency: number;
  private running = 0;
  private queue: QueueItem[] = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }

  enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift()!;
    this.running++;

    item
      .task()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.running--;
        this.processNext();
      });
  }
}
