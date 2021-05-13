// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { Terminal } from '@rushstack/node-core-library';
import { ConfigurationFile, InheritanceType } from '@rushstack/heft-config-file';
import { RigConfig } from '@rushstack/rig-package';

import { RushConfigurationProject } from './RushConfigurationProject';
import { RushConstants } from '../logic/RushConstants';
import { CommandLineConfiguration } from './CommandLineConfiguration';

/**
 * Describes the file structure for the "<project root>/config/rush-project.json" config file.
 */
interface IRushProjectJson {
  /**
   * A list of folder names under the project root that should be cached.
   *
   * These folders should not be tracked by git.
   */
  projectOutputFolderNames?: string[];

  buildCacheOptions?: IBuildCacheOptionsJson;
}

interface IBuildCacheOptionsJson extends IBuildCacheOptionsBase {
  /**
   * Allows for fine-grained control of cache for individual commands.
   */
  optionsForCommands?: ICacheOptionsForCommand[];
}

export interface IBuildCacheOptionsBase {
  /**
   * Disable caching for this project. The project will never be restored from cache.
   * This may be useful if this project affects state outside of its folder.
   *
   * This option is only used when the cloud build cache is enabled for the repo. You can set
   * disableBuildCache=true to disable caching for a specific project. This is a useful workaround
   * if that project's build scripts violate the assumptions of the cache, for example by writing
   * files outside the project folder. Where possible, a better solution is to improve the build scripts
   * to be compatible with caching.
   */
  disableBuildCache?: boolean;
}

export interface IBuildCacheOptions extends IBuildCacheOptionsBase {
  /**
   * Allows for fine-grained control of cache for individual commands.
   */
  optionsForCommandsByName: Map<string, ICacheOptionsForCommand>;
}

export interface ICacheOptionsForCommand {
  /**
   * The command name.
   */
  name: string;

  /**
   * Disable caching for this command.
   * This may be useful if this command for this project affects state outside of this project folder.
   *
   * This option is only used when the cloud build cache is enabled for the repo. You can set
   * disableBuildCache=true to disable caching for a command in a specific project. This is a useful workaround
   * if that project's build scripts violate the assumptions of the cache, for example by writing
   * files outside the project folder. Where possible, a better solution is to improve the build scripts
   * to be compatible with caching.
   */
  disableBuildCache?: boolean;
}

/**
 * Use this class to load the "config/rush-project.json" config file.
 *
 * This file provides project-specific configuration options.
 * @public
 */
export class RushProjectConfiguration {
  private static _projectBuildCacheConfigurationFile: ConfigurationFile<IRushProjectJson> = new ConfigurationFile<IRushProjectJson>(
    {
      projectRelativeFilePath: `config/${RushConstants.rushProjectConfigFilename}`,
      jsonSchemaPath: path.resolve(__dirname, '..', 'schemas', 'rush-project.schema.json'),
      propertyInheritance: {
        projectOutputFolderNames: {
          inheritanceType: InheritanceType.append
        },
        buildCacheOptions: {
          inheritanceType: InheritanceType.custom,
          inheritanceFunction: (
            current: IBuildCacheOptionsJson | undefined,
            parent: IBuildCacheOptionsJson | undefined
          ): IBuildCacheOptionsJson | undefined => {
            if (!current) {
              return parent;
            } else if (!parent) {
              return current;
            } else {
              return {
                ...parent,
                ...current,
                optionsForCommands: [
                  ...(parent.optionsForCommands || []),
                  ...(current.optionsForCommands || [])
                ]
              };
            }
          }
        }
      }
    }
  );

  public readonly project: RushConfigurationProject;

  /**
   * A list of folder names under the project root that should be cached.
   *
   * These folders should not be tracked by git.
   */
  public readonly projectOutputFolderNames?: string[];

  /**
   * Project-specific cache options.
   */
  public readonly cacheOptions: IBuildCacheOptions;

