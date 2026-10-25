import type { RsbuildPlugin } from "@rsbuild/core";
import { pluginBabel, type PluginBabelOptions } from "@rsbuild/plugin-babel";

/**
 * Options that every Solid Lynx build shares.
 *
 * A Lynx app is compiled to a universal render tree rather than DOM output, so
 * the JSX transform has to emit `createComponent`/`insert` calls against this
 * package instead of the DOM helpers in `solid-js/web`. Getting that wrong
 * produces a bundle that builds and then renders nothing at runtime, which is
 * why the settings live in one place instead of in each app's config.
 */
export interface SolidLynxPluginOptions {
  /**
   * Package that owns the universal JSX runtime. Defaults to
   * `@apothic-ai/solid-lynx`, the name this package is published under.
   */
  moduleName?: string;
  /**
   * Component generation mode. Lynx renders through the universal renderer, so
   * this defaults to `universal`; the other modes are inherited from
   * `babel-preset-solid` and are not meant for Lynx targets.
   */
  generate?: "universal" | "dom" | "ssr" | "hydrate";
  /** Lynx has no server-rendered markup to adopt, so hydration is off. */
  hydratable?: boolean;
  /**
   * Events `babel-preset-solid` delegates at runtime. Lynx binds events through
   * the Element PAPI instead, so nothing is delegated by default.
   */
  delegateEvents?: string[];
  /** Files the Solid JSX transform runs on. Defaults to `.jsx` and `.tsx`. */
  include?: PluginBabelOptions["include"];
  /**
   * Escape hatch for app-specific babel-loader options. Runs after the Solid
   * preset is added, so it can inspect or replace it.
   */
  babelLoaderOptions?: PluginBabelOptions["babelLoaderOptions"];
}

/** The subset of babel-loader options this package reads or writes. */
export interface BabelLoaderOptionBag {
  presets?: unknown[] | null;
}

/**
 * The `babel-preset-solid` entry this package adds to a babel-loader option
 * bag, exported so a build can be asserted without running Rspack.
 */
export function solidLynxBabelPreset(options: SolidLynxPluginOptions = {}): {
  preset: string;
  options: Record<string, unknown>;
} {
  const {
    moduleName = "@apothic-ai/solid-lynx",
    generate = "universal",
    hydratable = false,
    delegateEvents = [],
  } = options;

  return {
    preset: "babel-preset-solid",
    options: { moduleName, generate, hydratable, delegateEvents },
  };
}

/**
 * Puts the Solid JSX transform at the front of a babel-loader option bag.
 *
 * The preset runs first so an app's own plugins and presets see the universal
 * output instead of raw JSX.
 */
export function applySolidLynxBabelPreset(
  loaderOptions: BabelLoaderOptionBag,
  options: SolidLynxPluginOptions = {},
): void {
  const { preset, options: presetOptions } = solidLynxBabelPreset(options);
  loaderOptions.presets ??= [];
  loaderOptions.presets.unshift([preset, presetOptions]);
}

/**
 * Applies an Rsbuild config-chain value, which may be a plain value, a
 * function, or an array of either.
 */
type LoaderOptionsMutator = (value: BabelLoaderOptionBag) => void;

function applyConfigChain(
  chain: PluginBabelOptions["babelLoaderOptions"],
  value: BabelLoaderOptionBag,
): void {
  if (!chain) return;
  for (const entry of Array.isArray(chain) ? chain : [chain]) {
    if (typeof entry === "function") (entry as unknown as LoaderOptionsMutator)(value);
  }
}

/**
 * The babel-loader callback this package registers: it adds the Solid JSX
 * transform and then hands the options to the app's own callback.
 *
 * Exported so the wiring can be asserted without starting an Rspack build.
 */
export function solidLynxBabelLoaderOptions(options: SolidLynxPluginOptions = {}): (
  loaderOptions: BabelLoaderOptionBag,
) => void {
  return loaderOptions => {
    applySolidLynxBabelPreset(loaderOptions, options);
    applyConfigChain(options.babelLoaderOptions, loaderOptions);
  };
}

/**
 * Rsbuild plugins that compile Solid JSX for a Lynx target.
 *
 * Spread or nest these next to `pluginLynx()` and `pluginVanillaLynx()`:
 *
 * ```ts
 * export default defineConfig({
 *   plugins: [pluginLynx(), pluginVanillaLynx({ entries }), pluginSolidLynx()],
 * });
 * ```
 *
 * The Lynx engine plugins are deliberately not included: they describe threads
 * and entries, which every app declares differently, while everything Solid
 * specific is fixed here.
 */
export function pluginSolidLynx(options: SolidLynxPluginOptions = {}): RsbuildPlugin[] {
  const { include = /\.[jt]sx$/ } = options;

  return [
    pluginBabel({
      include,
      babelLoaderOptions: solidLynxBabelLoaderOptions(options),
    }),
  ];
}