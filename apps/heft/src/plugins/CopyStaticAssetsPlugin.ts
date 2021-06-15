// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { ITerminal } from '@rushstack/terminal';
import { ConfigurationFile, InheritanceType, PathResolutionMethod } from '@rushstack/heft-config-file';

import { HeftSession } from '../pluginFramework/HeftSession';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { IBuildStageContext, ICompileSubstage } from '../stages/BuildStage';
import { ScopedLogger } from '../pluginFramework/logging/ScopedLogger';
import { CoreConfigFiles } from '../utilities/CoreConfigFiles';
import { ITypeScriptConfigurationJson } from './TypeScriptPlugin/TypeScriptPlugin';
import { CopyFilesPlugin, IResolvedDestinationCopyConfiguration } from './CopyFilesPlugin';

const PLUGIN_NAME: string = 'CopyStaticAssetsPlugin';

interface IPartialTsconfigCompilerOptions {
  outDir?: string;
}

interface IPartialTsconfig {
  compilerOptions?: IPartialTsconfigCompilerOptions;
}

export class CopyStaticAssetsPlugin extends CopyFilesPlugin {
  private static __partialTsconfigFileLoader: ConfigurationFile<IPartialTsconfig> | undefined;

  private static get _partialTsconfigFileLoader(): ConfigurationFile<IPartialTsconfig> {
    if (!CopyStaticAssetsPlugin.__partialTsconfigFileLoader) {
      const schemaPath: string = path.resolve(__dirname, '..', 'schemas', 'anything.schema.json');
      CopyStaticAssetsPlugin.__partialTsconfigFileLoader = new ConfigurationFile<IPartialTsconfig>({
        projectRelativeFilePath: 'tsconfig.json',
        jsonSchemaPath: schemaPath,
        propertyInheritance: {
          compilerOptions: {
            inheritanceType: InheritanceType.custom,
            inheritanceFunction: (
              currentObject: IPartialTsconfigCompilerOptions | undefined,
              parentObject: IPartialTsconfigCompilerOptions | undefined
            ) => {
              if (currentObject && !parentObject) {
                return currentObject;
              } else if (!currentObject && parentObject) {
                return parentObject;
              } else if (parentObject && currentObject) {
                return {
                  ...parentObject,
                  ...currentObject
                };
              } else {
                return undefined;
              }
            }
          }
        },
        jsonPathMetadata: {
          '$.compilerOptions.outDir': {
            pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToConfigurationFile
          }
        }
      });
    }

    return CopyStaticAssetsPlugin.__partialTsconfigFileLoader;
  }

  /**
   * @override
   */
  public readonly pluginName: string = PLUGIN_NAME;

  /**
   * @override
   */
  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    heftSession.hooks.build.tap(PLUGIN_NAME, (build: IBuildStageContext) => {
      build.hooks.compile.tap(PLUGIN_NAME, (compile: ICompileSubstage) => {
        compile.hooks.run.tapPromise(PLUGIN_NAME, async () => {
          const logger: ScopedLogger = heftSession.requestScopedLogger('copy-static-assets');

          const copyStaticAssetsConfiguration: IResolvedDestinationCopyConfiguration =
            await this._loadCopyStaticAssetsConfigurationAsync(logger.terminal, heftConfiguration);

          await this.runCopyAsync({
            logger,
            copyConfigurations: [copyStaticAssetsConfiguration],
            buildFolder: heftConfiguration.buildFolder,
            watchMode: build.properties.watchMode
          });
        });
      });
    });
  }

  private async _loadCopyStaticAssetsConfigurationAsync(
    terminal: ITerminal,
    heftConfiguration: HeftConfiguration
  ): Promise<IResolvedDestinationCopyConfiguration> {
    const typescriptConfiguration: ITypeScriptConfigurationJson | undefined =
      await CoreConfigFiles.typeScriptConfigurationFileLoader.tryLoadConfigurationFileForProjectAsync(
        terminal,
        heftConfiguration.buildFolder,
        heftConfiguration.rigConfig
      );

    const resolvedDestinationFolderPaths: Set<string> = new Set<string>();
    const destinationFolderNames: Set<string> = new Set<string>();

    const tsconfigDestinationFolderPath: string | undefined = await this._tryGetTsconfigOutDirPathAsync(
      heftConfiguration.buildFolder,
      terminal
    );
    if (tsconfigDestinationFolderPath) {
      resolvedDestinationFolderPaths.add(tsconfigDestinationFolderPath);
      destinationFolderNames.add(path.relative(heftConfiguration.buildFolder, tsconfigDestinationFolderPath));
    }

    for (const emitModule of typescriptConfiguration?.additionalModuleKindsToEmit || []) {
      resolvedDestinationFolderPaths.add(
        path.resolve(heftConfiguration.buildFolder, emitModule.outFolderName)
      );
      destinationFolderNames.add(emitModule.outFolderName);
    }

    return {
      ...typescriptConfiguration?.staticAssetsToCopy,

      // For now - these may need to be revised later
      sourceFolder: 'src',
      destinationFolders: Array.from(destinationFolderNames),
      resolvedDestinationFolderPaths: Array.from(resolvedDestinationFolderPaths),
      flatten: false,
      hardlink: false
    };
  }

  private async _tryGetTsconfigOutDirPathAsync(
    projectFolder: string,
    terminal: ITerminal
  ): Promise<string | undefined> {
    const partialTsconfig: IPartialTsconfig | undefined =
      await CopyStaticAssetsPlugin._partialTsconfigFileLoader.tryLoadConfigurationFileForProjectAsync(
        terminal,
        projectFolder
      );
    return partialTsconfig?.compilerOptions?.outDir;
  }
}