  private constructor(project: RushConfigurationProject, rushProjectJson: IRushProjectJson) {
    this.project = project;

    this.projectOutputFolderNames = rushProjectJson.projectOutputFolderNames;

    const optionsForCommandsByName: Map<string, ICacheOptionsForCommand> = new Map<
      string,
      ICacheOptionsForCommand
    >();
    if (rushProjectJson.buildCacheOptions?.optionsForCommands) {
      for (const cacheOptionsForCommand of rushProjectJson.buildCacheOptions.optionsForCommands) {
        optionsForCommandsByName.set(cacheOptionsForCommand.name, cacheOptionsForCommand);
      }
    }
    this.cacheOptions = {
      disableBuildCache: rushProjectJson.buildCacheOptions?.disableBuildCache,
      optionsForCommandsByName
    };
  }

  /**
   * Loads the rush-project.json data for the specified project.
   */
  public static async tryLoadForProjectAsync(
    project: RushConfigurationProject,
    repoCommandLineConfiguration: CommandLineConfiguration | undefined,
    terminal: Terminal
  ): Promise<RushProjectConfiguration | undefined> {
    const rigConfig: RigConfig = await RigConfig.loadForProjectFolderAsync({
      projectFolderPath: project.projectFolder
    });

    const rushProjectJson:
      | IRushProjectJson
      | undefined = await this._projectBuildCacheConfigurationFile.tryLoadConfigurationFileForProjectAsync(
      terminal,
      project.projectFolder,
      rigConfig
    );

    if (rushProjectJson) {
      RushProjectConfiguration._validateConfiguration(
        project,
        rushProjectJson,
        repoCommandLineConfiguration,
        terminal
      );
      return new RushProjectConfiguration(project, rushProjectJson);
    } else {
      return undefined;
    }
  }

  private static _validateConfiguration(
    project: RushConfigurationProject,
    rushProjectJson: IRushProjectJson,
    repoCommandLineConfiguration: CommandLineConfiguration | undefined,
    terminal: Terminal
  ): void {
    const invalidFolderNames: string[] = [];
    for (const projectOutputFolder of rushProjectJson.projectOutputFolderNames || []) {
      if (projectOutputFolder.match(/[\/\\]/)) {
        invalidFolderNames.push(projectOutputFolder);
      }
    }

    if (invalidFolderNames.length > 0) {
      terminal.writeErrorLine(
        `Invalid project configuration for project "${project.packageName}". Entries in ` +
          '"projectOutputFolderNames" must not contain slashes and the following entries do: ' +
          invalidFolderNames.join(', ')
      );
    }

    const duplicateCommandNames: Set<string> = new Set<string>();
    const invalidCommandNames: string[] = [];
    if (rushProjectJson.buildCacheOptions?.optionsForCommands) {
      const commandNames: Set<string> = new Set<string>([
        RushConstants.buildCommandName,
        RushConstants.rebuildCommandName
      ]);
      if (repoCommandLineConfiguration) {
        for (const [commandName, command] of repoCommandLineConfiguration.commands) {
          if (command.commandKind === RushConstants.bulkCommandKind) {
            commandNames.add(commandName);
          }
        }
      }

      const alreadyEncounteredCommandNames: Set<string> = new Set<string>();
      for (const cacheOptionsForCommand of rushProjectJson.buildCacheOptions.optionsForCommands) {
        const commandName: string = cacheOptionsForCommand.name;
        if (!commandNames.has(commandName)) {
          invalidCommandNames.push(commandName);
        } else if (alreadyEncounteredCommandNames.has(commandName)) {
          duplicateCommandNames.add(commandName);
        } else {
          alreadyEncounteredCommandNames.add(commandName);
        }
      }
    }

    if (invalidCommandNames.length > 0) {
      terminal.writeErrorLine(
        `Invalid project configuration fpr project "${project.packageName}". The following ` +
          'command names in cacheOptions.optionsForCommands are not specified in this repo: ' +
          invalidCommandNames.join(', ')
      );
    }

    if (duplicateCommandNames.size > 0) {
      terminal.writeErrorLine(
        `Invalid project configuration fpr project "${project.packageName}". The following ` +
          'command names in cacheOptions.optionsForCommands are specified more than once: ' +
          Array.from(duplicateCommandNames).join(', ')
      );
    }
  }
}
