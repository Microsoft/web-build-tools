// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as os from 'os';
import colors from 'colors';

import { AlreadyReportedError } from '@rushstack/node-core-library';
import {
  CommandLineFlagParameter,
  CommandLineStringParameter,
  CommandLineStringListParameter,
  CommandLineParameterKind
} from '@rushstack/ts-command-line';
import { PackageName } from '@rushstack/node-core-library';

import { Event } from '../../index';
import { SetupChecks } from '../../logic/SetupChecks';
import { TaskSelector } from '../../logic/TaskSelector';
import { Stopwatch } from '../../utilities/Stopwatch';
import { BaseScriptAction, IBaseScriptActionOptions } from './BaseScriptAction';
import { TaskRunner } from '../../logic/taskRunner/TaskRunner';
import { TaskCollection } from '../../logic/taskRunner/TaskCollection';
import { Utilities } from '../../utilities/Utilities';
import { RushConstants } from '../../logic/RushConstants';
import { EnvironmentVariableNames } from '../../api/EnvironmentConfiguration';
import { LastLinkFlag, LastLinkFlagFactory } from '../../api/LastLinkFlag';
import { IRushConfigurationProjectJson } from '../../api/RushConfigurationProject';
import { BuildCacheConfiguration } from '../../api/BuildCacheConfiguration';

/**
 * Constructor parameters for BulkScriptAction.
 */
export interface IBulkScriptActionOptions extends IBaseScriptActionOptions {
  enableParallelism: boolean;
  /**
   * Optional package.json script to run otherwise use `actionName` as the script to run..
   */
  script?: string | string[];
  ignoreMissingScript: boolean;
  ignoreDependencyOrder: boolean;
  incremental: boolean;
  allowWarningsInSuccessfulBuild: boolean;
}

/**
 * This class implements bulk commands which are run individually for each project in the repo,
 * possibly in parallel.  The action executes a script found in the project's package.json file.
 *
 * @remarks
 * Bulk commands can be defined via common/config/command-line.json.  Rush's predefined "build"
 * and "rebuild" commands are also modeled as bulk commands, because they essentially just
 * execute scripts from package.json in the same as any custom command.
 */
export class BulkScriptAction extends BaseScriptAction {
  private _enableParallelism: boolean;
  private _ignoreMissingScript: boolean;
  private _isIncrementalBuildAllowed: boolean;
  private _commandToRun: string[];

  private _changedProjectsOnly!: CommandLineFlagParameter;
  private _fromFlag!: CommandLineStringListParameter;
  private _toFlag!: CommandLineStringListParameter;
  private _fromVersionPolicy!: CommandLineStringListParameter;
  private _toVersionPolicy!: CommandLineStringListParameter;
  private _verboseParameter!: CommandLineFlagParameter;
  private _parallelismParameter: CommandLineStringParameter | undefined;
  private _ignoreHooksParameter!: CommandLineFlagParameter;
  private _ignoreDependencyOrder: boolean;
  private _allowWarningsInSuccessfulBuild: boolean;

  public constructor(options: IBulkScriptActionOptions) {
    super(options);
    this._enableParallelism = options.enableParallelism;
    this._ignoreMissingScript = options.ignoreMissingScript;
    this._isIncrementalBuildAllowed = options.incremental;
    this._ignoreDependencyOrder = options.ignoreDependencyOrder;
    this._allowWarningsInSuccessfulBuild = options.allowWarningsInSuccessfulBuild;

    if (Array.isArray(options.script)) {
      this._commandToRun = [...options.script, options.actionName];
    } else if (typeof options.script === 'string') {
      this._commandToRun = [options.script, options.actionName];
    } else {
      this._commandToRun = [options.actionName];
    }
  }

