// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import glob from 'glob';
import { LegacyAdapters } from '@rushstack/node-core-library';
import { ITerminalProvider, ITerminal } from '@rushstack/terminal';

import { TypeScriptBuilder, ITypeScriptBuilderConfiguration } from './TypeScriptBuilder';
import { HeftSession } from '../../pluginFramework/HeftSession';
import { HeftConfiguration } from '../../configuration/HeftConfiguration';
import { IHeftPlugin } from '../../pluginFramework/IHeftPlugin';
import {
  CopyFromCacheMode,
  IBuildStageContext,
  ICompileSubstage,
  IBuildStageProperties
} from '../../stages/BuildStage';
import { ToolPackageResolver, IToolPackageResolution } from '../../utilities/ToolPackageResolver';
import { ScopedLogger } from '../../pluginFramework/logging/ScopedLogger';
import { ICleanStageContext, ICleanStageProperties } from '../../stages/CleanStage';
import { CoreConfigFiles, ISharedCopyConfiguration } from '../../utilities/CoreConfigFiles';

const PLUGIN_NAME: string = 'typescript';

interface IRunTypeScriptOptions {
  heftSession: HeftSession;
  heftConfiguration: HeftConfiguration;
  buildProperties: IBuildStageProperties;
  watchMode: boolean;

  /**
   * Fired whenever the compiler emits an output.  In watch mode, this event occurs after each recompile.
   * If there are multiple tsconfigs being processed in parallel, the event fires for each one.
   */
  emitCallback: () => void;

  /**
   * Fired exactly once after the compiler completes its first emit iteration.  In watch mode, this event unblocks
   * the "bundle" stage to start, avoiding a race condition where Webpack might otherwise report errors about
   * missing inputs.
   */
  firstEmitCallback: () => void;
}

interface IEmitModuleKind {
  moduleKind: 'commonjs' | 'amd' | 'umd' | 'system' | 'es2015' | 'esnext';
  outFolderName: string;
  jsExtensionOverride?: string;
}

interface IRunBuilderForTsconfigOptions {
  heftSession: HeftSession;
  heftConfiguration: HeftConfiguration;

  toolPackageResolution: IToolPackageResolution;
  tsconfigFilePath: string;
  lintingEnabled: boolean;
  copyFromCacheMode?: CopyFromCacheMode;
  watchMode: boolean;
  maxWriteParallelism: number;

  firstEmitCallback: () => void;

  emitCallback: () => void;

  terminalProvider: ITerminalProvider;
  terminalPrefixLabel: string | undefined;
  emitCjsExtensionForCommonJS: boolean;
  emitMjsExtensionForESModule: boolean;
  additionalModuleKindsToEmit: IEmitModuleKind[] | undefined;
}

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
   * If 'true', emit CommonJS output into the TSConfig outDir with the file extension '.cjs'
   */
  emitCjsExtensionForCommonJS?: boolean | undefined;

  /**
   * If 'true', emit ESModule output into the TSConfig outDir with the file extension '.mjs'
   */
  emitMjsExtensionForESModule?: boolean | undefined;

  /**
   * Specifies the intermediary folder that tests will use.  Because Jest uses the
   * Node.js runtime to execute tests, the module format must be CommonJS.
   *
   * The default value is "lib".
   */
  emitFolderNameForTests?: string;

  /**
   * Configures additional file types that should be copied into the TypeScript compiler's emit folders, for example
   * so that these files can be resolved by import statements.
   */
  staticAssetsToCopy?: ISharedCopyConfiguration;
}

export interface ITypeScriptConfigurationJson extends ISharedTypeScriptConfiguration {
  disableTslint?: boolean;
  maxWriteParallelism: number | undefined;
}

interface ITypeScriptConfiguration extends ISharedTypeScriptConfiguration {
  /**
   * Set this to change the maximum number of file handles that will be opened concurrently for writing.
   * The default is 50.
   */
  maxWriteParallelism: number;

