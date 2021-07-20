// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { RawSourceMap } from 'source-map';
import { AsyncSeriesWaterfallHook, SyncWaterfallHook } from 'tapable';
import * as webpack from 'webpack';
import { ReplaceSource, Source } from 'webpack-sources';

/**
 * Request to the minifier
 * @public
 */
export interface IModuleMinificationRequest {
  /**
   * Identity of the request. Will be included in the response.
   */
  hash: string;
  /**
   * The raw code fragment
   */
  code: string;
  /**
   * File name to show for the source code in the source map
   */
  nameForMap: string | undefined;
  /**
   * Reserved variable names, e.g. __WEBPACK_EXTERNAL_MODULE_1__
   */
  externals: string[] | undefined;
}

/**
 * Result from the minifier function when an error is encountered.
 * @public
 */
export interface IModuleMinificationErrorResult {
  /**
   * Identity of the request
   */
  hash: string;
  /**
   * The error encountered, to be added to the current compilation's error collection.
   */
  error: Error;
  /**
   * Marker property to always return the same result shape.
   */
  code?: undefined;
  /**
   * Marker property to always return the same result shape.
   */
  map?: undefined;
}

/**
 * Result from the minifier on a successful minification.
 * @public
 */
export interface IModuleMinificationSuccessResult {
  /**
   * Identity of the request
   */
  hash: string;
  /**
   * The error property being `undefined` indicates success.
   */
  error: undefined;
  /**
   * The minified code.
   */
  code: string;
  /**
   * Marker property to always return the same result shape.
   */
  map?: RawSourceMap;
}

/**
 * Result from the minifier.
 * @public
 */
export type IModuleMinificationResult = IModuleMinificationErrorResult | IModuleMinificationSuccessResult;

/**
 * Callback passed to a minifier function
 * @public
 */
export interface IModuleMinificationCallback {
  (result: IModuleMinificationResult): void;
}

/**
 * Information about a dehydrated webpack ECMAScript asset
 * @public
 */
export interface IAssetInfo {
  /**
   * The (minified) boilerplate code for the asset. Will contain a token to be replaced by the minified modules.
   */
  source: Source;

  /**
   * The name of the asset, used to index into compilation.assets
   */
  fileName: string;

  /**
   * The ids of the modules that are part of the chunk corresponding to this asset
   */
  modules: (string | number)[];

  /**
   * The raw chunk object from Webpack, in case information from it is necessary for reconstruction
   */
  chunk: webpack.compilation.Chunk;

  /**
   * The set of external names to postprocess
   */
  externalNames: Map<string, string>;
}

/**
 * Information about a minified module
 * @public
 */
export interface IModuleInfo {
  /**
   * The (minified) code of this module. Will be a function expression.
   */
  source: Source;

  /**
   * The raw module object from Webpack, in case information from it is necessary for reconstruction
   */
  module: IExtendedModule;
}

/**
 * Extension of the webpack Module typings with members that are used by this Plugin
 * @public
 */
export interface IExtendedModule extends webpack.compilation.Module {
  /**
   * Is this module external?
   */
  external?: boolean;
  /**
   * Concatenated modules
   */
  modules?: IExtendedModule[];
  /**
   * Id for the module
   */
  // eslint-disable-next-line @rushstack/no-new-null
  id: string | number | null;
  /**
   * Gets a descriptive identifier for the module.
   */
  identifier(): string;
  /**
   * Gets a friendly identifier for the module.
   */
  readableIdentifier(requestShortener: unknown): string;
  /**
   * Path to the physical file this module represents
   */
  resource?: string;
}

declare module 'webpack' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace compilation {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface RuntimeTemplate {
      requestShortener: webpack.compilation.RequestShortener;
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface RequestShortener {}
  }
}

/**
 * This is the second parameter to the thisCompilation and compilation webpack.Compiler hooks.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface _IWebpackCompilationData {
  normalModuleFactory: webpack.compilation.NormalModuleFactory;
}

/**
 * This is the second parameter to the NormalModuleFactory `module` hook
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface _INormalModuleFactoryModuleData {
  resourceResolveData?: {
    /**
     * Contents of the description file (package.json) for the module
     */
    descriptionFileData?: {
      /**
       * The name of the package
       */
      name: string;
    };
    /**
     * Absolute path of the description file (package.json) for the module
     */
    descriptionFilePath?: string;
    /**
     * Absolute path of the directory containing the description file (package.json) for the module
     */
    descriptionFileRoot?: string;
    /**
     * Relative path from the description file (package.json) to the module
     */
    relativePath?: string;
  };
}

/**
 * A map from file names to dehydrated assets
 * @public
 */
export type IAssetMap = Map<string, IAssetInfo>;
/**
 * A map from module ids to minified modules
 * @public
 */
export type IModuleMap = Map<string | number, IModuleInfo>;

/**
 * An async function called to minify a module (or dehydrated chunk)
 * @public
 */
export interface IModuleMinifierFunction {
  (request: IModuleMinificationRequest, callback: IModuleMinificationCallback): void;
}

/**
 * Object that can be invoked to minify code.
 * @public
 */
export interface IModuleMinifier {
  minify: IModuleMinifierFunction;

  /**
   * Prevents the minifier from shutting down until the returned callback is invoked.
   * The callback may be used to surface errors encountered by the minifier that may not be relevant to a specific file.
   * It should be called to allow the minifier to cleanup
   */
  ref?(): () => Promise<void>;
}

/**
 * Options to the ModuleMinifierPlugin constructor
 * @public
 */
export interface IModuleMinifierPluginOptions {
  /**
   * Minifier implementation to use. Required.
   */
  minifier: IModuleMinifier;

  /**
   * Whether to enable source map processing. If not provided, will attempt to guess based on `mode` and `devtool` in the webpack config.
   * Set to `false` for faster builds at the expense of debuggability.
   */
  sourceMap?: boolean;

  /**
   * Instructs the plugin to alter the code of modules to maximize portability across compilations.
   */
  usePortableModules?: boolean;
}

/**
 * The set of data remaining to rehydrate in the current compilation
 * @public
 */
export interface IDehydratedAssets {
  /**
   * The set of remaining assets to rehydrate. Each tap may remove some or all assets from this collection
   */
  assets: IAssetMap;

  /**
   * The set of modules to use for rehydrating assets.
   */
  modules: IModuleMap;
}

/**
 * Hooks provided by the ModuleMinifierPlugin
 * @public
 */
export interface IModuleMinifierPluginHooks {
  /**
   * Hook invoked at the start of optimizeChunkAssets to rehydrate the minified boilerplate and runtime into chunk assets.
   */
  rehydrateAssets: AsyncSeriesWaterfallHook<IDehydratedAssets, webpack.compilation.Compilation>;

  /**
   * Hook invoked on a module id to get the final rendered id.
   */
  finalModuleId: SyncWaterfallHook<string | number | undefined>;

  /**
   * Hook invoked on code after it has been returned from the minifier.
   */
  postProcessCodeFragment: SyncWaterfallHook<ReplaceSource, string>;
}
