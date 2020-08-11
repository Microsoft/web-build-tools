// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { SyncHook, AsyncParallelHook, AsyncSeriesHook, AsyncSeriesWaterfallHook } from 'tapable';
import * as webpack from 'webpack';

import { StageBase, StageHooksBase, IStageContext } from './StageBase';
import { Logging } from '../utilities/Logging';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import {
  CommandLineAction,
  CommandLineFlagParameter,
  CommandLineStringParameter,
  CommandLineIntegerParameter
} from '@rushstack/ts-command-line';

/**
 * @public
 */
export class BuildSubstageHooksBase {
  public readonly run: AsyncParallelHook = new AsyncParallelHook();
}

/**
 * @public
 */
export interface IBuildSubstage<
  TBuildSubstageHooks extends BuildSubstageHooksBase,
  TBuildSubstageProperties extends object
> {
  hooks: TBuildSubstageHooks;
  properties: TBuildSubstageProperties;
}

/**
 * @public
 */
export interface ISharedCopyStaticAssetsConfiguration {
  /**
   * File extensions that should be copied from the src folder to the destination folder(s)
   */
  fileExtensions?: string[];

  /**
   * Globs that should be explicitly excluded. This takes precedence over globs listed in "includeGlobs" and
   * files that match the file extensions provided in "fileExtensions".
   */
  excludeGlobs?: string[];

  /**
   * Globs that should be explicitly included.
   */
  includeGlobs?: string[];
}

/**
 * @public
 */
export interface ICopyStaticAssetsConfiguration extends ISharedCopyStaticAssetsConfiguration {
  /**
   * The folder from which assets should be copied. For example, "src". This defaults to "src".
   *
   * This folder is directly under the folder containing the project's package.json file
   */
  sourceFolderName: string;

  /**
   * The folder(s) to which assets should be copied. For example ["lib", "lib-cjs"]. This defaults to ["lib"]
   *
   * These folders are directly under the folder containing the project's package.json file
   */
  destinationFolderNames: string[];
}

/**
 * @public
 */
export interface IEmitModuleKindBase<TModuleKind> {
  moduleKind: TModuleKind;
  outFolderPath: string;
}

/**
 * @public
 */
export type IEmitModuleKind = IEmitModuleKindBase<
  'commonjs' | 'amd' | 'umd' | 'system' | 'es2015' | 'esnext'
>;

/**
 * @public
 */
export type CopyFromCacheMode = 'hardlink' | 'copy';

/**
 * @public
 */
export interface ISharedTypeScriptConfiguration {
  /**
   * Can be set to 'copy' or 'hardlink'. If set to 'copy', copy files from cache. If set to 'hardlink', files will be
   * hardlinked to the cache location. This option is useful when producing a tarball of build output as TAR files
   * don't handle these hardlinks correctly. 'hardlink' is the default behavior.
   */
  copyFromCacheMode?: CopyFromCacheMode | undefined;

  /**
   * If provided, emit these module kinds in addition to the modules specified in the tsconfig.
   * Note that this option only applies to the main tsconfig.json configuration.
   */
  additionalModuleKindsToEmit?: IEmitModuleKind[] | undefined;

  /**
   * Specifies the intermediary folder that Jest will use for its input.  Because Jest uses the
   * Node.js runtime to execute tests, the module format must be CommonJS.
   *
   * The default value is "lib".
   */
  emitFolderPathForJest?: string;

  /**
   * Set this to change the maximum number of file handles that will be opened concurrently for writing.
   * The default is 50.
   */
  maxWriteParallelism: number;

  /**
   * Adds extra commandline arguments to pass to the Node subprocess running Typescript. e.g. --max-old-space-size
   * Supported command line interface for node.js can be found at https://nodejs.org/api/cli.html
   */
  extraNodeArgv?: string[];
}

/**
 * @public
 */
export interface ITypeScriptConfiguration extends ISharedTypeScriptConfiguration {
  tsconfigPaths: string[];
  isLintingEnabled: boolean | undefined;
}

