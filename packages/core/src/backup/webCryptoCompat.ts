/**
 * TypeScript 5.7+ made `Uint8Array` generic over its backing buffer type
 * (`Uint8Array<ArrayBufferLike>`), while the Web Crypto / DOM types still expect the narrower
 * `Uint8Array<ArrayBuffer>` (via `BufferSource`). `@types/node`'s global augmentations widen the
 * inferred type to `ArrayBufferLike`, so plain `Uint8Array` values from `new Uint8Array(...)`,
 * `.slice()`, `.subarray()` etc. stop structurally matching `BufferSource` under `--strict`,
 * even though they are always backed by a real `ArrayBuffer` at runtime in this codebase. `bs`
 * is a zero-cost type-only bridge for that mismatch — not a runtime conversion.
 */
export function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}
