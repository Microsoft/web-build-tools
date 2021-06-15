// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// Load the Jest patch
import './jestWorkerPatch';

import * as path from 'path';
import { mergeWith, isObject } from 'lodash';
import type {
  ICleanStageContext,
  ITestStageContext,
  IHeftPlugin,
  HeftConfiguration,
  HeftSession,
  ScopedLogger,
  IBuildStageContext,
  ICompileSubstage
} from '@rushstack/heft';
import { getVersion, runCLI } from '@jest/core';
import { Config } from '@jest/types';
import {
  ConfigurationFile,
  IJsonPathMetadata,
  InheritanceType,
  PathResolutionMethod
} from '@rushstack/heft-config-file';
import { FileSystem, JsonFile, JsonSchema } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import { IHeftJestReporterOptions } from './HeftJestReporter';
import { HeftJestDataFile } from './HeftJestDataFile';

type JestReporterConfig = string | Config.ReporterConfig;
const PLUGIN_NAME: string = 'JestPlugin';
const PLUGIN_SCHEMA_PATH: string = `${__dirname}/schemas/heft-jest-plugin.schema.json`;
const JEST_CONFIGURATION_LOCATION: string = `config/jest.config.json`;

interface IJestPluginOptions {
  disableConfigurationModuleResolution?: boolean;
}

export interface IHeftJestConfiguration extends Config.InitialOptions {}

/**
 * @internal
 */
export class JestPlugin implements IHeftPlugin<IJestPluginOptions> {
  public readonly pluginName: string = PLUGIN_NAME;
  public readonly optionsSchema: JsonSchema = JsonSchema.fromFile(PLUGIN_SCHEMA_PATH);

