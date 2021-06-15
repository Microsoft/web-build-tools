// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { IPackageJson, PackageJsonLookup, InternalError } from '@rushstack/node-core-library';
import { Terminal, ITerminal, ITerminalProvider } from '@rushstack/terminal';
import { trueCasePathSync } from 'true-case-path';
import { RigConfig } from '@rushstack/rig-package';

import { Constants } from '../utilities/Constants';

/**
 * @internal
 */
export interface IHeftConfigurationInitializationOptions {
  /**
   * The working directory the tool was executed in.
   */
  cwd: string;

  /**
   * Terminal provider instance to facilitate logging.
   */
  terminalProvider: ITerminalProvider;
}

/**
 * The base action configuration that all custom action configuration files
 * should inherit from.
 *
 * @public
 */
export interface IHeftActionConfiguration {}

/**
 * Options to be used when retrieving the action configuration.
 *
 * @public
 */
export interface IHeftActionConfigurationOptions {
  /**
   * Whether or not arrays should be merged across Heft action configuration files.
   */
  mergeArrays?: boolean;
}

/**
 * @public
 */
export class HeftConfiguration {
  private _buildFolder!: string;
  private _projectHeftDataFolder: string | undefined;
  private _projectConfigFolder: string | undefined;
  private _buildCacheFolder: string | undefined;
  private _rigConfig: RigConfig | undefined;
  private _globalTerminal!: ITerminal;
  private _terminalProvider!: ITerminalProvider;

  /**
   * Project build folder. This is the folder containing the project's package.json file.
   */
  public get buildFolder(): string {
    return this._buildFolder;
  }

  /**
   * The path to the project's ".heft" folder.
   */
  public get projectHeftDataFolder(): string {
    if (!this._projectHeftDataFolder) {
      this._projectHeftDataFolder = path.join(this.buildFolder, Constants.projectHeftFolderName);
    }

    return this._projectHeftDataFolder;
  }

  /**
   * The path to the project's "config" folder.
   */
  public get projectConfigFolder(): string {
    if (!this._projectConfigFolder) {
      this._projectConfigFolder = path.join(this.buildFolder, Constants.projectConfigFolderName);
    }

    return this._projectConfigFolder;
  }

  /**
   * The project's build cache folder.
   *
   * This folder exists at \<project root\>/.heft/build-cache. TypeScript's output
   * goes into this folder and then is either copied or linked to the final output folder
   */
  public get buildCacheFolder(): string {
    if (!this._buildCacheFolder) {
      this._buildCacheFolder = path.join(this.projectHeftDataFolder, Constants.buildCacheFolderName);
    }

    return this._buildCacheFolder;
  }

  /**
   * The rig.json configuration for this project, if present.
   */
  public get rigConfig(): RigConfig {
    if (!this._rigConfig) {
      throw new InternalError(
        'The rigConfig cannot be accessed until HeftConfiguration.checkForRigAsync() has been called'
      );
    }
    return this._rigConfig;
  }

  /**
   * Terminal instance to facilitate logging.
   */
  public get globalTerminal(): ITerminal {
    return this._globalTerminal;
  }

  /**
   * Terminal provider for the provided terminal.
   */
  public get terminalProvider(): ITerminalProvider {
    return this._terminalProvider;
  }

  /**
   * The Heft tool's package.json
   */
  public get heftPackageJson(): IPackageJson {
    return PackageJsonLookup.instance.tryLoadPackageJsonFor(__dirname)!;
  }

  /**
   * The package.json of the project being built
   */
  public get projectPackageJson(): IPackageJson {
    return PackageJsonLookup.instance.tryLoadPackageJsonFor(this.buildFolder)!;
  }

  private constructor() {}

  /**
   * Performs the search for rig.json and initializes the `HeftConfiguration.rigConfig` object.
   * @internal
   */
  public async _checkForRigAsync(): Promise<void> {
    if (!this._rigConfig) {
      this._rigConfig = await RigConfig.loadForProjectFolderAsync({ projectFolderPath: this._buildFolder });
    }
  }

  /**
   * @internal
   */
  public static initialize(options: IHeftConfigurationInitializationOptions): HeftConfiguration {
    const configuration: HeftConfiguration = new HeftConfiguration();

    const packageJsonPath: string | undefined = PackageJsonLookup.instance.tryGetPackageJsonFilePathFor(
      options.cwd
    );
    if (packageJsonPath) {
      let buildFolder: string = path.dirname(packageJsonPath);
      // The CWD path's casing may be incorrect on a case-insensitive filesystem. Some tools, like Jest
      // expect the casing of the project path to be correct and produce unexpected behavior when the casing
      // isn't correct.
      // This ensures the casing of the project folder is correct.
      buildFolder = trueCasePathSync(buildFolder);
      configuration._buildFolder = buildFolder;
    } else {
      throw new Error('No package.json file found. Are you in a project folder?');
    }

    configuration._terminalProvider = options.terminalProvider;
    configuration._globalTerminal = new Terminal(options.terminalProvider);

    return configuration;
  }
}
