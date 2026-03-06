export class CancelMap {
  private readonly map = new Map<string, AbortController>();

  register(ts: string): AbortSignal {
    const controller = new AbortController();
    this.map.set(ts, controller);
    return controller.signal;
  }

  cancel(ts: string): boolean {
    const controller = this.map.get(ts);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  unregister(ts: string): void {
    this.map.delete(ts);
  }
}