  public async runAsync(): Promise<void> {
    // TODO: Replace with last-install.flag when "rush link" and "rush unlink" are deprecated
    const lastLinkFlag: LastLinkFlag = LastLinkFlagFactory.getCommonTempFlag(this.rushConfiguration);
    if (!lastLinkFlag.isValid()) {
      const useWorkspaces: boolean =
        this.rushConfiguration.pnpmOptions && this.rushConfiguration.pnpmOptions.useWorkspaces;
      if (useWorkspaces) {
        throw new Error(`Link flag invalid.${os.EOL}Did you run "rush install" or "rush update"?`);
      } else {
        throw new Error(`Link flag invalid.${os.EOL}Did you run "rush link"?`);
      }
    }

    this._doBeforeTask();

    const stopwatch: Stopwatch = Stopwatch.start();

    const isQuietMode: boolean = !this._verboseParameter.value;

    // if this is parallelizable, then use the value from the flag (undefined or a number),
    // if parallelism is not enabled, then restrict to 1 core
    const parallelism: string | undefined = this._enableParallelism ? this._parallelismParameter!.value : '1';

    // Collect all custom parameter values
    const customParameterValues: string[] = [];
    for (const customParameter of this.customParameters) {
      customParameter.appendToArgList(customParameterValues);
    }

    const changedProjectsOnly: boolean = this._isIncrementalBuildAllowed && this._changedProjectsOnly.value;

    const buildCacheConfiguration:
      | BuildCacheConfiguration
      | undefined = await BuildCacheConfiguration.loadFromDefaultPathAsync(this.rushConfiguration);

    const taskSelector: TaskSelector = new TaskSelector({
      rushConfiguration: this.rushConfiguration,
      buildCacheConfiguration,
      toProjects: this.mergeProjectsWithVersionPolicy(this._toFlag, this._toVersionPolicy),
      fromProjects: this.mergeProjectsWithVersionPolicy(this._fromFlag, this._fromVersionPolicy),
      commandToRun: this._commandToRun,
      customParameterValues,
      isQuietMode: isQuietMode,
      isIncrementalBuildAllowed: this._isIncrementalBuildAllowed,
      ignoreMissingScript: this._ignoreMissingScript,
      ignoreDependencyOrder: this._ignoreDependencyOrder,
      packageDepsFilename: Utilities.getPackageDepsFilenameForCommand(this._commandToRun[0])
    });

    // Register all tasks with the task collection
    const taskCollection: TaskCollection = taskSelector.registerTasks();

    const taskRunner: TaskRunner = new TaskRunner(taskCollection.getOrderedTasks(), {
      quietMode: isQuietMode,
      parallelism: parallelism,
      changedProjectsOnly: changedProjectsOnly,
      allowWarningsInSuccessfulBuild: this._allowWarningsInSuccessfulBuild
    });

    try {
      await taskRunner.executeAsync();

      stopwatch.stop();
      console.log(colors.green(`rush ${this.actionName} (${stopwatch.toString()})`));

      this._doAfterTask(stopwatch, true);
    } catch (error) {
      stopwatch.stop();

      if (error instanceof AlreadyReportedError) {
        console.log(`rush ${this.actionName} (${stopwatch.toString()})`);
      } else {
        if (error && error.message) {
          if (this.parser.isDebug) {
            console.log('Error: ' + error.stack);
          } else {
            console.log('Error: ' + error.message);
          }
        }

        console.log(colors.red(`rush ${this.actionName} - Errors! (${stopwatch.toString()})`));
      }

      this._doAfterTask(stopwatch, false);
      throw new AlreadyReportedError();
    }
  }

  protected onDefineParameters(): void {
    if (this._enableParallelism) {
      this._parallelismParameter = this.defineStringParameter({
        parameterLongName: '--parallelism',
        parameterShortName: '-p',
        argumentName: 'COUNT',
        environmentVariable: EnvironmentVariableNames.RUSH_PARALLELISM,
        description:
          'Specifies the maximum number of concurrent processes to launch during a build.' +
          ' The COUNT should be a positive integer or else the word "max" to specify a count that is equal to' +
          ' the number of CPU cores. If this parameter is omitted, then the default value depends on the' +
          ' operating system and number of CPU cores.'
      });
    }
    this._toFlag = this.defineStringListParameter({
      parameterLongName: '--to',
      parameterShortName: '-t',
      argumentName: 'PROJECT1',
      description:
        'Run command in the specified project and all of its dependencies. "." can be used as shorthand ' +
        'to specify the project in the current working directory.',
      completions: this._getProjectNames.bind(this)
    });
    this._fromVersionPolicy = this.defineStringListParameter({
      parameterLongName: '--from-version-policy',
      argumentName: 'VERSION_POLICY_NAME',
      description:
        'Run command in all projects with the specified version policy ' +
        'and all projects that directly or indirectly depend on projects with the specified version policy'
    });
    this._toVersionPolicy = this.defineStringListParameter({
      parameterLongName: '--to-version-policy',
      argumentName: 'VERSION_POLICY_NAME',
      description:
        'Run command in all projects with the specified version policy and all of their dependencies'
    });
    this._fromFlag = this.defineStringListParameter({
      parameterLongName: '--from',
      parameterShortName: '-f',
      argumentName: 'PROJECT2',
      description:
        'Run command in the specified project and all projects that directly or indirectly depend on the ' +
        'specified project. "." can be used as shorthand to specify the project in the current working directory.',
      completions: this._getProjectNames.bind(this)
    });
    this._verboseParameter = this.defineFlagParameter({
      parameterLongName: '--verbose',
      parameterShortName: '-v',
      description: 'Display the logs during the build, rather than just displaying the build status summary'
    });
    if (this._isIncrementalBuildAllowed) {
      this._changedProjectsOnly = this.defineFlagParameter({
        parameterLongName: '--changed-projects-only',
        parameterShortName: '-o',
        description:
          'If specified, the incremental build will only rebuild projects that have changed, ' +
          'but not any projects that directly or indirectly depend on the changed package.'
      });
    }
    this._ignoreHooksParameter = this.defineFlagParameter({
      parameterLongName: '--ignore-hooks',
      description: `Skips execution of the "eventHooks" scripts defined in rush.json. Make sure you know what you are skipping.`
    });

    this.defineScriptParameters();
  }

