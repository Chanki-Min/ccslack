export class CancelMap {
  private readonly map = new Map<string, AbortController>();

  register(ts: string): AbortSignal {
    this.map.get(ts)?.abort();
    const controller = new AbortController();
    this.map.set(ts, controller);
    return controller.signal;
  }

  cancel(ts: string): boolean {
    const controller = this.map.get(ts);
    if (!controller) return false;
    this.map.delete(ts);
    controller.abort();
    return true;
  }

  unregister(ts: string): void {
    this.map.delete(ts);
  }
}