/**
 * @public
 */
export interface IApiExtractorConfiguration {
  /**
   * If set to true, use the project's TypeScript compiler version for API Extractor's
   * analysis. API Extractor's included TypeScript compiler can generally correctly
   * analyze typings generated by older compilers, and referencing the project's compiler
   * can cause issues. If issues are encountered with API Extractor's included compiler,
   * set this option to true.
   *
   * This corresponds to API Extractor's `--typescript-compiler-folder` CLI option and
   * `IExtractorInvokeOptions.typescriptCompilerFolder` API option. This option defaults to false.
   */
  useProjectTypescriptVersion?: boolean;
}

/**
 * @public
 */
export class CompileSubstageHooks extends BuildSubstageHooksBase {
  public readonly configureTypeScript: AsyncSeriesHook = new AsyncSeriesHook();
  public readonly configureCopyStaticAssets: AsyncSeriesHook = new AsyncSeriesHook();

  public readonly afterConfigureTypeScript: AsyncSeriesHook = new AsyncSeriesHook();
  public readonly afterConfigureCopyStaticAssets: AsyncSeriesHook = new AsyncSeriesHook();
}

/**
 * @public
 */
export type IWebpackConfiguration = webpack.Configuration | webpack.Configuration[] | undefined;

/**
 * @public
 */
export class BundleSubstageHooks extends BuildSubstageHooksBase {
  public readonly configureWebpack: AsyncSeriesWaterfallHook<
    IWebpackConfiguration
  > = new AsyncSeriesWaterfallHook<IWebpackConfiguration>(['webpackConfiguration']);
  public readonly afterConfigureWebpack: AsyncSeriesHook = new AsyncSeriesHook();

  public readonly configureApiExtractor: AsyncSeriesWaterfallHook<
    IApiExtractorConfiguration
  > = new AsyncSeriesWaterfallHook<IApiExtractorConfiguration>(['apiExtractorConfiguration']);
}

/**
 * @public
 */
export interface ICompileSubstageProperties {
  typeScriptConfiguration: ITypeScriptConfiguration;
  copyStaticAssetsConfiguration: ICopyStaticAssetsConfiguration;
}

/**
 * @public
 */
export interface ISharedBundleSubstageWebpackProperties {
  apiExtractorConfiguration: IApiExtractorConfiguration;
}

/**
 * @public
 */
export interface IBundleSubstageProperties extends ISharedBundleSubstageWebpackProperties {
  /**
   * The configuration used by the Webpack plugin. This must be populated
   * for Webpack to run. If webpackConfigFilePath is specified,
   * this will be populated automatically with the exports of the
   * config file referenced in that property.
   */
  webpackConfiguration?: webpack.Configuration | webpack.Configuration[];
}

/**
 * @public
 */
export interface IPreCompileSubstage extends IBuildSubstage<BuildSubstageHooksBase, {}> {}

/**
 * @public
 */
export interface ICompileSubstage extends IBuildSubstage<CompileSubstageHooks, ICompileSubstageProperties> {}

/**
 * @public
 */
export interface IBundleSubstage extends IBuildSubstage<BundleSubstageHooks, IBundleSubstageProperties> {}

/**
 * @public
 */
export interface IPostBuildSubstage extends IBuildSubstage<BuildSubstageHooksBase, {}> {}

/**
 * @public
 */
export class BuildStageHooks extends StageHooksBase<IBuildStageProperties> {
  public readonly preCompile: SyncHook<IPreCompileSubstage> = new SyncHook<IPreCompileSubstage>([
    'preCompileStage'
  ]);

  public readonly compile: SyncHook<ICompileSubstage> = new SyncHook<ICompileSubstage>(['compileStage']);

  public readonly bundle: SyncHook<IBundleSubstage> = new SyncHook<IBundleSubstage>(['bundleStage']);

  public readonly postBuild: SyncHook<IPostBuildSubstage> = new SyncHook<IPostBuildSubstage>([
    'postBuildStage'
  ]);
}

