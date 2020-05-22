// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as colors from 'colors';
import * as os from 'os';
import * as path from 'path';

import {
  CommandLineAction,
  CommandLineStringListParameter,
  ICommandLineActionOptions
} from '@rushstack/ts-command-line';

import { LockFile } from '@rushstack/node-core-library';

import { AlreadyReportedError } from '../../utilities/AlreadyReportedError';
import { EventHooksManager } from '../../logic/EventHooksManager';
import { PackageJsonLookup, IPackageJson } from '@rushstack/node-core-library';
import { RushCommandLineParser } from './../RushCommandLineParser';
import { RushConfiguration } from '../../api/RushConfiguration';
import { RushGlobalFolder } from '../../api/RushGlobalFolder'
import { Utilities } from '../../utilities/Utilities';

export interface IBaseRushActionOptions extends ICommandLineActionOptions {
  /**
   * By default, Rush operations acquire a lock file which prevents multiple commands from executing simultaneously
   * in the same repo folder.  (For example, it would be a mistake to run "rush install" and "rush build" at the
   * same time.)  If your command makes sense to run concurrently with other operations,
   * set safeForSimultaneousRushProcesses=true to disable this protection.  In particular, this is needed for
   * custom scripts that invoke other Rush commands.
   */
  safeForSimultaneousRushProcesses?: boolean;

  /**
   * The rush parser.
   */
  parser: RushCommandLineParser;
}

/**
 * The base class for a few specialized Rush command-line actions that
 * can be used without a rush.json configuration.
 */
export abstract class BaseConfiglessRushAction extends CommandLineAction {
  private _parser: RushCommandLineParser;
  private _safeForSimultaneousRushProcesses: boolean;

  protected get rushConfiguration(): RushConfiguration | undefined {
    return this._parser.rushConfiguration;
  }

  protected get rushGlobalFolder(): RushGlobalFolder {
    return this._parser.rushGlobalFolder;
  }

  protected get parser(): RushCommandLineParser {
    return this._parser;
  }

  public constructor(options: IBaseRushActionOptions) {
    super(options);

    this._parser = options.parser;
    this._safeForSimultaneousRushProcesses = !!options.safeForSimultaneousRushProcesses;
  }

  protected onExecute(): Promise<void> {
    this._ensureEnvironment();

    if (this.rushConfiguration) {
      if (!this._safeForSimultaneousRushProcesses) {
        if (!LockFile.tryAcquire(this.rushConfiguration.commonTempFolder, 'rush')) {
          console.log(colors.red(`Another rush command is already running in this repository.`));
          process.exit(1);
        }
      }
    }

    console.log(`Starting "rush ${this.actionName}"${os.EOL}`);
    return this.run();
  }

  /**
   * All Rush actions need to implement this method. This method runs after
   * environment has been set up by the base class.
   */
  protected abstract run(): Promise<void>;

  private _ensureEnvironment(): void {
    if (this.rushConfiguration) {
      // eslint-disable-next-line dot-notation
      let environmentPath: string | undefined = process.env['PATH'];
      environmentPath = path.join(this.rushConfiguration.commonTempFolder, 'node_modules', '.bin') +
        path.delimiter + environmentPath;
      // eslint-disable-next-line dot-notation
      process.env['PATH'] = environmentPath;
    }
  }
}

/**
 * The base class that most Rush command-line actions should extend.
 */
export abstract class BaseRushAction extends BaseConfiglessRushAction {
  private _eventHooksManager: EventHooksManager;

  protected get rushConfiguration(): RushConfiguration {
    return super.rushConfiguration!;
  }

  protected onExecute(): Promise<void> {
    if (!this.rushConfiguration) {
      throw Utilities.getRushConfigNotFoundError();
    }

    return super.onExecute();
  }

  protected get eventHooksManager(): EventHooksManager {
    if (!this._eventHooksManager) {
      this._eventHooksManager = new EventHooksManager(this.rushConfiguration);
    }

    return this._eventHooksManager;
  }

  protected mergeProjectsWithVersionPolicy(
    projectsParameters: CommandLineStringListParameter,
    versionPoliciesParameters: CommandLineStringListParameter
  ): string[] {
    const packageJsonLookup: PackageJsonLookup = new PackageJsonLookup();

    const projects: string[] = [];
    for (const projectParameter of projectsParameters.values) {
      if (projectParameter === '.') {
        const packageJson: IPackageJson | undefined = packageJsonLookup.tryLoadPackageJsonFor(process.cwd());
        if (packageJson) {
          const projectName: string = packageJson.name;
          if (this.rushConfiguration.projectsByName.has(projectName)) {
            projects.push(projectName);
          } else {
            console.log(colors.red(
              'Rush is not currently running in a project directory specified in rush.json. ' +
              `The "." value for the ${projectsParameters.longName} parameter is not allowed.`
            ));
            throw new AlreadyReportedError();
          }
        } else {
          console.log(colors.red(
            'Rush is not currently running in a project directory. ' +
            `The "." value for the ${projectsParameters.longName} parameter is not allowed.`
          ));
          throw new AlreadyReportedError();
        }
      } else {
        projects.push(projectParameter);
      }
    }

    if (versionPoliciesParameters.values && versionPoliciesParameters.values.length > 0) {
      this.rushConfiguration.projects.forEach(project => {
        const matches: boolean = versionPoliciesParameters.values.some(policyName => {
          return project.versionPolicyName === policyName;
        });
        if (matches) {
          projects.push(project.packageName);
        }
      });
    }

    return projects;
  }
}
