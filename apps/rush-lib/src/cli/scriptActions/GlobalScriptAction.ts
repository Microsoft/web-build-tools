// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import colors from 'colors/safe';
import * as os from 'os';
import * as path from 'path';

import {
  FileSystem,
  LockFile,
  IPackageJson,
  JsonFile,
  AlreadyReportedError
} from '@rushstack/node-core-library';
import { BaseScriptAction, IBaseScriptActionOptions } from './BaseScriptAction';
import { Utilities } from '../../utilities/Utilities';
import { InstallHelpers } from '../../logic/installManager/InstallHelpers';
import { RushConstants } from '../../logic/RushConstants';
import { LastInstallFlag } from '../../api/LastInstallFlag';
import { Autoinstaller } from '../../logic/Autoinstaller';

/**
 * Constructor parameters for GlobalScriptAction.
 */
export interface IGlobalScriptActionOptions extends IBaseScriptActionOptions {
  shellCommand: string;
  autoinstallerName: string | undefined;
}

/**
 * This class implements custom commands that are run once globally for the entire repo
 * (versus bulk commands, which run separately for each project).  The action executes
 * a user-defined script file.
 *
 * @remarks
 * Bulk commands can be defined via common/config/command-line.json.  Rush's predefined "build"
 * and "rebuild" commands are also modeled as bulk commands, because they essentially just
 * invoke scripts from package.json in the same way as a custom command.
 */
export class GlobalScriptAction extends BaseScriptAction {
  private readonly _shellCommand: string;
  private readonly _autoinstallerName: string;
  private readonly _autoinstallerFullPath: string;

  public constructor(options: IGlobalScriptActionOptions) {
    super(options);
    this._shellCommand = options.shellCommand;
    this._autoinstallerName = options.autoinstallerName || '';

    if (this._autoinstallerName) {
      Autoinstaller.validateName(this._autoinstallerName);

      // Example: .../common/autoinstallers/my-task
      this._autoinstallerFullPath = path.join(
        this.rushConfiguration.commonAutoinstallersFolder,
        this._autoinstallerName
      );

      if (!FileSystem.exists(this._autoinstallerFullPath)) {
        throw new Error(
          `The custom command "${this.actionName}" specifies an "autoinstallerName" setting` +
            ' but the path does not exist: ' +
            this._autoinstallerFullPath
        );
      }

      // Example: .../common/autoinstallers/my-task/package.json
      const packageJsonPath: string = path.join(this._autoinstallerFullPath, 'package.json');
      if (!FileSystem.exists(packageJsonPath)) {
        throw new Error(
          `The custom command "${this.actionName}" specifies an "autoinstallerName" setting` +
            ` whose package.json file was not found: ` +
            packageJsonPath
        );
      }

      const packageJson: IPackageJson = JsonFile.load(packageJsonPath);

      if (packageJson.name !== this._autoinstallerName) {
        throw new Error(
          `The custom command "${this.actionName}" specifies an "autoinstallerName" setting,` +
            ` but the package.json file's "name" field is not "${this._autoinstallerName}": ` +
            packageJsonPath
        );
      }
    } else {
      this._autoinstallerFullPath = '';
    }
  }

  private async _prepareAutoinstallerName(): Promise<void> {
    await InstallHelpers.ensureLocalPackageManager(
      this.rushConfiguration,
      this.rushGlobalFolder,
      RushConstants.defaultMaxInstallAttempts
    );

    // Example: common/autoinstallers/my-task/package.json
    const relativePathForLogs: string = path.relative(
      this.rushConfiguration.rushJsonFolder,
      this._autoinstallerFullPath
    );

    console.log(`Acquiring lock for "${relativePathForLogs}" folder...`);

    const lock: LockFile = await LockFile.acquire(this._autoinstallerFullPath, 'autoinstaller');

    // Example: .../common/autoinstallers/my-task/.rush/temp
    const lastInstallFlagPath: string = path.join(
      this._autoinstallerFullPath,
      RushConstants.projectRushFolderName,
      'temp'
    );

    const packageJsonPath: string = path.join(this._autoinstallerFullPath, 'package.json');
    const packageJson: IPackageJson = JsonFile.load(packageJsonPath);

    const lastInstallFlag: LastInstallFlag = new LastInstallFlag(lastInstallFlagPath, {
      node: process.versions.node,
      packageManager: this.rushConfiguration.packageManager,
      packageManagerVersion: this.rushConfiguration.packageManagerToolVersion,
      packageJson: packageJson
    });

    if (!lastInstallFlag.isValid() || lock.dirtyWhenAcquired) {
      // Example: ../common/autoinstallers/my-task/node_modules
      const nodeModulesFolder: string = path.join(this._autoinstallerFullPath, 'node_modules');

      if (FileSystem.exists(nodeModulesFolder)) {
        console.log('Deleting old files from ' + nodeModulesFolder);
        FileSystem.ensureEmptyFolder(nodeModulesFolder);
      }

      // Copy: .../common/autoinstallers/my-task/.npmrc
      Utilities.syncNpmrc(this.rushConfiguration.commonRushConfigFolder, this._autoinstallerFullPath);

      console.log(`Installing dependencies under ${this._autoinstallerFullPath}...\n`);

      Utilities.executeCommand({
        command: this.rushConfiguration.packageManagerToolFilename,
        args: ['install', '--frozen-lockfile'],
        workingDirectory: this._autoinstallerFullPath,
        keepEnvironment: true
      });

      // Create file: ../common/autoinstallers/my-task/.rush/temp/last-install.flag
      lastInstallFlag.create();

      console.log('Autoinstall completed successfully\n');
    } else {
      console.log('Autoinstaller folder is already up to date\n');
    }

    lock.release();
  }

  public async runAsync(): Promise<void> {
    const additionalPathFolders: string[] = [];

    if (this._autoinstallerName) {
      await this._prepareAutoinstallerName();

      const autoinstallerNameBinPath: string = path.join(this._autoinstallerFullPath, 'node_modules', '.bin');
      additionalPathFolders.push(autoinstallerNameBinPath);
    }

    // Collect all custom parameter values
    const customParameterValues: string[] = [];

    for (const customParameter of this.customParameters.values()) {
      customParameter.appendToArgList(customParameterValues);
    }

    let shellCommand: string = this._shellCommand;
    if (customParameterValues.length > 0) {
      shellCommand += ' ' + customParameterValues.join(' ');
    }

    const exitCode: number = Utilities.executeLifecycleCommand(shellCommand, {
      rushConfiguration: this.rushConfiguration,
      workingDirectory: this.rushConfiguration.rushJsonFolder,
      initCwd: this.rushConfiguration.commonTempFolder,
      handleOutput: false,
      environmentPathOptions: {
        includeRepoBin: true,
        additionalPathFolders: additionalPathFolders
      }
    });

    process.exitCode = exitCode;

    if (exitCode > 0) {
      console.log(os.EOL + colors.red(`The script failed with exit code ${exitCode}`));
      throw new AlreadyReportedError();
    }
  }

  protected onDefineParameters(): void {
    this.defineScriptParameters();
  }
}
