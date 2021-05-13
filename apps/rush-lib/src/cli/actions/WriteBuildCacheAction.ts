// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { AlreadyReportedError, ConsoleTerminalProvider, Terminal } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, CommandLineStringParameter } from '@rushstack/ts-command-line';

import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';

import { BuildCacheConfiguration } from '../../api/BuildCacheConfiguration';
import { ProjectBuilder } from '../../logic/taskRunner/ProjectBuilder';
import { PackageChangeAnalyzer } from '../../logic/PackageChangeAnalyzer';
import { Utilities } from '../../utilities/Utilities';
import { TaskSelectorBase } from '../../logic/taskSelector/TaskSelectorBase';
import { RushConstants } from '../../logic/RushConstants';
import { CommandLineConfiguration } from '../../api/CommandLineConfiguration';

export class WriteBuildCacheAction extends BaseRushAction {
  private _command!: CommandLineStringParameter;
  private _verboseFlag!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'write-build-cache',
      summary: 'Writes the current state of the current project to the cache.',
      documentation:
        '(EXPERIMENTAL) If the build cache is configured, when this command is run in the folder of ' +
        'a project, write the current state of the project to the cache.',
      safeForSimultaneousRushProcesses: true,
      parser
    });
  }

  public onDefineParameters(): void {
    this._command = this.defineStringParameter({
      parameterLongName: '--command',
      parameterShortName: '-c',
      required: true,
      argumentName: 'COMMAND',
      description:
        '(Required) The command run in the current project that produced the current project state.'
    });

    this._verboseFlag = this.defineFlagParameter({
      parameterLongName: '--verbose',
      parameterShortName: '-v',
      description: 'Display verbose log information.'
    });
  }

  public async runAsync(): Promise<void> {
    const project: RushConfigurationProject | undefined = this.rushConfiguration.tryGetProjectForPath(
      process.cwd()
    );

    if (!project) {
      throw new Error(
        `The "rush ${this.actionName}" command must be invoked under a project` +
          ` folder that is registered in rush.json.`
      );
    }

    const terminal: Terminal = new Terminal(
      new ConsoleTerminalProvider({ verboseEnabled: this._verboseFlag.value })
    );

    const buildCacheConfiguration: BuildCacheConfiguration = await BuildCacheConfiguration.loadAndRequireEnabledAsync(
      terminal,
      this.rushConfiguration
    );

    const command: string = this._command.value!;
    const commandToRun: string | undefined = TaskSelectorBase.getScriptToRun(project, command, []);

    const packageChangeAnalyzer: PackageChangeAnalyzer = new PackageChangeAnalyzer(this.rushConfiguration);
    const projectBuilder: ProjectBuilder = new ProjectBuilder({
      name: ProjectBuilder.getTaskName(project),
      rushProject: project,
      rushConfiguration: this.rushConfiguration,
      buildCacheConfiguration,
      commandName: command,
      commandToRun: commandToRun || '',
      isIncrementalBuildAllowed: false,
      allowWarningsOnSuccess: false,
      packageChangeAnalyzer,
      packageDepsFilename: Utilities.getPackageDepsFilenameForCommand(command)
    });

    const trackedFiles: string[] = Array.from(
      packageChangeAnalyzer.getPackageDeps(project.packageName)!.keys()
    );
    const commandLineConfigFilePath: string = path.join(
      this.rushConfiguration.commonRushConfigFolder,
      RushConstants.commandLineFilename
    );
    const repoCommandLineConfiguration:
      | CommandLineConfiguration
      | undefined = CommandLineConfiguration.loadFromFileOrDefault(commandLineConfigFilePath);

    const cacheWriteSuccess: boolean | undefined = await projectBuilder.tryWriteCacheEntryAsync(
      terminal,
      trackedFiles,
      repoCommandLineConfiguration
    );
    if (cacheWriteSuccess === undefined) {
      terminal.writeErrorLine('This project does not support caching or Git is not present.');
      throw new AlreadyReportedError();
    } else if (cacheWriteSuccess === false) {
      terminal.writeErrorLine('Writing cache entry failed.');
    }
  }
}