  isLintingEnabled: boolean | undefined;
}

interface ITypeScriptConfigurationFileCacheEntry {
  configurationFile: ITypeScriptConfigurationJson | undefined;
}

export class TypeScriptPlugin implements IHeftPlugin {
  public readonly pluginName: string = PLUGIN_NAME;

  private readonly _taskPackageResolver: ToolPackageResolver;
  private _typeScriptConfigurationFileCache: Map<string, ITypeScriptConfigurationFileCacheEntry> = new Map<
    string,
    ITypeScriptConfigurationFileCacheEntry
  >();

  public constructor(taskPackageResolver: ToolPackageResolver) {
    this._taskPackageResolver = taskPackageResolver;
  }

  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    const logger: ScopedLogger = heftSession.requestScopedLogger('TypeScript Plugin');

    heftSession.hooks.clean.tap(PLUGIN_NAME, (clean: ICleanStageContext) => {
      clean.hooks.loadStageConfiguration.tapPromise(PLUGIN_NAME, async () => {
        await this._updateCleanOptions(logger, heftConfiguration, clean.properties);
      });
    });

    heftSession.hooks.build.tap(PLUGIN_NAME, (build: IBuildStageContext) => {
      build.hooks.compile.tap(PLUGIN_NAME, (compile: ICompileSubstage) => {
        compile.hooks.run.tapPromise(PLUGIN_NAME, async () => {
          await new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            this._runTypeScriptAsync(logger, {
              heftSession,
              heftConfiguration,
              buildProperties: build.properties,
              watchMode: build.properties.watchMode,
              emitCallback: () => {
                compile.hooks.afterEachIteration.call();
              },
              firstEmitCallback: () => {
                if (build.properties.watchMode) {
                  // Allow compilation to continue after the first emit
                  resolve();
                }
              }
            })
              .then(resolve)
              .catch(reject);
          });
        });
      });
    });
  }

  private async _ensureConfigFileLoadedAsync(
    terminal: ITerminal,
    heftConfiguration: HeftConfiguration
  ): Promise<ITypeScriptConfigurationJson | undefined> {
    const buildFolder: string = heftConfiguration.buildFolder;
    let typescriptConfigurationFileCacheEntry: ITypeScriptConfigurationFileCacheEntry | undefined =
      this._typeScriptConfigurationFileCache.get(buildFolder);

    if (!typescriptConfigurationFileCacheEntry) {
      typescriptConfigurationFileCacheEntry = {
        configurationFile:
          await CoreConfigFiles.typeScriptConfigurationFileLoader.tryLoadConfigurationFileForProjectAsync(
            terminal,
            buildFolder,
            heftConfiguration.rigConfig
          )
      };

      this._typeScriptConfigurationFileCache.set(buildFolder, typescriptConfigurationFileCacheEntry);
    }

    return typescriptConfigurationFileCacheEntry.configurationFile;
  }

  private async _updateCleanOptions(
    logger: ScopedLogger,
    heftConfiguration: HeftConfiguration,
    cleanProperties: ICleanStageProperties
  ): Promise<void> {
    const configurationFile: ITypeScriptConfigurationJson | undefined =
      await this._ensureConfigFileLoadedAsync(logger.terminal, heftConfiguration);

    if (configurationFile?.additionalModuleKindsToEmit) {
      for (const additionalModuleKindToEmit of configurationFile.additionalModuleKindsToEmit) {
        cleanProperties.pathsToDelete.add(
          path.resolve(heftConfiguration.buildFolder, additionalModuleKindToEmit.outFolderName)
        );
      }
    }
  }

  private async _runTypeScriptAsync(logger: ScopedLogger, options: IRunTypeScriptOptions): Promise<void> {
    const { heftSession, heftConfiguration, buildProperties, watchMode, emitCallback, firstEmitCallback } =
      options;

    const typescriptConfigurationJson: ITypeScriptConfigurationJson | undefined =
      await this._ensureConfigFileLoadedAsync(logger.terminal, heftConfiguration);
    const tsconfigPaths: string[] = await LegacyAdapters.convertCallbackToPromise(
      glob,
      'tsconfig?(-*).json',
      {
        cwd: heftConfiguration.buildFolder,
        nocase: true
      }
    );

    buildProperties.isTypeScriptProject = tsconfigPaths.length > 0;
    if (!buildProperties.isTypeScriptProject) {
      // If there are no TSConfigs, we have nothing to do
      return;
    }

    const typeScriptConfiguration: ITypeScriptConfiguration = {
      copyFromCacheMode: typescriptConfigurationJson?.copyFromCacheMode,
      additionalModuleKindsToEmit: typescriptConfigurationJson?.additionalModuleKindsToEmit,
      emitCjsExtensionForCommonJS: typescriptConfigurationJson?.emitCjsExtensionForCommonJS,
      emitMjsExtensionForESModule: typescriptConfigurationJson?.emitMjsExtensionForESModule,
      emitFolderNameForTests: typescriptConfigurationJson?.emitFolderNameForTests,
      maxWriteParallelism: typescriptConfigurationJson?.maxWriteParallelism || 50,
      isLintingEnabled: !(buildProperties.lite || typescriptConfigurationJson?.disableTslint)
    };

    if (heftConfiguration.projectPackageJson.private !== true) {
      if (typeScriptConfiguration.copyFromCacheMode === undefined) {
        logger.terminal.writeVerboseLine(
          'Setting TypeScript copyFromCacheMode to "copy" because the "private" field ' +
            'in package.json is not set to true. Linked files are not handled correctly ' +
            'when package are packed for publishing.'
        );
        // Copy if the package is intended to be published
        typeScriptConfiguration.copyFromCacheMode = 'copy';
      } else if (typeScriptConfiguration.copyFromCacheMode !== 'copy') {
        logger.emitWarning(
          new Error(
            `The TypeScript copyFromCacheMode is set to "${typeScriptConfiguration.copyFromCacheMode}", ` +
              'but the the "private" field in package.json is not set to true. ' +
              'Linked files are not handled correctly when packages are packed for publishing.'
          )
        );
      }
    }

    const toolPackageResolution: IToolPackageResolution =
      await this._taskPackageResolver.resolveToolPackagesAsync(heftConfiguration, logger.terminal);
    if (!toolPackageResolution.typeScriptPackagePath) {
      throw new Error('Unable to resolve a TypeScript compiler package');
    }

    const builderOptions: Omit<
      IRunBuilderForTsconfigOptions,
      | 'terminalProvider'
      | 'tsconfigFilePath'
      | 'additionalModuleKindsToEmit'
      | 'terminalPrefixLabel'
      | 'emitCallback'
      | 'firstEmitCallback'
    > = {
      heftSession: heftSession,
      heftConfiguration,
      toolPackageResolution,
      emitCjsExtensionForCommonJS: !!typeScriptConfiguration.emitCjsExtensionForCommonJS,
      emitMjsExtensionForESModule: !!typeScriptConfiguration.emitMjsExtensionForESModule,
      lintingEnabled: !!typeScriptConfiguration.isLintingEnabled,
      copyFromCacheMode: typeScriptConfiguration.copyFromCacheMode,
      watchMode: watchMode,
      maxWriteParallelism: typeScriptConfiguration.maxWriteParallelism
    };

    // Set some properties used by the Jest plugin
    buildProperties.emitFolderNameForTests = typeScriptConfiguration.emitFolderNameForTests || 'lib';
    buildProperties.emitExtensionForTests = typeScriptConfiguration.emitCjsExtensionForCommonJS
      ? '.cjs'
      : '.js';

    // Wrap the "firstEmitCallback" to fire only after all of the builder processes have completed.
    const callbacksForTsconfigs: Set<() => void> = new Set<() => void>();
    function getFirstEmitCallbackForTsconfig(): () => void {
      let hasAlreadyReportedFirstEmit: boolean = false;

      const callback: () => void = () => {
        if (hasAlreadyReportedFirstEmit) {
          return;
        }
        hasAlreadyReportedFirstEmit = true;

        callbacksForTsconfigs.delete(callback);
        if (callbacksForTsconfigs.size === 0) {
          firstEmitCallback();
        }
      };

      callbacksForTsconfigs.add(callback);

      return callback;
    }

    if (tsconfigPaths.length === 1) {
      await this._runBuilderForTsconfigAsync(logger, {
        ...builderOptions,
        tsconfigFilePath: tsconfigPaths[0],
        terminalProvider: heftConfiguration.terminalProvider,
        additionalModuleKindsToEmit: typeScriptConfiguration.additionalModuleKindsToEmit,
        terminalPrefixLabel: undefined,
        emitCallback: emitCallback,
        firstEmitCallback: getFirstEmitCallbackForTsconfig()
      });
    } else {
      const builderProcesses: Promise<void>[] = [];
      for (const tsconfigFilePath of tsconfigPaths) {
        const tsconfigFilename: string = path.basename(tsconfigFilePath, path.extname(tsconfigFilePath));

        // Only provide additionalModuleKindsToEmit to the default tsconfig.json
        const additionalModuleKindsToEmit: IEmitModuleKind[] | undefined =
          tsconfigFilename === 'tsconfig' ? typeScriptConfiguration.additionalModuleKindsToEmit : undefined;

        builderProcesses.push(
          this._runBuilderForTsconfigAsync(logger, {
            ...builderOptions,
            tsconfigFilePath,
            terminalProvider: heftConfiguration.terminalProvider,
            additionalModuleKindsToEmit,
            terminalPrefixLabel: tsconfigFilename,
            emitCallback: emitCallback,
            firstEmitCallback: getFirstEmitCallbackForTsconfig()
          })
        );
      }

      await Promise.all(builderProcesses);
    }
  }

  private async _runBuilderForTsconfigAsync(
    logger: ScopedLogger,
    options: IRunBuilderForTsconfigOptions
  ): Promise<void> {
    const { heftSession, heftConfiguration, tsconfigFilePath, toolPackageResolution } = options;

    const fullTsconfigFilePath: string = path.resolve(heftConfiguration.buildFolder, tsconfigFilePath);
    const typeScriptBuilderConfiguration: ITypeScriptBuilderConfiguration = {
      buildFolder: heftConfiguration.buildFolder,
      typeScriptToolPath: toolPackageResolution.typeScriptPackagePath!,
      tslintToolPath: toolPackageResolution.tslintPackagePath,
      eslintToolPath: toolPackageResolution.eslintPackagePath,

      tsconfigPath: fullTsconfigFilePath,
      lintingEnabled: options.lintingEnabled,
      buildCacheFolder: options.heftConfiguration.buildCacheFolder,
      additionalModuleKindsToEmit: options.additionalModuleKindsToEmit,
      emitCjsExtensionForCommonJS: options.emitCjsExtensionForCommonJS,
      emitMjsExtensionForESModule: options.emitMjsExtensionForESModule,
      copyFromCacheMode: options.copyFromCacheMode,
      watchMode: options.watchMode,
      loggerPrefixLabel: options.terminalPrefixLabel,
      maxWriteParallelism: options.maxWriteParallelism
    };
    const typeScriptBuilder: TypeScriptBuilder = new TypeScriptBuilder(
      options.terminalProvider,
      typeScriptBuilderConfiguration,
      heftSession,
      () => {
        options.firstEmitCallback();
        options.emitCallback();
      }
    );

    if (heftSession.debugMode) {
      await typeScriptBuilder.invokeAsync();
    } else {
      await typeScriptBuilder.invokeAsSubprocessAsync();
    }
  }
}
