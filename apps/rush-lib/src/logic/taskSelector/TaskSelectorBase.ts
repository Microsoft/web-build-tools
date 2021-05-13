// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { BuildCacheConfiguration } from '../../api/BuildCacheConfiguration';
import { RushConfiguration } from '../../api/RushConfiguration';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { convertSlashesForWindows } from '../taskRunner/ProjectBuilder';
import { PackageChangeAnalyzer } from '../PackageChangeAnalyzer';
import { TaskCollection } from '../taskRunner/TaskCollection';

export interface ITaskSelectorOptions {
  rushConfiguration: RushConfiguration;
  commandName: string;
  buildCacheConfiguration: BuildCacheConfiguration | undefined;
  selection: ReadonlySet<RushConfigurationProject>;
  isQuietMode: boolean;
  packageChangeAnalyzer?: PackageChangeAnalyzer;
}

/**
 * This class is responsible for:
 *  - based on to/from flags, solving the dependency graph and figuring out which projects need to be run
 *  - creating a ProjectBuilder for each project that needs to be built
 *  - registering the necessary ProjectBuilders with the TaskRunner, which actually orchestrates execution
 */
export abstract class TaskSelectorBase {
  protected _options: ITaskSelectorOptions;
  protected _packageChangeAnalyzer: PackageChangeAnalyzer;

  public constructor(options: ITaskSelectorOptions) {
    this._options = options;

    const { packageChangeAnalyzer = new PackageChangeAnalyzer(options.rushConfiguration) } = options;

    this._packageChangeAnalyzer = packageChangeAnalyzer;
  }

  public static getScriptToRun(
    rushProject: RushConfigurationProject,
    commandToRun: string,
    customParameterValues: string[]
  ): string | undefined {
    const script: string | undefined = TaskSelectorBase._getScriptCommand(rushProject, commandToRun);

    if (script === undefined) {
      return undefined;
    }

    if (!script) {
      return '';
    } else {
      const taskCommand: string = `${script} ${customParameterValues.join(' ')}`;
      return process.platform === 'win32' ? convertSlashesForWindows(taskCommand) : taskCommand;
    }
  }

  public registerTasks(): TaskCollection {
    const selectedProjects: ReadonlySet<RushConfigurationProject> = this._computeSelectedProjects();

    return this._createTaskCollection(selectedProjects);
  }

  private _computeSelectedProjects(): ReadonlySet<RushConfigurationProject> {
    const { selection } = this._options;

    if (selection.size) {
      return selection;
    }

    // Default to all projects
    return new Set(this._options.rushConfiguration.projects);
  }

  protected abstract _createTaskCollection(projects: ReadonlySet<RushConfigurationProject>): TaskCollection;

  private static _getScriptCommand(
    rushProject: RushConfigurationProject,
    script: string
  ): string | undefined {
    if (!rushProject.packageJson.scripts) {
      return undefined;
    }

    const rawCommand: string = rushProject.packageJson.scripts[script];

    if (rawCommand === undefined || rawCommand === null) {
      return undefined;
    }

    return rawCommand;
  }
}
