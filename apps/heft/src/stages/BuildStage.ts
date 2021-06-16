// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { SyncHook, AsyncParallelHook, AsyncSeriesHook, AsyncSeriesWaterfallHook } from 'tapable';

import { StageBase, StageHooksBase, IStageContext } from './StageBase';
import { IFinishedWords, Logging } from '../utilities/Logging';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import {
  CommandLineAction,
  CommandLineFlagParameter,
  CommandLineStringParameter,
  CommandLineIntegerParameter
} from '@rushstack/ts-command-line';
import { LoggingManager } from '../pluginFramework/logging/LoggingManager';

/**
 * @public
 */
export class BuildSubstageHooksBase {
  public readonly run: AsyncParallelHook<[]> = new AsyncParallelHook();
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
export type CopyFromCacheMode = 'hardlink' | 'copy';

/**
 * @public
 */
export class CompileSubstageHooks extends BuildSubstageHooksBase {
  /**
   * The `afterCompile` event is fired exactly once, after the "compile" stage completes its first operation.
   * The "bundle" stage will not begin until all event handlers have resolved their promises.  The behavior
   * of this event is the same in watch mode and non-watch mode.
   */
  public readonly afterCompile: AsyncParallelHook<[]> = new AsyncParallelHook();

  /**
   * The `afterRecompile` event is only used in watch mode.  It fires whenever the compiler's outputs have
   * been rebuilt.  The initial compilation fires the `afterCompile` event only, and then all subsequent iterations
   * fire the `afterRecompile` event only. Heft does not wait for the `afterRecompile` promises to resolve.
   */
  public readonly afterRecompile: AsyncParallelHook<[]> = new AsyncParallelHook();
}

/**
 * @public
 */
export class BundleSubstageHooks extends BuildSubstageHooksBase {
  public readonly configureWebpack: AsyncSeriesWaterfallHook<unknown> = new AsyncSeriesWaterfallHook<unknown>(
    ['webpackConfiguration']
  );
  public readonly afterConfigureWebpack: AsyncSeriesHook<[]> = new AsyncSeriesHook();
}

/**
 * @public
 */
export interface ICompileSubstageProperties {
  typescriptMaxWriteParallelism: number | undefined;
}

/**
 * @public
 */
export interface IBundleSubstageProperties {
  /**
   * If webpack is used, this will be set to the version of the webpack package
   */
  webpackVersion?: string | undefined;

  /**
   * If webpack is used, this will be set to the version of the webpack-dev-server package
   */
  webpackDevServerVersion?: string | undefined;

  /**
   * The configuration used by the Webpack plugin. This must be populated
   * for Webpack to run. If webpackConfigFilePath is specified,
   * this will be populated automatically with the exports of the
   * config file referenced in that property.
   */
  webpackConfiguration?: unknown;
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
  // Input
  production: boolean;
  lite: boolean;
  locale?: string;
  maxOldSpaceSize?: string;
  watchMode: boolean;
  serveMode: boolean;
  webpackStats?: unknown;

  // Output
  /**
   * @beta
   */
  isTypeScriptProject?: boolean;
  /**
   * @beta
   */
  emitFolderNameForTests?: string;
  /**
   * @beta
   */
  emitExtensionForTests?: '.js' | '.cjs' | '.mjs';
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
  typescriptMaxWriteParallelismParameter: CommandLineIntegerParameter;
  maxOldSpaceSizeParameter: CommandLineStringParameter;
}

interface IRunSubstageWithLoggingOptions {
  buildStageName: string;
  buildStage: IBuildSubstage<BuildSubstageHooksBase, object>;
  watchMode: boolean;
}

const WATCH_MODE_FINISHED_LOGGING_WORDS: IFinishedWords = {
  success: 'ready to continue',
  failure: 'continuing with errors'
};

export class BuildStage extends StageBase<BuildStageHooks, IBuildStageProperties, IBuildStageOptions> {
  public constructor(heftConfiguration: HeftConfiguration, loggingManager: LoggingManager) {
    super(heftConfiguration, loggingManager, BuildStageHooks);
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

      typescriptMaxWriteParallelismParameter: action.defineIntegerParameter({
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
      maxOldSpaceSize: standardParameters.maxOldSpaceSizeParameter.value,
      typescriptMaxWriteParallelism: standardParameters.typescriptMaxWriteParallelismParameter.value
    };
  }

  protected async getDefaultStagePropertiesAsync(
    options: IBuildStageOptions
  ): Promise<IBuildStageProperties> {
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
        typescriptMaxWriteParallelism: this.stageOptions.typescriptMaxWriteParallelism
      }
    };
    this.stageHooks.compile.call(compileStage);

    const bundleStage: IBundleSubstage = {
      hooks: new BundleSubstageHooks(),
      properties: {}
    };
    this.stageHooks.bundle.call(bundleStage);

    const postBuildStage: IPostBuildSubstage = {
      hooks: new BuildSubstageHooksBase(),
      properties: {}
    };
    this.stageHooks.postBuild.call(postBuildStage);

    const watchMode: boolean = this.stageProperties.watchMode;

    await this._runSubstageWithLoggingAsync({
      buildStageName: 'Pre-compile',
      buildStage: preCompileSubstage,
      watchMode: watchMode
    });

    if (this.loggingManager.errorsHaveBeenEmitted && !watchMode) {
      return;
    }

    await this._runSubstageWithLoggingAsync({
      buildStageName: 'Compile',
      buildStage: compileStage,
      watchMode: watchMode
    });
    await compileStage.hooks.afterCompile.promise();

    if (this.loggingManager.errorsHaveBeenEmitted && !watchMode) {
      return;
    }

    bundleStage.properties.webpackConfiguration = await bundleStage.hooks.configureWebpack.promise(undefined);
    await bundleStage.hooks.afterConfigureWebpack.promise();
    await this._runSubstageWithLoggingAsync({
      buildStageName: 'Bundle',
      buildStage: bundleStage,
      watchMode: watchMode
    });

    if (this.loggingManager.errorsHaveBeenEmitted && !watchMode) {
      return;
    }

    await this._runSubstageWithLoggingAsync({
      buildStageName: 'Post-build',
      buildStage: postBuildStage,
      watchMode: watchMode
    });
  }

  private async _runSubstageWithLoggingAsync({
    buildStageName,
    buildStage,
    watchMode
  }: IRunSubstageWithLoggingOptions): Promise<void> {
    if (buildStage.hooks.run.isUsed()) {
      await Logging.runFunctionWithLoggingBoundsAsync(
        this.globalTerminal,
        buildStageName,
        async () => await buildStage.hooks.run.promise(),
        watchMode ? WATCH_MODE_FINISHED_LOGGING_WORDS : undefined
      );
    }
  }
}