  /**
   * Returns the loader for the `config/api-extractor-task.json` config file.
   */
  public static getJestConfigurationLoader(buildFolder: string): ConfigurationFile<IHeftJestConfiguration> {
    // Bypass Jest configuration validation
    const schemaPath: string = `${__dirname}/schemas/anything.schema.json`;

    // By default, ConfigurationFile will replace all objects, so we need to provide merge functions for these
    const shallowObjectInheritanceFunc: <T>(
      currentObject: T,
      parentObject: T
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => T = <T extends { [key: string]: any }>(currentObject: T, parentObject: T): T => {
      return { ...(parentObject || {}), ...(currentObject || {}) };
    };
    const deepObjectInheritanceFunc: <T>(
      currentObject: T,
      parentObject: T
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => T = <T extends { [key: string]: any }>(currentObject: T, parentObject: T): T => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mergeWith(parentObject || {}, currentObject || {}, (value: any, source: any) => {
        if (!isObject(source)) {
          return source;
        }
        return Array.isArray(value) ? [...value, ...source] : { ...value, ...source };
      });
    };

    // Resolve all specified properties using Node resolution, and replace <rootDir> with the same rootDir
    // that we provide to Jest. Resolve if we modified since paths containing <rootDir> should be absolute.
    const nodeResolveMetadata: IJsonPathMetadata = {
      preresolve: (jsonPath: string) => {
        const newJsonPath: string = jsonPath.replace(/<rootDir>/g, buildFolder);
        return jsonPath === newJsonPath ? jsonPath : path.resolve(newJsonPath);
      },
      pathResolutionMethod: PathResolutionMethod.NodeResolve
    };

    return new ConfigurationFile<IHeftJestConfiguration>({
      projectRelativeFilePath: 'config/jest.config.json',
      jsonSchemaPath: schemaPath,
      propertyInheritance: {
        moduleNameMapper: {
          inheritanceType: InheritanceType.custom,
          inheritanceFunction: shallowObjectInheritanceFunc
        },
        transform: {
          inheritanceType: InheritanceType.custom,
          inheritanceFunction: shallowObjectInheritanceFunc
        },
        globals: {
          inheritanceType: InheritanceType.custom,
          inheritanceFunction: deepObjectInheritanceFunc
        }
      },
      jsonPathMetadata: {
        // string
        '$.dependencyExtractor': nodeResolveMetadata,
        '$.filter': nodeResolveMetadata,
        '$.globalSetup': nodeResolveMetadata,
        '$.globalTeardown': nodeResolveMetadata,
        '$.moduleLoader': nodeResolveMetadata,
        '$.prettierPath': nodeResolveMetadata,
        '$.resolver': nodeResolveMetadata,
        '$.runner': nodeResolveMetadata,
        '$.snapshotResolver': nodeResolveMetadata,
        '$.testEnvironment': nodeResolveMetadata,
        '$.testResultsProcessor': nodeResolveMetadata,
        '$.testRunner': nodeResolveMetadata,
        '$.testSequencer': nodeResolveMetadata,
        // string[]
        '$.setupFiles.*': nodeResolveMetadata,
        '$.setupFilesAfterEnv.*': nodeResolveMetadata,
        '$.snapshotSerializers.*': nodeResolveMetadata,
        // reporters: (path | [ path, options ])[]
        '$.reporters[?(@ !== "default")]*@string()': nodeResolveMetadata, // string path, excluding "default"
        '$.reporters.*[?(@property == 0 && @ !== "default")]': nodeResolveMetadata, // First entry in [ path, options ], excluding "default"
        // transform: { [regex]: path | [ path, options ] }
        '$.transform.*@string()': nodeResolveMetadata, // string path
        '$.transform.*[?(@property == 0)]': nodeResolveMetadata, // First entry in [ path, options ]
        // watchPlugins: (path | [ path, options ])[]
        '$.watchPlugins.*@string()': nodeResolveMetadata, // string path
        '$.watchPlugins.*[?(@property == 0)]': nodeResolveMetadata // First entry in [ path, options ]
      }
    });
  }

  public apply(
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    options?: IJestPluginOptions
  ): void {
    heftSession.hooks.build.tap(PLUGIN_NAME, (build: IBuildStageContext) => {
      build.hooks.compile.tap(PLUGIN_NAME, (compile: ICompileSubstage) => {
        compile.hooks.afterCompile.tapPromise(PLUGIN_NAME, async () => {
          // Write the data file used by jest-build-transform
          await HeftJestDataFile.saveForProjectAsync(heftConfiguration.buildFolder, {
            emitFolderNameForTests: build.properties.emitFolderNameForTests || 'lib',
            extensionForTests: build.properties.emitExtensionForTests || '.js',
            skipTimestampCheck: !build.properties.watchMode,
            // If the property isn't defined, assume it's a not a TypeScript project since this
            // value should be set by the Heft TypeScriptPlugin during the compile hook
            isTypeScriptProject: !!build.properties.isTypeScriptProject
          });
        });
      });
    });

    heftSession.hooks.test.tap(PLUGIN_NAME, (test: ITestStageContext) => {
      test.hooks.run.tapPromise(PLUGIN_NAME, async () => {
        await this._runJestAsync(heftSession, heftConfiguration, test, options);
      });
    });

    heftSession.hooks.clean.tap(PLUGIN_NAME, (clean: ICleanStageContext) => {
      this._includeJestCacheWhenCleaning(heftConfiguration, clean);
    });
  }

  private async _runJestAsync(
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    test: ITestStageContext,
    options?: IJestPluginOptions
  ): Promise<void> {
    const jestLogger: ScopedLogger = heftSession.requestScopedLogger('jest');
    const jestTerminal: ITerminal = jestLogger.terminal;
    jestTerminal.writeLine(`Using Jest version ${getVersion()}`);

    const buildFolder: string = heftConfiguration.buildFolder;
    await HeftJestDataFile.loadAndValidateForProjectAsync(buildFolder);

    let jestConfig: IHeftJestConfiguration;
    if (options?.disableConfigurationModuleResolution) {
      // Module resolution explicitly disabled, use the config as-is
      const jestConfigPath: string = this._getJestConfigPath(heftConfiguration);
      if (!(await FileSystem.existsAsync(jestConfigPath))) {
        jestLogger.emitError(new Error(`Expected to find jest config file at "${jestConfigPath}".`));
        return;
      }
      jestConfig = await JsonFile.loadAsync(jestConfigPath);
    } else {
      // Load in and resolve the config file using the "extends" field
      jestConfig = await JestPlugin.getJestConfigurationLoader(
        heftConfiguration.buildFolder
      ).loadConfigurationFileForProjectAsync(
        jestTerminal,
        heftConfiguration.buildFolder,
        heftConfiguration.rigConfig
      );
      if (jestConfig.preset) {
        throw new Error(
          'The provided jest.config.json specifies a "preset" property while using resolved modules. ' +
            'You must either remove all "preset" values from your Jest configuration, use the "extends" ' +
            'property, or set the "disableConfigurationModuleResolution" option to "true" on the Jest ' +
            'plugin in heft.json'
        );
      }
    }

    const jestArgv: Config.Argv = {
      watch: test.properties.watchMode,

      // In debug mode, avoid forking separate processes that are difficult to debug
      runInBand: heftSession.debugMode,
      debug: heftSession.debugMode,
      detectOpenHandles: !!test.properties.detectOpenHandles,

      cacheDirectory: this._getJestCacheFolder(heftConfiguration),
      updateSnapshot: test.properties.updateSnapshots,

      listTests: false,
      rootDir: buildFolder,

      silent: test.properties.silent,
      testNamePattern: test.properties.testNamePattern,
      testPathPattern: test.properties.testPathPattern ? [...test.properties.testPathPattern] : undefined,
      testTimeout: test.properties.testTimeout,
      maxWorkers: test.properties.maxWorkers,

      passWithNoTests: test.properties.passWithNoTests,

      $0: process.argv0,
      _: []
    };

    if (!test.properties.debugHeftReporter) {
      // Extract the reporters and transform to include the Heft reporter by default
      jestArgv.reporters = this._extractHeftJestReporters(
        jestConfig,
        heftSession,
        heftConfiguration,
        jestLogger
      );
    } else {
      jestLogger.emitWarning(
        new Error('The "--debug-heft-reporter" parameter was specified; disabling HeftJestReporter')
      );
    }

    if (test.properties.findRelatedTests && test.properties.findRelatedTests.length > 0) {
      // Pass test names as the command line remainder
      jestArgv.findRelatedTests = true;
      jestArgv._ = [...test.properties.findRelatedTests];
    }

    // Stringify the config and pass it into Jest directly
    jestArgv.config = JSON.stringify(jestConfig);

    const {
      // Config.Argv is weakly typed.  After updating the jestArgv object, it's a good idea to inspect "globalConfig"
      // in the debugger to validate that your changes are being applied as expected.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      globalConfig,
      results: jestResults
    } = await runCLI(jestArgv, [buildFolder]);

    if (jestResults.numFailedTests > 0) {
      jestLogger.emitError(
        new Error(
          `${jestResults.numFailedTests} Jest test${jestResults.numFailedTests > 1 ? 's' : ''} failed`
        )
      );
    } else if (jestResults.numFailedTestSuites > 0) {
      jestLogger.emitError(
        new Error(
          `${jestResults.numFailedTestSuites} Jest test suite${
            jestResults.numFailedTestSuites > 1 ? 's' : ''
          } failed`
        )
      );
    }
  }

  private _includeJestCacheWhenCleaning(
    heftConfiguration: HeftConfiguration,
    clean: ICleanStageContext
  ): void {
    // Jest's cache is not reliable.  For example, if a Jest configuration change causes files to be
    // transformed differently, the cache will continue to return the old results unless we manually
    // clean it.  Thus we need to ensure that "heft clean" always cleans the Jest cache.
    const cacheFolder: string = this._getJestCacheFolder(heftConfiguration);
    clean.properties.pathsToDelete.add(cacheFolder);
  }

  private _extractHeftJestReporters(
    config: IHeftJestConfiguration,
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    jestLogger: ScopedLogger
  ): JestReporterConfig[] {
    let isUsingHeftReporter: boolean = false;

    if (Array.isArray(config.reporters)) {
      // Harvest all the array indices that need to modified before altering the array
      const heftReporterIndices: number[] = this._findIndexes(config.reporters, 'default');

      // Replace 'default' reporter with the heft reporter
      // This may clobber default reporters options
      if (heftReporterIndices.length > 0) {
        const heftReporter: Config.ReporterConfig = this._getHeftJestReporterConfig(
          heftSession,
          heftConfiguration
        );

        for (const index of heftReporterIndices) {
          config.reporters[index] = heftReporter;
        }
        isUsingHeftReporter = true;
      }
    } else if (typeof config.reporters === 'undefined' || config.reporters === null) {
      // Otherwise if no reporters are specified install only the heft reporter
      config.reporters = [this._getHeftJestReporterConfig(heftSession, heftConfiguration)];
      isUsingHeftReporter = true;
    } else {
      // Making a note if Heft cannot understand the reporter entry in Jest config
      // Not making this an error or warning because it does not warrant blocking a dev or CI test pass
      // If the Jest config is truly wrong Jest itself is in a better position to report what is wrong with the config
      jestLogger.terminal.writeVerboseLine(
        `The 'reporters' entry in Jest config '${JEST_CONFIGURATION_LOCATION}' is in an unexpected format. Was ` +
          'expecting an array of reporters'
      );
    }

    if (!isUsingHeftReporter) {
      jestLogger.terminal.writeVerboseLine(
        `HeftJestReporter was not specified in Jest config '${JEST_CONFIGURATION_LOCATION}'. Consider adding a ` +
          "'default' entry in the reporters array."
      );
    }

    // Since we're injecting the HeftConfiguration, we need to pass these args directly and not through serialization
    const reporters: JestReporterConfig[] = config.reporters;
    config.reporters = undefined;
    return reporters;
  }

  private _getHeftJestReporterConfig(
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration
  ): Config.ReporterConfig {
    const reporterOptions: IHeftJestReporterOptions = {
      heftConfiguration,
      debugMode: heftSession.debugMode
    };

    return [
      `${__dirname}/HeftJestReporter.js`,
      reporterOptions as Record<keyof IHeftJestReporterOptions, unknown>
    ];
  }

  private _getJestConfigPath(heftConfiguration: HeftConfiguration): string {
    return path.join(heftConfiguration.buildFolder, JEST_CONFIGURATION_LOCATION);
  }

  private _getJestCacheFolder(heftConfiguration: HeftConfiguration): string {
    return path.join(heftConfiguration.buildCacheFolder, 'jest-cache');
  }

  /**
   * Finds the indices of jest reporters with a given name
   */
  private _findIndexes(items: JestReporterConfig[], search: string): number[] {
    const result: number[] = [];

    for (let index: number = 0; index < items.length; index++) {
      const item: JestReporterConfig = items[index];

      // Item is either a string or a tuple of [reporterName: string, options: unknown]
      if (item === search) {
        result.push(index);
      } else if (typeof item !== 'undefined' && item !== null && item[0] === search) {
        result.push(index);
      }
    }

    return result;
  }
}
