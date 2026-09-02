---
title: The MCP sidecar
description: corvid-mcp — expose a corvid store to agentic tools over MCP on stdio; the 29 tools, schema tools, search parameters, and wire details.
sidebar:
  order: 7
---

`corvid-mcp` exposes a store to agentic tools (Claude Code, Codex, Cursor,
VSCode/JetBrains MCP clients) over **MCP — JSON-RPC on stdio**. It embeds the
engine; all protocol code lives in the sidecar, never in the engine.

```sh
cargo run -p corvid-mcp -- app.corvid      # file-backed; omit path for in-memory
```

Release binaries ship for Linux (x86_64 + aarch64), macOS (Intel + Apple
Silicon), and Windows (x86_64) — or build from source. Point an MCP client
at the binary.

## The tools (29)

`store`, `patch`, `compare_and_set`, `get`, `delete`, `delete_where`,
`page`, `search`, `phrase_search`, `count`, `geo`, `join`, `link`, `unlink`,
`neighbors`, `in_neighbors`, `traverse`, `create_index`,
`create_text_index`, `create_scalar_index`, `create_compound_index`,
`create_geo_index`, `backup`, `dump`, `load`, `list_collections`,
`insert_auto`, `set_schema`, `get_schema`.

Each mirrors its engine operation with default result caps (list tools clamp
oversized limits to 10,000).

## `search` — the hybrid builder as JSON

```json
{ "filter": { ... }, "vector": { ... }, "text": { ... },
  "mmr": 0.7, "rrf_k": 60, "select": ["title"], "limit": 10 }
```

The [query builder](/language/query-builder/) as one tool call — filter plus
vector and/or text sources, RRF and MMR knobs, projection, limit. Ranking
arguments are validated exactly as in Rust (`BadParams` on garbage).

## `set_schema` / `get_schema`

`set_schema` declares (or replaces) a collection's schema — a fields array
of `{name, type (any|bool|int|float|text|bytes|vector|array|map),
required?, unique?}` — validated on subsequent stores (type and required
violations, duplicate unique values). `get_schema` returns the declared
fields, or `{fields: null}` when none is declared; `fields: []` is a
declared empty schema (distinct from undeclared). Present-but-non-boolean
flags are `BadParams` errors naming the flag.

## Value conversion

JSON ↔ engine values convert through explicit wrappers where JSON is
ambiguous: `{"$vector": [...]}` for vectors, `{"$bytes": "..."}` for bytes.
Int/float distinction survives; u64 beyond i64 is lossy through f64; vector
components are f32. Nested wrappers work; malformed wrappers fall back to
maps.

## Wire details

- Envelope methods: `initialize`, `ping`, `tools/list` (all 29 with JSON
  schemas), `tools/call`. Notifications produce no response.
- Framing: line-delimited JSON-RPC on stdio, blank/CRLF lines ignored, frame
  size capped (`MAX_FRAME_SIZE`; over-limit frames refused, session
  survives).
- Errors: `UnknownTool`, `BadParams` (bad/missing params), `Engine` (typed
  engine errors, name-keyed).

## In-process testing

The sidecar's whole surface is covered by an in-process duplex-I/O suite (78
tests) — `Server::handle` is transport-agnostic, so the MCP layer is tested
without a process boundary. The surface manifests behind it are the source
of the [construct reference](/reference/constructs/)'s MCP section.

Next: [performance](/performance/overview/).
