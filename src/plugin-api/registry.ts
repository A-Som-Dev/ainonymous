import { assertDetectorPlugin, type DetectorPlugin, type DetectorContext, type DetectionHit } from './index.js';

export interface RegisteredDetector {
  plugin: DetectorPlugin;
  path?: string;
}

export class DetectorRegistry {
  private detectors: RegisteredDetector[] = [];

  register(plugin: DetectorPlugin, path?: string): void {
    // Re-assert here so embedders that bypass loadConfiguredDetectors and
    // poke the registry directly still hit the same id-pattern + shape gate.
    assertDetectorPlugin(plugin);
    this.detectors.push({ plugin, path });
  }

  clear(): void {
    this.detectors = [];
  }

  list(): readonly RegisteredDetector[] {
    return this.detectors;
  }

  /** Runs every detector that declares one of `capabilities`. Errors from a
   *  single plugin are caught so one bad module cannot tear down a Layer
   *  pass - the offending id is logged once by the caller via `onError`.
   *  All hits returned here are namespaced as `plugin:<id>:<type>` so the
   *  Layer 1/2 audit trail keeps Plugin provenance and so a Plugin cannot
   *  spoof a built-in type name to bypass `disabledDetectorIds`. */
  async detectByCapability(
    capabilities: DetectorPlugin['capabilities'][number][],
    input: string,
    ctx: DetectorContext,
    onError?: (id: string, err: unknown) => void,
  ): Promise<DetectionHit[]> {
    if (this.detectors.length === 0) return [];
    const interested = this.detectors.filter((r) =>
      r.plugin.capabilities.some((c) => capabilities.includes(c)),
    );
    if (interested.length === 0) return [];
    const runs = await Promise.all(
      interested.map(async (r) => {
        try {
          const out = await r.plugin.detect(input, ctx);
          if (!Array.isArray(out)) return [] as DetectionHit[];
          return out.map((h) => ({ ...h, type: `plugin:${r.plugin.id}:${h.type}` }));
        } catch (err) {
          onError?.(r.plugin.id, err);
          return [] as DetectionHit[];
        }
      }),
    );
    return runs.flat();
  }
}
