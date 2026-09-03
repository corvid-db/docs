---
title: corvid-swift
description: The corvid-swift binding — the Swift package for Apple platforms (iOS 13+ device/simulator, macOS) over the engine's prebuilt CorvidEngine.xcframework, no shim (Swift consumes the C ABI directly), throws + CorvidError with the frozen engine codes, and the golden-suite correctness story.
sidebar:
  order: 11
---

[`corvid-swift`](https://github.com/corvid-db/corvid-swift) is the
Swift binding for **Apple platforms** — iOS 13+ (device and simulator,
arm64 + x86_64) and macOS 10.15+ (arm64 + x86_64). One Swift Package,
installed by URL, nothing else: the wrapper calls the engine's frozen
C ABI directly through the clang module formed from the prebuilt
**`CorvidEngine.xcframework`** (iOS device + fat iOS-simulator + fat
macOS staticlib slices) that every engine release publishes. The
engine is **statically linked** — no dynamic loading, no symbol
search paths — and the pin is double: the binary target's URL tag
plus its sha256 checksum, both verified by the binding's release gate
against the engine release's own checksums.

**When to choose this binding:** your project is Swift on iOS or
macOS and you want corvid embedded with the platform's own shape —
`throws`/`CorvidError` carrying the engine's frozen error codes,
`deinit`-based handle lifetimes, `Data` keys, `[String: Any?]`
documents, and closures for scan/update (a throwing closure aborts
the engine call and rethrows at the call site).

## Install

Swift Package Manager — the package URL is the repository:

```swift
dependencies: [
    .package(url: "https://github.com/corvid-db/corvid-swift.git", from: "0.4.1")
]
```

```swift
.target(name: "App", dependencies: [
    .product(name: "Corvid", package: "corvid-swift"),
])
```

Requires Xcode 16+ / a Swift 6 toolchain (the package itself builds
in the Swift 5 language mode). No other dependencies. Platform scope:
iOS + macOS slices ship today; watchOS/visionOS/tvOS are a recorded,
additive follow-up in the binding's PLAN.

## The API in one screen

```swift
import Corvid

let db = try Corvid.openMemory()
let docs = try db.collection("docs")

try docs.insert(
    Data("s1".utf8),
    ["kind": "doc",
     "body": "rust embedded database",
     "v": [1.0, 0.0] as [Float]] as [String: Any?])

let rows = Array(try docs.query()
    .filter(try field("kind").eq("doc"))
    .vector("v", [1.0, 0.0], k: 2, metric: .cosine)
    .run())

let phrase = Array(try docs.phraseSearch(
    field: "body", phrase: "embedded database", k: 2))

db.close() // deinit also closes; Db/Collection are thread-safe
```

Documents are Swift values: `[String: Any?]` maps and `[Any?]`
arrays whose leaves are `Bool`, `Int`, `UInt` (by bit pattern),
`Double`, `Float`, `String`, `Data`, and `[Float]` vectors — note
that a bare `[1.0, 0.0]` inside a document literal infers `[Double]`
and encodes as an *array*; vectors are `[Float]`, so write
`[1.0, 0.0] as [Float]`. Keys are `Data`. NaNs cross bit-exact both
ways.

## The architecture ruling: SPM binary target, no shim

Per the repo's `docs/PLAN.md`: Swift consumes C natively — unlike
corvid-jvm, whose JNI demands a C shim, the wrapper
(`Sources/Corvid`) imports `CorvidEngine` and calls the 124 frozen
symbols directly. The xcframework carries `corvid.h` plus an umbrella
and module map so SwiftPM forms the clang module; each slice is the
engine's `staticlib` build (bare dylibs outside frameworks are not
supported on iOS — static linking is the Rust-on-Apple norm).

The lifetime mapping is the binding's review center-of-gravity:
opaque handles → `final class`es with `deinit` frees; consumed-by-call
args (predicate trees, query builders) invalidated **before** the
native call whatever its outcome (FFI.md §8's unconditional
consumption — the double-free class cannot happen); borrowed views
copied inside the same call that observed them; `Db`/`Collection`
are `@unchecked Sendable` exactly where the ABI's §6 thread contract
says so, builders and iterators are not. Cursors (`Rows`, `GeoHits`,
`Strs`, `GroupIter`) are single-pass — iterate once.

## Correctness story

The golden-suite port (`Tests/CorvidTests/GoldenTest.swift`) replays
the engine's 8-fixture, 267-executable-line suite through this
binding against the **downloaded** xcframework at the pin — same
grammar, same dispatch, every line, first failure naming file:line.
A deep integration pass covers the surfaces the fixture grammar does
not reach (admin paths, scan aborts, graph, geo, schema, TTL, the
full aggregate set), and a frozen error-code table test pins the
19+1 code mapping. CI runs the suite on macOS plus an iOS-Simulator
compile leg (the simulator slice links), and the surface gate
resolves every engine construct at the pinned tag
(`docs/SURFACE.tsv`: mapped with a proving test, or N/A with a
reason).

Releases ride the engine's cascade: engine tag `vX.Y.Z` → `from:
"X.Y.Z"` here, with the manifest's URL and checksum rewritten in the
same bump PR (`bump.sh` downloads the new zip and re-hashes it — a
stale checksum would break every consumer's resolve).
