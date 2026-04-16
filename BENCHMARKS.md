# Benchmarks

Measurements from `tests/performance/benchmark.test.ts`. Run them yourself with:

```bash
npx vitest run tests/performance/benchmark.test.ts --reporter=verbose
```

## Environment

- CPU: Intel Core i7-10510U @ 1.80 GHz (4C/8T, laptop-class)
- OS: Windows 11, Node.js 24.14.0
- Tree-sitter: WASM bindings (`web-tree-sitter` 0.20.8)
- Reported values are p50/p95 across 20+ warm iterations after a 5-run JIT/WASM warmup

## Results

| Scenario | Payload | Runs | p50 | p95 | Notes |
|---|---|---:|---:|---:|---|
| `pipeline.anonymize()` small | 55 chars, 1 class + 1 password | 20 | **96 ms** | 128 ms | Dominated by Tree-sitter WASM identifier extraction |
| `pipeline.anonymize()` medium | 1819 chars, 20x repeated class | 20 | **141 ms** | 182 ms | AST cost scales sub-linearly, regex/replace adds a tail |
| `pipeline.rehydrate()` | SSE-sized 50-chunk response | 100 | **0.22 ms** | 0.35 ms | Offset-based single pass with pure-original protection |

Variance across runs sits in the 10-20 ms band for anonymize (shared-tenant CPU jitter) and under ±0.05 ms for rehydrate.

## What this means

- **~100 ms p50 is the realistic floor** on a laptop-class CPU. For typical chat turns (a few hundred characters of code context) the proxy adds roughly 100 ms of latency per request. LLM APIs respond in 500-3000 ms, so the proxy is 3-20 % of total request time depending on upstream latency.
- **Rehydration is effectively free** at 0.2 ms. Even for long streaming responses with hundreds of pseudonyms, the rehydration cost stays well below network jitter.
- **AST parsing dominates.** Most of the p50 is Tree-sitter WASM parse + identifier walk. Payload size moves the number (55 → 1819 chars adds ~40 ms p50) but the fixed WASM-entry cost is the larger component.

## SSE streaming caveat

SSE responses go through a per-content-block sliding-buffer rehydrator so pseudonyms split across deltas (`Alpha` | `Corp` | `Service`) are reassembled before rehydration. The buffer is sized to `2 × max_pseudonym_length + 50` characters per active block and floored at 64. In practice this means the first visible text in a stream lags by up to the buffer size (typically ~60-150 chars) compared to a zero-rehydration passthrough. The lag does not accumulate — once the prefix is emitted, subsequent deltas flow at normal speed minus the trailing suffix, which is flushed on `content_block_stop` / `[DONE]`. Overhead of the buffer logic itself is <1 ms per typical assistant turn.

## What is not measured here

- **Concurrent load**: single-threaded Node event loop. 50 concurrent requests sharing one `Pipeline` will queue. For multi-user deployments, run multiple instances behind a load balancer.
- **Large responses**: the SSE buffer flush at 1 MB and the 50 MB response cap limit how large a single rehydration gets. Measure in your environment if you regularly receive multi-megabyte LLM responses.
- **Pattern-heavy secrets-only workloads**: the benchmark exercises all three layers. A proxy that only needs secret redaction (no identity or AST) would run faster — use `SecretsLayer` directly for that path.
- **Cold-start cost**: the first `anonymize()` call pays ~150-300 ms for WASM initialization. The 5-run warmup excludes this. Production deployments should pre-warm with a dummy request after startup.

## Performance budget

These are the targets asserted in the test suite:

| Test | Budget | Typical p50 |
|---|---|---|
| Small anonymize | < 500 ms | 96 ms |
| Medium anonymize | < 500 ms | 141 ms |
| Rehydrate | < 5 ms | 0.22 ms |

The generous budget reflects real-world CI variance (GitHub runners hit 250-400 ms for the same payload due to shared-tenant CPU). If you tighten the budget, expect occasional flakes on cold CI machines.
