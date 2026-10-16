# Emitter

`lib/emitter.js`, used by the editor core and by `RagInstance` (#47).

```
class Emitter {
  on(type: string, fn: (payload) => void): () => void   returns an unsubscribe function
  off(type: string, fn): void
  emit(type: string, payload?): void
  clear(): void                                          removes every listener
}
```

- Listeners run synchronously, in subscription order, with one payload argument. A function is registered at most once per type.
- `emit` iterates a copy of the listener list: listeners added or removed during an emit take effect on the next one.
- Every listener runs even if one throws; the first error is rethrown after the last listener.
- No wildcard types, no `once`, no async.
