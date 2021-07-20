// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import {
  HeftConfiguration,
  HeftSession,
  IBuildStageContext,
  IHeftPlugin,
  IPreCompileSubstage,
  ScopedLogger
} from '@rushstack/heft';
import { ConfigurationFile, PathResolutionMethod } from '@rushstack/heft-config-file';
import { JsonSchema } from '@rushstack/node-core-library';
import { ISassConfiguration, SassTypingsGenerator } from './SassTypingsGenerator';
import { Async } from './utilities/Async';

export interface ISassConfigurationJson extends ISassConfiguration {}

const PLUGIN_NAME: string = 'SassTypingsPlugin';
const PLUGIN_SCHEMA_PATH: string = path.resolve(__dirname, 'schemas', 'heft-sass-plugin.schema.json');
const SASS_CONFIGURATION_LOCATION: string = 'config/sass.json';

export class SassTypingsPlugin implements IHeftPlugin {
  public readonly pluginName: string = PLUGIN_NAME;
  public readonly optionsSchema: JsonSchema = JsonSchema.fromFile(PLUGIN_SCHEMA_PATH);

  /**
   * Generate typings for Sass files before TypeScript compilation.
   */
  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    heftSession.hooks.build.tap(PLUGIN_NAME, (build: IBuildStageContext) => {
      build.hooks.preCompile.tap(PLUGIN_NAME, (preCompile: IPreCompileSubstage) => {
        preCompile.hooks.run.tapPromise(PLUGIN_NAME, async () => {
          await this._runSassTypingsGeneratorAsync(
            heftSession,
            heftConfiguration,
            build.properties.watchMode
          );
        });
      });
    });
  }

  private async _runSassTypingsGeneratorAsync(
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    isWatchMode: boolean
  ): Promise<void> {
    const logger: ScopedLogger = heftSession.requestScopedLogger('sass-typings-generator');
    const sassConfiguration: ISassConfiguration = await this._loadSassConfigurationAsync(
      heftConfiguration,
      logger
    );
    const sassTypingsGenerator: SassTypingsGenerator = new SassTypingsGenerator({
      buildFolder: heftConfiguration.buildFolder,
      sassConfiguration
    });

    await sassTypingsGenerator.generateTypingsAsync();
    if (isWatchMode) {
      Async.runWatcherWithErrorHandling(async () => await sassTypingsGenerator.runWatcherAsync(), logger);
    }
  }

  private async _loadSassConfigurationAsync(
    heftConfiguration: HeftConfiguration,
    logger: ScopedLogger
  ): Promise<ISassConfiguration> {
    const { buildFolder } = heftConfiguration;
    const sassConfigurationJson: ISassConfigurationJson | undefined =
      await SassTypingsPlugin._getSassConfigurationLoader().tryLoadConfigurationFileForProjectAsync(
        logger.terminal,
        buildFolder,
        heftConfiguration.rigConfig
      );

    return {
      ...sassConfigurationJson
    };
  }

  private static _getSassConfigurationLoader(): ConfigurationFile<ISassConfigurationJson> {
    return new ConfigurationFile<ISassConfigurationJson>({
      projectRelativeFilePath: SASS_CONFIGURATION_LOCATION,
      jsonSchemaPath: PLUGIN_SCHEMA_PATH,
      jsonPathMetadata: {
        '$.importIncludePaths.*': {
          pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
        },
        '$.generatedTsFolder.*': {
          pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
        },
        '$.srcFolder.*': {
          pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
        }
      }
    });
  }
}
