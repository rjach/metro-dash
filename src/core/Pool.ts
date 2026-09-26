/**
 * Generic free-list object pool. Endless runners spawn and discard thousands of
 * entities per session; recycling keeps GC pauses out of the frame budget.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void = () => undefined,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(this.make());
  }

  acquire(): T {
    return this.free.pop() ?? this.make();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
  }

  get totalCreated(): number {
    return this.created;
  }

  get available(): number {
    return this.free.length;
  }

  private make(): T {
    this.created++;
    return this.factory();
  }
}
