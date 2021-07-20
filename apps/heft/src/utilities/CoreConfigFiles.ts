// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import {
  ConfigurationFile,
  IConfigurationFileOptions,
  InheritanceType,
  PathResolutionMethod
} from '@rushstack/heft-config-file';

import { IApiExtractorPluginConfiguration } from '../plugins/ApiExtractorPlugin/ApiExtractorPlugin';
import { ITypeScriptConfigurationJson } from '../plugins/TypeScriptPlugin/TypeScriptPlugin';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { Terminal } from '@rushstack/node-core-library';
import { INodeServicePluginConfiguration } from '../plugins/NodeServicePlugin';

export enum HeftEvent {
  // Part of the 'clean' stage
  clean = 'clean',

  // Part of the 'build' stage
  preCompile = 'pre-compile',
  compile = 'compile',
  bundle = 'bundle',
  postBuild = 'post-build',

  // Part of the 'test' stage
  test = 'test'
}

export interface IHeftConfigurationJsonEventActionBase {
  actionKind: string;
  heftEvent: 'clean' | 'pre-compile' | 'compile' | 'bundle' | 'post-build' | 'test';
  actionId: string;
}

export interface IHeftConfigurationDeleteGlobsEventAction extends IHeftConfigurationJsonEventActionBase {
  actionKind: 'deleteGlobs';
  globsToDelete: string[];
}

export interface IHeftConfigurationRunScriptEventAction extends IHeftConfigurationJsonEventActionBase {
  actionKind: 'runScript';
  scriptPath: string;
  scriptOptions: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ISharedCopyConfiguration {
  /**
   * File extensions that should be copied from the source folder to the destination folder(s)
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

  /**
   * Copy only the file and discard the relative path from the source folder.
   */
  flatten?: boolean;

  /**
   * Hardlink files instead of copying.
   */
  hardlink?: boolean;
}

export interface IExtendedSharedCopyConfiguration extends ISharedCopyConfiguration {
  /**
   * The folder from which files should be copied, relative to the project root. For example, "src".
   */
  sourceFolder: string;

  /**
   * Folder(s) to which files should be copied, relative to the project root. For example ["lib", "lib-cjs"].
   */
  destinationFolders: string[];
}

export interface IHeftConfigurationCopyFilesEventAction extends IHeftConfigurationJsonEventActionBase {
  actionKind: 'copyFiles';
  copyOperations: IExtendedSharedCopyConfiguration[];
}

export interface IHeftConfigurationJsonPluginSpecifier {
  plugin: string;
  options?: object;
}

export interface IHeftConfigurationJson {
  eventActions?: IHeftConfigurationJsonEventActionBase[];
  heftPlugins?: IHeftConfigurationJsonPluginSpecifier[];
}

export interface IHeftEventActions {
  copyFiles: Map<HeftEvent, IHeftConfigurationCopyFilesEventAction[]>;
  deleteGlobs: Map<HeftEvent, IHeftConfigurationDeleteGlobsEventAction[]>;
  runScript: Map<HeftEvent, IHeftConfigurationRunScriptEventAction[]>;
}

export class CoreConfigFiles {
  private static _heftConfigFileLoader: ConfigurationFile<IHeftConfigurationJson> | undefined;

  private static _heftConfigFileEventActionsCache: Map<HeftConfiguration, IHeftEventActions> = new Map<
    HeftConfiguration,
    IHeftEventActions
  >();

  private static _apiExtractorTaskConfigurationLoader:
    | ConfigurationFile<IApiExtractorPluginConfiguration>
    | undefined;
  private static _typeScriptConfigurationFileLoader:
    | ConfigurationFile<ITypeScriptConfigurationJson>
    | undefined;
  private static _nodeServiceConfigurationLoader:
    | ConfigurationFile<INodeServicePluginConfiguration>
    | undefined;

