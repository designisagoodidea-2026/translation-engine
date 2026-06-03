// Tiny reactive state pattern — no framework. The whole prototype is a single
// scrolling page; whenever state changes, we re-render the affected sections.
// Subscribers register a render function; mutations notify them.

type Listener = () => void;

export class Store<T> {
  private listeners = new Set<Listener>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(updater: Partial<T> | ((prev: T) => T)): void {
    if (typeof updater === 'function') {
      this.value = (updater as (prev: T) => T)(this.value);
    } else {
      this.value = { ...this.value, ...updater };
    }
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
