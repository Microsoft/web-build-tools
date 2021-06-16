// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  CachedSource,
  ConcatSource,
  RawSource,
  ReplaceSource,
  Source,
  SourceMapSource
} from 'webpack-sources';
import * as webpack from 'webpack';
import { AsyncSeriesWaterfallHook, SyncWaterfallHook, Tap } from 'tapable';
import {
  CHUNK_MODULES_TOKEN,
  MODULE_WRAPPER_PREFIX,
  MODULE_WRAPPER_SUFFIX,
  STAGE_BEFORE,
  STAGE_AFTER
} from './Constants';
import { getIdentifier } from './MinifiedIdentifier';
import {
  IModuleMinifier,
  IModuleMinifierPluginOptions,
  IModuleMinificationResult,
  IModuleMinificationErrorResult,
  IModuleMap,
  IAssetMap,
  IExtendedModule,
  IModuleMinifierPluginHooks,
  IDehydratedAssets
} from './ModuleMinifierPlugin.types';
import { generateLicenseFileForAsset } from './GenerateLicenseFileForAsset';
import { rehydrateAsset } from './RehydrateAsset';
import { PortableMinifierModuleIdsPlugin } from './PortableMinifierIdsPlugin';
import { createHash } from 'crypto';

// The name of the plugin, for use in taps
const PLUGIN_NAME: 'ModuleMinifierPlugin' = 'ModuleMinifierPlugin';

const TAP_BEFORE: Tap = {
  name: PLUGIN_NAME,
  stage: STAGE_BEFORE
};
const TAP_AFTER: Tap = {
  name: PLUGIN_NAME,
  stage: STAGE_AFTER
};

interface IExtendedChunkTemplate {
  hooks: {
    modules: SyncWaterfallHook<[Source, webpack.compilation.Chunk]>;
  };
}

/**
 * https://github.com/webpack/webpack/blob/30e747a55d9e796ae22f67445ae42c7a95a6aa48/lib/Template.js#L36-47
 * @param a first id to be sorted
 * @param b second id to be sorted against
 * @returns the sort value
 */