/**
 * @public
 */
export interface IBuildStageProperties {
  production: boolean;
  lite: boolean;
  locale?: string;
  maxOldSpaceSize?: string;
  watchMode: boolean;
  serveMode: boolean;
  webpackStats?: webpack.Stats;
}

/**
 * @public
 */
export interface IBuildStageContext extends IStageContext<BuildStageHooks, IBuildStageProperties> {}

export interface IBuildStageOptions {
  production: boolean;
  lite: boolean;
  locale?: string;
  maxOldSpaceSize?: string;
  watchMode: boolean;
  serveMode: boolean;
  typescriptMaxWriteParallelism?: number;
}

export interface IBuildStageStandardParameters {
  productionFlag: CommandLineFlagParameter;
  localeParameter: CommandLineStringParameter;
  liteFlag: CommandLineFlagParameter;
  typescriptMaxWriteParallelismParamter: CommandLineIntegerParameter;
  maxOldSpaceSizeParameter: CommandLineStringParameter;
}

export class BuildStage extends StageBase<BuildStageHooks, IBuildStageProperties, IBuildStageOptions> {
  public constructor(heftConfiguration: HeftConfiguration) {
    super(heftConfiguration, BuildStageHooks);
  }

  public static defineStageStandardParameters(action: CommandLineAction): IBuildStageStandardParameters {
    return {
      productionFlag: action.defineFlagParameter({
        parameterLongName: '--production',
        description: 'If specified, build ship/production output'
      }),

      localeParameter: action.defineStringParameter({
        parameterLongName: '--locale',
        argumentName: 'LOCALE',
        description: 'Only build the specified locale, if applicable.'
      }),

      liteFlag: action.defineFlagParameter({
        parameterLongName: '--lite',
        parameterShortName: '-l',
        description: 'Perform a minimal build, skipping optional steps like linting.'
      }),

      typescriptMaxWriteParallelismParamter: action.defineIntegerParameter({
        parameterLongName: '--typescript-max-write-parallelism',
        argumentName: 'PARALLEILSM',
        description:
          'Set this to change the maximum write parallelism. This parameter overrides ' +
          'what is set in typescript.json. The default is 50.'
      }),

      maxOldSpaceSizeParameter: action.defineStringParameter({
        parameterLongName: '--max-old-space-size',
        argumentName: 'SIZE',
        description: 'Used to specify the max old space size.'
      })
    };
  }

  public static getOptionsFromStandardParameters(
    standardParameters: IBuildStageStandardParameters
  ): Omit<IBuildStageOptions, 'watchMode' | 'serveMode'> {
    return {
      production: standardParameters.productionFlag.value,
      lite: standardParameters.liteFlag.value,
      locale: standardParameters.localeParameter.value,
      typescriptMaxWriteParallelism: standardParameters.typescriptMaxWriteParallelismParamter.value
    };
  }

  protected getDefaultStageProperties(options: IBuildStageOptions): IBuildStageProperties {
    return {
      production: options.production,
      lite: options.lite,
      locale: options.locale,
      maxOldSpaceSize: options.maxOldSpaceSize,
      watchMode: options.watchMode,
      serveMode: options.serveMode
    };
  }