  /**
   * Returns the loader for the `config/heft.json` config file.
   */
  public static get heftConfigFileLoader(): ConfigurationFile<IHeftConfigurationJson> {
    if (!CoreConfigFiles._heftConfigFileLoader) {
      const schemaPath: string = path.join(__dirname, '..', 'schemas', 'heft.schema.json');
      CoreConfigFiles._heftConfigFileLoader = new ConfigurationFile<IHeftConfigurationJson>({
        projectRelativeFilePath: 'config/heft.json',
        jsonSchemaPath: schemaPath,
        propertyInheritance: {
          heftPlugins: {
            inheritanceType: InheritanceType.append
          }
        },
        jsonPathMetadata: {
          '$.heftPlugins.*.plugin': {
            pathResolutionMethod: PathResolutionMethod.NodeResolve
          },
          '$.eventActions.[?(@.actionKind==="runScript")].scriptPath': {
            pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
          }
        }
      });
    }

    return CoreConfigFiles._heftConfigFileLoader;
  }

  /**
   * Gets the eventActions from config/heft.json
   */
  public static async getConfigConfigFileEventActionsAsync(
    terminal: Terminal,
    heftConfiguration: HeftConfiguration
  ): Promise<IHeftEventActions> {
    let result: IHeftEventActions | undefined =
      CoreConfigFiles._heftConfigFileEventActionsCache.get(heftConfiguration);
    if (!result) {
      const heftConfigJson: IHeftConfigurationJson | undefined =
        await CoreConfigFiles.heftConfigFileLoader.tryLoadConfigurationFileForProjectAsync(
          terminal,
          heftConfiguration.buildFolder,
          heftConfiguration.rigConfig
        );

      result = {
        copyFiles: new Map<HeftEvent, IHeftConfigurationCopyFilesEventAction[]>(),
        deleteGlobs: new Map<HeftEvent, IHeftConfigurationDeleteGlobsEventAction[]>(),
        runScript: new Map<HeftEvent, IHeftConfigurationRunScriptEventAction[]>()
      };
      CoreConfigFiles._heftConfigFileEventActionsCache.set(heftConfiguration, result);

      for (const eventAction of heftConfigJson?.eventActions || []) {
        switch (eventAction.actionKind) {
          case 'copyFiles': {
            CoreConfigFiles._addEventActionToMap(
              eventAction as IHeftConfigurationCopyFilesEventAction,
              result.copyFiles
            );
            break;
          }

          case 'deleteGlobs': {
            CoreConfigFiles._addEventActionToMap(
              eventAction as IHeftConfigurationDeleteGlobsEventAction,
              result.deleteGlobs
            );
            break;
          }

          case 'runScript': {
            CoreConfigFiles._addEventActionToMap(
              eventAction as IHeftConfigurationRunScriptEventAction,
              result.runScript
            );
            break;
          }

          default: {
            throw new Error(
              `Unknown heft eventAction actionKind "${eventAction.actionKind}" in ` +
                `"${CoreConfigFiles.heftConfigFileLoader.getObjectSourceFilePath(eventAction)}" `
            );
          }
        }
      }
    }

    return result;
  }

  /**
   * Returns the loader for the `config/api-extractor-task.json` config file.
   */
  public static get apiExtractorTaskConfigurationLoader(): ConfigurationFile<IApiExtractorPluginConfiguration> {
    if (!CoreConfigFiles._apiExtractorTaskConfigurationLoader) {
      const schemaPath: string = path.resolve(__dirname, '..', 'schemas', 'api-extractor-task.schema.json');
      CoreConfigFiles._apiExtractorTaskConfigurationLoader =
        new ConfigurationFile<IApiExtractorPluginConfiguration>({
          projectRelativeFilePath: 'config/api-extractor-task.json',
          jsonSchemaPath: schemaPath
        });
    }

    return CoreConfigFiles._apiExtractorTaskConfigurationLoader;
  }

