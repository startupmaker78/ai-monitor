// Pre-emit PII filter — placeholder.
//
// rrweb 2.0 (@rrweb/record 2.0.0-alpha.20) does NOT expose a
// `beforeAddRecordingEvent` hook. The available `hooks` parameter only fires
// AFTER an event is recorded, which is too late to mutate the payload.
//
// Built-in defenses already wired up in rrweb-config.ts:
//   - maskInputOptions covers password / email / tel / number inputs;
//   - blockSelector, maskTextSelector, ignoreSelector let site owners
//     opt-in via `.wm-block / .wm-mask / .wm-ignore` markers.
//
// In commit 4-part-3/8 we'll either:
//   - use rrweb's `maskInputFn` / `maskTextFn` for value-level scrubbing
//     (regex over Authorization tokens, JWTs, query-string secrets), or
//   - post-process events server-side before persisting to Object Storage.
//
// This file is kept as a reminder so the next commit knows where this
// belongs.

export {}