function stringifyIdSortPredicate(a: string | number, b: string | number): -1 | 0 | 1 {
  const aId: string = a + '';
  const bId: string = b + '';
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

function hashCodeFragment(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Base implementation of asset rehydration
 *
 * @param dehydratedAssets The dehydrated assets
 * @param compilation The webpack compilation
 */
function defaultRehydrateAssets(
  dehydratedAssets: IDehydratedAssets,
  compilation: webpack.compilation.Compilation
): IDehydratedAssets {
  const { assets, modules } = dehydratedAssets;

  // Now assets/modules contain fully minified code. Rehydrate.
  for (const [assetName, info] of assets) {
    const banner: string = /\.m?js(\?.+)?$/.test(assetName)
      ? generateLicenseFileForAsset(compilation, info, modules)
      : '';

    const outputSource: Source = rehydrateAsset(info, modules, banner);
    compilation.assets[assetName] = outputSource;
  }

  return dehydratedAssets;
}

function isMinificationResultError(
  result: IModuleMinificationResult
): result is IModuleMinificationErrorResult {
  return !!result.error;
}

/**
 * Webpack plugin that minifies code on a per-module basis rather than per-asset. The actual minification is handled by the input `minifier` object.
 * @public
 */
export class ModuleMinifierPlugin implements webpack.Plugin {
  public readonly hooks: IModuleMinifierPluginHooks;
  public minifier: IModuleMinifier;

  private readonly _portableIdsPlugin: PortableMinifierModuleIdsPlugin | undefined;
  private readonly _sourceMap: boolean | undefined;

  public constructor(options: IModuleMinifierPluginOptions) {
    this.hooks = {
      rehydrateAssets: new AsyncSeriesWaterfallHook(['dehydratedContent', 'compilation']),

      finalModuleId: new SyncWaterfallHook(['id']),

      postProcessCodeFragment: new SyncWaterfallHook(['code', 'context'])
    };

    const { minifier, sourceMap, usePortableModules = false } = options;

    if (usePortableModules) {
      this._portableIdsPlugin = new PortableMinifierModuleIdsPlugin(this.hooks);
    }

    this.hooks.rehydrateAssets.tap(PLUGIN_NAME, defaultRehydrateAssets);
    this.minifier = minifier;

    this._sourceMap = sourceMap;
  }

  public apply(compiler: webpack.Compiler): void {
    const { _portableIdsPlugin: stableIdsPlugin } = this;

    const {
      options: { devtool, mode }
    } = compiler;
    // The explicit setting is preferred due to accuracy, but try to guess based on devtool
    const useSourceMaps: boolean =
      typeof this._sourceMap === 'boolean'
        ? this._sourceMap
        : typeof devtool === 'string'
        ? devtool.endsWith('source-map')
        : mode === 'production' && devtool !== false;

    if (stableIdsPlugin) {
      stableIdsPlugin.apply(compiler);
    }

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: webpack.compilation.Compilation) => {
      /**
       * Set of local module ids that have been processed.
       */
      const submittedModules: Set<string | number> = new Set();

      /**
       * The text and comments of all minified modules.
       */
      const minifiedModules: IModuleMap = new Map();

      /**
       * The text and comments of all minified chunks. Most of these are trivial, but the runtime chunk is a bit larger.
       */
      const minifiedAssets: IAssetMap = new Map();

      let pendingMinificationRequests: number = 0;
      /**
       * Indicates that all files have been sent to the minifier and therefore that when pending hits 0, assets can be rehydrated.
       */
      let allRequestsIssued: boolean = false;

      let resolveMinifyPromise: () => void;

      const getRealId: (id: number | string) => number | string | undefined = (id: number | string) =>
        this.hooks.finalModuleId.call(id);

      const postProcessCode: (code: ReplaceSource, context: string) => ReplaceSource = (
        code: ReplaceSource,
        context: string
      ) => this.hooks.postProcessCodeFragment.call(code, context);

      /**
       * Callback to invoke when a file has finished minifying.
       */
      function onFileMinified(): void {
        if (--pendingMinificationRequests === 0 && allRequestsIssued) {
          resolveMinifyPromise();
        }
      }

      /**
       * Callback to invoke for a chunk during render to replace the modules with CHUNK_MODULES_TOKEN
       */
      function dehydrateAsset(modules: Source, chunk: webpack.compilation.Chunk): Source {
        for (const mod of chunk.modulesIterable) {
          if (mod.id === null || !submittedModules.has(mod.id)) {
            console.error(
              `Chunk ${chunk.id} failed to render module ${mod.id} for ${(mod as IExtendedModule).resource}`
            );
          }
        }

        // Discard the rendered modules
        return new RawSource(CHUNK_MODULES_TOKEN);
      }

      const { minifier } = this;

      const cleanupMinifier: (() => Promise<void>) | undefined = minifier.ref && minifier.ref();

      const requestShortener: webpack.compilation.RequestShortener =
        compilation.runtimeTemplate.requestShortener;

      /**
       * Extracts the code for the module and sends it to be minified.
       * Currently source maps are explicitly not supported.
       * @param {Source} source
       * @param {Module} mod
       */
      function minifyModule(source: Source, mod: IExtendedModule): Source {
        const id: string | number | null = mod.id;

        if (id !== null && !submittedModules.has(id)) {
          // options.chunk contains the current chunk, if needed
          // Render the source, then hash, then persist hash -> module, return a placeholder

          // Initially populate the map with unminified version; replace during callback
          submittedModules.add(id);

          const realId: string | number | undefined = getRealId(id);

          if (realId !== undefined && !mod.skipMinification) {
            const wrapped: ConcatSource = new ConcatSource(
              MODULE_WRAPPER_PREFIX + '\n',
              source,
              '\n' + MODULE_WRAPPER_SUFFIX
            );

            const nameForMap: string = `(modules)/${realId}`;

            const { source: wrappedCode, map } = useSourceMaps
              ? wrapped.sourceAndMap()
              : {
                  source: wrapped.source(),
                  map: undefined
                };

            const hash: string = hashCodeFragment(wrappedCode);

            ++pendingMinificationRequests;

            minifier.minify(
              {
                hash,
                code: wrappedCode,
                nameForMap: useSourceMaps ? nameForMap : undefined,
                externals: undefined
              },
              (result: IModuleMinificationResult) => {
                if (isMinificationResultError(result)) {
                  compilation.errors.push(result.error);
                } else {
                  try {
                    // Have the source map display the module id instead of the minifier boilerplate
                    const sourceForMap: string = `// ${mod.readableIdentifier(
                      requestShortener
                    )}${wrappedCode.slice(MODULE_WRAPPER_PREFIX.length, -MODULE_WRAPPER_SUFFIX.length)}`;

                    const { code: minified, map: minifierMap, extractedComments } = result;

                    const rawOutput: Source = useSourceMaps
                      ? new SourceMapSource(
                          minified, // Code
                          nameForMap, // File
                          minifierMap!, // Base source map
                          sourceForMap, // Source from before transform
                          map!, // Source Map from before transform
                          false // Remove original source
                        )
                      : new RawSource(minified);

                    const unwrapped: ReplaceSource = new ReplaceSource(rawOutput);
                    const len: number = minified.length;

                    unwrapped.replace(0, MODULE_WRAPPER_PREFIX.length - 1, '');
                    unwrapped.replace(len - MODULE_WRAPPER_SUFFIX.length, len - 1, '');

                    const withIds: Source = postProcessCode(unwrapped, mod.identifier());

                    minifiedModules.set(realId, {
                      source: new CachedSource(withIds),
                      extractedComments,
                      module: mod
                    });
                  } catch (err) {
                    compilation.errors.push(err);
                  }
                }

                onFileMinified();
              }
            );
          } else {
            // Route any other modules straight through
            minifiedModules.set(realId !== undefined ? realId : id, {
              source: new CachedSource(postProcessCode(new ReplaceSource(source), mod.identifier())),
              extractedComments: [],
              module: mod
            });
          }
        }

        // Return something so that this stage still produces valid ECMAScript
        return new RawSource('(function(){})');
      }

      // During code generation, send the generated code to the minifier and replace with a placeholder
      compilation.moduleTemplates.javascript.hooks.package.tap(TAP_AFTER, minifyModule);

      // This should happen before any other tasks that operate during optimizeChunkAssets
      compilation.hooks.optimizeChunkAssets.tapPromise(
        TAP_BEFORE,
        async (chunks: webpack.compilation.Chunk[]): Promise<void> => {
          // Still need to minify the rendered assets
          for (const chunk of chunks) {
            const externals: string[] = [];
            const externalNames: Map<string, string> = new Map();

            const chunkModuleSet: Set<string | number> = new Set();
            const allChunkModules: Iterable<IExtendedModule> =
              chunk.modulesIterable as Iterable<IExtendedModule>;
            let hasNonNumber: boolean = false;
            for (const mod of allChunkModules) {
              if (mod.id !== null) {
                if (typeof mod.id !== 'number') {
                  hasNonNumber = true;
                }
                chunkModuleSet.add(mod.id);

                if (mod.external) {
                  const key: string = `__WEBPACK_EXTERNAL_MODULE_${webpack.Template.toIdentifier(
                    `${mod.id}`
                  )}__`;
                  // The first two identifiers are used for function (module, exports) at the module site
                  const ordinal: number = 2 + externals.length;
                  const miniId: string = getIdentifier(ordinal);
                  externals.push(key);
                  externalNames.set(key, miniId);
                }
              }
            }

            const chunkModules: (string | number)[] = Array.from(chunkModuleSet);
            // Sort by id before rehydration in case we rehydrate a given chunk multiple times
            chunkModules.sort(
              hasNonNumber
                ? stringifyIdSortPredicate
                : (x: string | number, y: string | number) => (x as number) - (y as number)
            );

            for (const assetName of chunk.files) {
              const asset: Source = compilation.assets[assetName];

              // Verify that this is a JS asset
              if (/\.m?js(\?.+)?$/.test(assetName)) {
                ++pendingMinificationRequests;

                const rawCode: string = asset.source() as string;
                const nameForMap: string = `(chunks)/${assetName}`;

                const hash: string = hashCodeFragment(rawCode);

                minifier.minify(
                  {
                    hash,
                    code: rawCode,
                    nameForMap: useSourceMaps ? nameForMap : undefined,
                    externals
                  },
                  (result: IModuleMinificationResult) => {
                    if (isMinificationResultError(result)) {
                      compilation.errors.push(result.error);
                      console.error(result.error);
                    } else {
                      try {
                        const { code: minified, map: minifierMap, extractedComments } = result;

                        let codeForMap: string = rawCode;
                        if (useSourceMaps) {
                          // Pretend the __WEBPACK_CHUNK_MODULES__ token is an array of module ids, so that the source map contains information about the module ids in the chunk
                          codeForMap = codeForMap.replace(
                            CHUNK_MODULES_TOKEN,
                            JSON.stringify(chunkModules, undefined, 2)
                          );
                        }

                        const rawOutput: Source = useSourceMaps
                          ? new SourceMapSource(
                              minified, // Code
                              nameForMap, // File
                              minifierMap!, // Base source map
                              codeForMap, // Source from before transform
                              undefined, // Source Map from before transform
                              false // Remove original source
                            )
                          : new RawSource(minified);

                        const withIds: Source = postProcessCode(new ReplaceSource(rawOutput), assetName);

                        minifiedAssets.set(assetName, {
                          source: new CachedSource(withIds),
                          extractedComments,
                          modules: chunkModules,
                          chunk,
                          fileName: assetName,
                          externalNames
                        });
                      } catch (err) {
                        compilation.errors.push(err);
                      }
                    }

                    onFileMinified();
                  }
                );
              } else {
                // Skip minification for all other assets, though the modules still are
                minifiedAssets.set(assetName, {
                  // Still need to restore ids
                  source: postProcessCode(new ReplaceSource(asset), assetName),
                  extractedComments: [],
                  modules: chunkModules,
                  chunk,
                  fileName: assetName,
                  externalNames
                });
              }
            }
          }

          allRequestsIssued = true;

          if (pendingMinificationRequests) {
            await new Promise<void>((resolve) => {
              resolveMinifyPromise = resolve;
            });
          }

          // Handle any error from the minifier.
          if (cleanupMinifier) {
            await cleanupMinifier();
          }

          // All assets and modules have been minified, hand them off to be rehydrated

          // Clone the maps for safety, even though we won't be using them in the plugin anymore
          const assets: IAssetMap = new Map(minifiedAssets);
          const modules: IModuleMap = new Map(minifiedModules);

          await this.hooks.rehydrateAssets.promise(
            {
              assets,
              modules
            },
            compilation
          );
        }
      );

      for (const template of [compilation.chunkTemplate, compilation.mainTemplate]) {
        (template as unknown as IExtendedChunkTemplate).hooks.modules.tap(TAP_AFTER, dehydrateAsset);
      }
    });
  }
}