  /**
   * Returns the loader for the `config/typescript.json` config file.
   */
  public static get typeScriptConfigurationFileLoader(): ConfigurationFile<ITypeScriptConfigurationJson> {
    if (!CoreConfigFiles._typeScriptConfigurationFileLoader) {
      const schemaPath: string = path.resolve(__dirname, '..', 'schemas', 'typescript.schema.json');
      CoreConfigFiles._typeScriptConfigurationFileLoader =
        new ConfigurationFile<ITypeScriptConfigurationJson>({
          projectRelativeFilePath: 'config/typescript.json',
          jsonSchemaPath: schemaPath,
          propertyInheritance: {
            staticAssetsToCopy: {
              inheritanceType: InheritanceType.custom,
              inheritanceFunction: (
                currentObject: ISharedCopyConfiguration,
                parentObject: ISharedCopyConfiguration
              ): ISharedCopyConfiguration => {
                const result: ISharedCopyConfiguration = {};

                CoreConfigFiles._inheritArray(result, 'fileExtensions', currentObject, parentObject);
                CoreConfigFiles._inheritArray(result, 'includeGlobs', currentObject, parentObject);
                CoreConfigFiles._inheritArray(result, 'excludeGlobs', currentObject, parentObject);

                return result;
              }
            }
          }
        } as IConfigurationFileOptions<ITypeScriptConfigurationJson>);
    }

    return CoreConfigFiles._typeScriptConfigurationFileLoader;
  }

  /**
   * Returns the loader for the `config/api-extractor-task.json` config file.
   */
  public static get nodeServiceConfigurationLoader(): ConfigurationFile<INodeServicePluginConfiguration> {
    if (!CoreConfigFiles._nodeServiceConfigurationLoader) {
      const schemaPath: string = path.resolve(__dirname, '..', 'schemas', 'node-service.schema.json');
      CoreConfigFiles._nodeServiceConfigurationLoader =
        new ConfigurationFile<INodeServicePluginConfiguration>({
          projectRelativeFilePath: 'config/node-service.json',
          jsonSchemaPath: schemaPath
        });
    }

    return CoreConfigFiles._nodeServiceConfigurationLoader;
  }

  private static _addEventActionToMap<TEventAction extends IHeftConfigurationJsonEventActionBase>(
    eventAction: TEventAction,
    map: Map<HeftEvent, TEventAction[]>
  ): void {
    const heftEvent: HeftEvent = CoreConfigFiles._parseHeftEvent(eventAction);
    let eventArray: TEventAction[] | undefined = map.get(heftEvent);
    if (!eventArray) {
      eventArray = [];
      map.set(heftEvent, eventArray);
    }

    eventArray.push(eventAction);
  }

  private static _parseHeftEvent(eventAction: IHeftConfigurationJsonEventActionBase): HeftEvent {
    switch (eventAction.heftEvent) {
      case 'clean':
        return HeftEvent.clean;

      case 'pre-compile':
        return HeftEvent.preCompile;

      case 'compile':
        return HeftEvent.compile;

      case 'bundle':
        return HeftEvent.bundle;

      case 'post-build':
        return HeftEvent.postBuild;

      case 'test':
        return HeftEvent.test;

      default:
        throw new Error(
          `Unknown heft event "${eventAction.heftEvent}" in ` +
            ` "${CoreConfigFiles.heftConfigFileLoader.getObjectSourceFilePath(eventAction)}".`
        );
    }
  }

  private static _inheritArray<
    TResultObject extends { [P in TArrayKeys]?: unknown[] },
    TArrayKeys extends keyof TResultObject
  >(
    resultObject: TResultObject,
    propertyName: TArrayKeys,
    currentObject: TResultObject,
    parentObject: TResultObject
  ): void {
    let newValue: unknown[] | undefined;
    if (currentObject[propertyName] && parentObject[propertyName]) {
      newValue = [
        ...(currentObject[propertyName] as unknown[]),
        ...(parentObject[propertyName] as unknown[])
      ];
    } else {
      newValue = currentObject[propertyName] || parentObject[propertyName];
    }

    if (newValue !== undefined) {
      resultObject[propertyName] = newValue as TResultObject[TArrayKeys];
    }
  }
}
