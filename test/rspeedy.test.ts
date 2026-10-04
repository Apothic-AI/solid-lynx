import { PLUGIN_BABEL_NAME } from "@rsbuild/plugin-babel";
import { describe, expect, it } from "vitest";

import {
  applySolidLynxBabelPreset,
  pluginSolidLynx,
  solidLynxBabelLoaderOptions,
  solidLynxBabelPreset,
  type BabelLoaderOptionBag,
} from "../src/rspeedy.js";

const universalPreset = {
  moduleName: "solid-lynx",
  generate: "universal",
  hydratable: false,
  delegateEvents: [],
};

describe("pluginSolidLynx", () => {
  it("compiles JSX against this package's universal runtime", () => {
    // The module name decides which JSX runtime the compiled bundle imports, and
    // the generator decides whether it renders through Lynx at all. A wrong
    // default still builds, then renders nothing at runtime.
    expect(solidLynxBabelPreset()).toEqual({
      preset: "babel-preset-solid",
      options: universalPreset,
    });
  });

  it("puts the Solid transform ahead of an app's own presets", () => {
    const loaderOptions: BabelLoaderOptionBag = { presets: [["app-preset", { option: true }]] };

    applySolidLynxBabelPreset(loaderOptions);

    expect(loaderOptions.presets).toEqual([
      ["babel-preset-solid", universalPreset],
      ["app-preset", { option: true }],
    ]);
  });

  it("creates a preset list when the loader has none", () => {
    const loaderOptions: BabelLoaderOptionBag = {};

    applySolidLynxBabelPreset(loaderOptions);

    expect(loaderOptions.presets).toEqual([["babel-preset-solid", universalPreset]]);
  });

  it("passes explicit overrides through to the preset", () => {
    const loaderOptions: BabelLoaderOptionBag = {};

    applySolidLynxBabelPreset(loaderOptions, {
      moduleName: "@scope/solid-lynx",
      generate: "universal",
      hydratable: true,
      delegateEvents: ["click"],
    });

    expect(loaderOptions.presets).toEqual([["babel-preset-solid", {
      moduleName: "@scope/solid-lynx",
      generate: "universal",
      hydratable: true,
      delegateEvents: ["click"],
    }]]);
  });

  it("runs an app's babel-loader options after the Solid transform", () => {
    const order: string[] = [];
    const loaderOptions: BabelLoaderOptionBag = {};

    solidLynxBabelLoaderOptions({
      babelLoaderOptions(options) {
        order.push(`presets:${options.presets?.length ?? 0}`);
        options.presets = [...(options.presets ?? []), ["app-preset", {}]];
      },
    })(loaderOptions);

    expect(order).toEqual(["presets:1"]);
    expect(loaderOptions.presets).toEqual([
      ["babel-preset-solid", universalPreset],
      ["app-preset", {}],
    ]);
  });

  it("registers one Babel plugin", () => {
    const plugins = pluginSolidLynx();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.name).toBe(PLUGIN_BABEL_NAME);
    expect(typeof plugins[0]!.setup).toBe("function");
  });
});