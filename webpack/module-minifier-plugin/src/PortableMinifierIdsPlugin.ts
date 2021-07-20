// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import webpack, { Compiler, Plugin } from 'webpack';
import { ReplaceSource } from 'webpack-sources';
import { createHash } from 'crypto';
import { TapOptions } from 'tapable';
import RequestShortener from 'webpack/lib/RequestShortener';

import { STAGE_AFTER, STAGE_BEFORE } from './Constants';
import {
  _INormalModuleFactoryModuleData,
  IExtendedModule,
  IModuleMinifierPluginHooks,
  _IWebpackCompilationData
} from './ModuleMinifierPlugin.types';

const PLUGIN_NAME: 'PortableMinifierModuleIdsPlugin' = 'PortableMinifierModuleIdsPlugin';

const TAP_BEFORE: TapOptions<'sync'> = {
  name: PLUGIN_NAME,
  stage: STAGE_BEFORE
};

const TAP_AFTER: TapOptions<'sync'> = {
  name: PLUGIN_NAME,
  stage: STAGE_AFTER
};

const STABLE_MODULE_ID_PREFIX: '__MODULEID_SHA_' = '__MODULEID_SHA_';
const STABLE_MODULE_ID_REGEX: RegExp = /['"]?(__MODULEID_SHA_[0-9a-f]+)['"]?/g;

/**
 * Plugin responsible for converting the Webpack module ids (of whatever variety) to stable ids before code is handed to the minifier, then back again.
 * Uses the node module identity of the target module. Will emit an error if it encounters multiple versions of the same package in the same compilation.
 * @public
 */
export class PortableMinifierModuleIdsPlugin implements Plugin {
  private readonly _minifierHooks: IModuleMinifierPluginHooks;

  public constructor(minifierHooks: IModuleMinifierPluginHooks) {
    this._minifierHooks = minifierHooks;
  }

  public apply(compiler: Compiler): void {
    // Ensure that "EXTERNAL MODULE: " comments are portable and module version invariant
    const baseShorten: (request: string) => string = RequestShortener.prototype.shorten;
    RequestShortener.prototype.shorten = function (this: RequestShortener, request: string): string {
      const baseResult: string = baseShorten.call(this, request);
      const nodeModules: '/node_modules/' = '/node_modules/';

      if (!baseResult) {
        return baseResult;
      }

      const nodeModulesIndex: number = baseResult.lastIndexOf(nodeModules);
      if (nodeModulesIndex < 0) {
        return baseResult;
      }

      const nodeModulePath: string = baseResult.slice(nodeModulesIndex + nodeModules.length);
      this.cache.set(request, nodeModulePath);
      return nodeModulePath;
    };

    const stableIdToFinalId: Map<string | number, string | number> = new Map();

    this._minifierHooks.finalModuleId.tap(PLUGIN_NAME, (id: string | number | undefined) => {
      return id === undefined ? id : stableIdToFinalId.get(id);
    });

    this._minifierHooks.postProcessCodeFragment.tap(PLUGIN_NAME, (source: ReplaceSource, context: string) => {
      const code: string = source.original().source() as string;

      STABLE_MODULE_ID_REGEX.lastIndex = -1;
      // RegExp.exec uses null or an array as the return type, explicitly
      let match: RegExpExecArray | null = null;
      while ((match = STABLE_MODULE_ID_REGEX.exec(code))) {
        const id: string = match[1];
        const mapped: string | number | undefined = stableIdToFinalId.get(id);

        if (mapped === undefined) {
          console.error(`Missing module id for ${id} in ${context}!`);
        }

        source.replace(match.index, STABLE_MODULE_ID_REGEX.lastIndex - 1, JSON.stringify(mapped));
      }

      return source;
    });

    compiler.hooks.thisCompilation.tap(
      PLUGIN_NAME,
      (compilation: webpack.compilation.Compilation, compilationData: _IWebpackCompilationData) => {
        const { normalModuleFactory } = compilationData;

        normalModuleFactory.hooks.module.tap(
          PLUGIN_NAME,
          (mod: IExtendedModule, data: _INormalModuleFactoryModuleData) => {
            const { resourceResolveData: resolveData } = data;

            if (resolveData) {
              mod.factoryMeta.resolveData = resolveData;
              return;
            }

            console.error(`Missing resolution data for ${mod.resource}`);
          }
        );

        compilation.hooks.succeedModule.tap(PLUGIN_NAME, (mod: webpack.compilation.Module) => {
          const { resolveData } = mod.factoryMeta;

          if (!resolveData) {
            return;
          }

          const { descriptionFileData: packageJson, relativePath } = resolveData;

          if (packageJson && relativePath) {
            const nodeId: string = `${packageJson.name}${relativePath.slice(1).replace(/\.js(on)?$/, '')}`;
            mod.factoryMeta.nodeResource = nodeId;
          }
        });

        stableIdToFinalId.clear();

        // Make module ids a pure function of the file path immediately before rendering.
        // Unfortunately, other means of altering these ids don't work in Webpack 4 without a lot more code and work.
        // Namely, a number of functions reference "module.id" directly during code generation

        compilation.hooks.beforeChunkAssets.tap(TAP_AFTER, () => {
          // For tracking collisions
          const resourceById: Map<string | number, string> = new Map();

          for (const mod of compilation.modules) {
            const originalId: string | number = mod.id;

            // Need to handle ConcatenatedModules, which don't have the resource property directly
            const { resource } = mod.rootModule || mod;

            if (resource) {
              const hashId: string = createHash('sha256').update(resource).digest('hex');

              // This is designed to be an easily regex-findable string
              const stableId: string = `${STABLE_MODULE_ID_PREFIX}${hashId}`;
              const existingResource: string | undefined = resourceById.get(stableId);

              if (existingResource) {
                compilation.errors.push(
                  new Error(
                    `Module id collision for ${resource} with ${existingResource}.\n This means you are bundling multiple versions of the same module.`
                  )
                );
              }

              stableIdToFinalId.set(stableId, originalId);

              // Record to detect collisions
              resourceById.set(stableId, resource);
              mod.id = stableId;
            }
          }
        });

        // This is the hook immediately following chunk asset rendering. Fix the module ids.
        compilation.hooks.additionalChunkAssets.tap(TAP_BEFORE, () => {
          // Restore module ids in case any later hooks need them
          for (const mod of compilation.modules) {
            const stableId: string | number = mod.id;
            const finalId: string | number | undefined = stableIdToFinalId.get(stableId);
            if (finalId !== undefined) {
              mod.id = finalId;
            }
          }
        });
      }
    );
  }
}