  protected async executeInnerAsync(): Promise<void> {
    const preCompileSubstage: IPreCompileSubstage = {
      hooks: new BuildSubstageHooksBase(),
      properties: {}
    };
    this.stageHooks.preCompile.call(preCompileSubstage);

    const compileStage: ICompileSubstage = {
      hooks: new CompileSubstageHooks(),
      properties: {
        typeScriptConfiguration: {
          tsconfigPaths: [],
          isLintingEnabled: !this.stageProperties.lite,
          copyFromCacheMode: undefined,
          additionalModuleKindsToEmit: undefined,
          maxWriteParallelism: 50
        },
        copyStaticAssetsConfiguration: {
          fileExtensions: [],
          excludeGlobs: [],
          includeGlobs: [],

          // For now - these may need to be revised later
          sourceFolderName: 'src',
          destinationFolderNames: ['lib']
        }
      }
    };
    this.stageHooks.compile.call(compileStage);

    const bundleStage: IBundleSubstage = {
      hooks: new BundleSubstageHooks(),
      properties: {
        apiExtractorConfiguration: {}
      }
    };
    this.stageHooks.bundle.call(bundleStage);

    const postBuildStage: IPostBuildSubstage = {
      hooks: new BuildSubstageHooksBase(),
      properties: {}
    };
    this.stageHooks.postBuild.call(postBuildStage);

    if (this.stageProperties.watchMode) {
      // In --watch mode, run all configuration upfront and then kick off all stages
      // concurrently with the expectation that the their promises will never resolve
      // and that they will handle watching filesystem changes

      await Promise.all([
        compileStage.hooks.configureTypeScript.promise(),
        compileStage.hooks.configureCopyStaticAssets.promise(),
        bundleStage.hooks.configureApiExtractor
          .promise(bundleStage.properties.apiExtractorConfiguration)
          .then(
            (apiExtractorConfiguration) =>
              (bundleStage.properties.apiExtractorConfiguration = apiExtractorConfiguration)
          ),
        bundleStage.hooks.configureWebpack
          .promise(undefined)
          .then(
            (webpackConfiguration) => (bundleStage.properties.webpackConfiguration = webpackConfiguration)
          )
      ]);
      await Promise.all([
        compileStage.hooks.afterConfigureTypeScript.promise(),
        compileStage.hooks.afterConfigureCopyStaticAssets.promise(),
        bundleStage.hooks.afterConfigureWebpack.promise()
      ]);

      await Promise.all([
        this._runSubstageWithLoggingAsync('Pre-compile', preCompileSubstage),
        this._runSubstageWithLoggingAsync('Compile', compileStage),
        this._runSubstageWithLoggingAsync('Bundle', bundleStage),
        this._runSubstageWithLoggingAsync('Post-build', postBuildStage)
      ]);
    } else {
      await this._runSubstageWithLoggingAsync('Pre-compile', preCompileSubstage);

      await Promise.all([
        compileStage.hooks.configureTypeScript.promise(),
        compileStage.hooks.configureCopyStaticAssets.promise()
      ]);
      await Promise.all([
        compileStage.hooks.afterConfigureTypeScript.promise(),
        compileStage.hooks.afterConfigureCopyStaticAssets.promise()
      ]);
      if (this.stageOptions.typescriptMaxWriteParallelism) {
        compileStage.properties.typeScriptConfiguration.maxWriteParallelism = this.stageOptions.typescriptMaxWriteParallelism;
      }
      await this._runSubstageWithLoggingAsync('Compile', compileStage);

      await Promise.all([
        bundleStage.hooks.configureWebpack
          .promise(undefined)
          .then(
            (webpackConfiguration) => (bundleStage.properties.webpackConfiguration = webpackConfiguration)
          ),
        bundleStage.hooks.configureApiExtractor
          .promise(bundleStage.properties.apiExtractorConfiguration)
          .then(
            (apiExtractorConfiguration) =>
              (bundleStage.properties.apiExtractorConfiguration = apiExtractorConfiguration)
          )
      ]);
      await bundleStage.hooks.afterConfigureWebpack.promise();
      await this._runSubstageWithLoggingAsync('Bundle', bundleStage);

      await this._runSubstageWithLoggingAsync('Post-build', postBuildStage);
    }
  }

  private async _runSubstageWithLoggingAsync(
    buildStageName: string,
    buildStage: IBuildSubstage<BuildSubstageHooksBase, object>
  ): Promise<void> {
    if (buildStage.hooks.run.isUsed()) {
      await Logging.runFunctionWithLoggingBoundsAsync(
        this.terminal,
        buildStageName,
        async () => await buildStage.hooks.run.promise()
      );
    }
  }
}