  private async _getProjectNames(): Promise<string[]> {
    const unscopedNamesMap: Map<string, number> = new Map<string, number>();

    const scopedNames: string[] = [];

    const projectJsons: IRushConfigurationProjectJson[] = [
      ...this.rushConfiguration.rushConfigurationJson.projects
    ];

    for (const projectJson of projectJsons) {
      scopedNames.push(projectJson.packageName);
      const unscopedName: string = PackageName.getUnscopedName(projectJson.packageName);
      let count: number = 0;
      if (unscopedNamesMap.has(unscopedName)) {
        count = unscopedNamesMap.get(unscopedName)!;
      }
      unscopedNamesMap.set(unscopedName, count + 1);
    }

    const unscopedNames: string[] = [];

    for (const unscopedName of unscopedNamesMap.keys()) {
      const unscopedNameCount: number = unscopedNamesMap.get(unscopedName)!;
      // don't suggest ambiguous unscoped names
      if (unscopedNameCount === 1 && !scopedNames.includes(unscopedName)) {
        unscopedNames.push(unscopedName);
      }
    }

    return unscopedNames.sort().concat(scopedNames.sort());
  }

  private _doBeforeTask(): void {
    if (
      this.actionName !== RushConstants.buildCommandName &&
      this.actionName !== RushConstants.rebuildCommandName
    ) {
      // Only collects information for built-in tasks like build or rebuild.
      return;
    }

    SetupChecks.validate(this.rushConfiguration);

    this.eventHooksManager.handle(Event.preRushBuild, this.parser.isDebug, this._ignoreHooksParameter.value);
  }

  private _doAfterTask(stopwatch: Stopwatch, success: boolean): void {
    if (
      this.actionName !== RushConstants.buildCommandName &&
      this.actionName !== RushConstants.rebuildCommandName
    ) {
      // Only collects information for built-in tasks like build or rebuild.
      return;
    }
    this._collectTelemetry(stopwatch, success);
    this.parser.flushTelemetry();
    this.eventHooksManager.handle(Event.postRushBuild, this.parser.isDebug, this._ignoreHooksParameter.value);
  }

  private _collectTelemetry(stopwatch: Stopwatch, success: boolean): void {
    const extraData: { [key: string]: string } = {
      command_to: (this._toFlag.values.length > 0).toString(),
      command_from: (this._fromFlag.values.length > 0).toString()
    };

    for (const customParameter of this.customParameters) {
      switch (customParameter.kind) {
        case CommandLineParameterKind.Flag:
        case CommandLineParameterKind.Choice:
        case CommandLineParameterKind.String:
        case CommandLineParameterKind.Integer:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          extraData[customParameter.longName] = JSON.stringify((customParameter as any).value);
          break;
        default:
          extraData[customParameter.longName] = '?';
      }
    }

    if (this.parser.telemetry) {
      this.parser.telemetry.log({
        name: this.actionName,
        duration: stopwatch.duration,
        result: success ? 'Succeeded' : 'Failed',
        extraData
      });
    }
  }
}
