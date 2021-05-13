// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { ProjectBuilder } from '../taskRunner/ProjectBuilder';
import { TaskCollection } from '../taskRunner/TaskCollection';
import { ITaskSelectorOptions, TaskSelectorBase } from './TaskSelectorBase';

export interface INonPhasedCommandTaskSelectorOptions {
  commandToRun: string;
  customParameterValues: string[];
  isIncrementalBuildAllowed: boolean;
  allowWarningsOnSuccess: boolean;
  ignoreMissingScript: boolean;
  ignoreDependencyOrder: boolean;
  packageDepsFilename: string;
}

export class NonPhasedCommandTaskSelector extends TaskSelectorBase {
  private _nonPhasedCommandTaskSelectorOptions: INonPhasedCommandTaskSelectorOptions;

  public constructor(
    options: ITaskSelectorOptions,
    nonPhasedCommandTaskSelectorOptions: INonPhasedCommandTaskSelectorOptions
  ) {
    super(options);

    this._nonPhasedCommandTaskSelectorOptions = nonPhasedCommandTaskSelectorOptions;
  }

  protected _createTaskCollection(projects: ReadonlySet<RushConfigurationProject>): TaskCollection {
    const taskCollection: TaskCollection = new TaskCollection();

    // Register all tasks
    for (const rushProject of projects) {
      this._registerProjectTask(rushProject, taskCollection);
    }

    if (!this._nonPhasedCommandTaskSelectorOptions.ignoreDependencyOrder) {
      const dependencyMap: Map<RushConfigurationProject, Set<string>> = new Map();

      // Generate the filtered dependency graph for selected projects
      function getDependencyTaskNames(project: RushConfigurationProject): Set<string> {
        let dependencyTaskNames: Set<string> | undefined = dependencyMap.get(project);
        if (!dependencyTaskNames) {
          dependencyTaskNames = new Set();
          dependencyMap.set(project, dependencyTaskNames);

          for (const dep of project.dependencyProjects) {
            if (projects.has(dep)) {
              // Add direct relationships for projects in the set
              dependencyTaskNames.add(ProjectBuilder.getTaskName(dep));
            } else {
              // Add indirect relationships for projects not in the set
              for (const indirectDep of getDependencyTaskNames(dep)) {
                dependencyTaskNames.add(indirectDep);
              }
            }
          }
        }

        return dependencyTaskNames;
      }

      // Add ordering relationships for each dependency
      for (const project of projects) {
        taskCollection.addDependencies(ProjectBuilder.getTaskName(project), getDependencyTaskNames(project));
      }
    }

    return taskCollection;
  }

  private _registerProjectTask(project: RushConfigurationProject, taskCollection: TaskCollection): void {
    const taskName: string = ProjectBuilder.getTaskName(project);
    if (!project || taskCollection.hasTask(taskName)) {
      return;
    }

    const commandToRun: string | undefined = TaskSelectorBase.getScriptToRun(
      project,
      this._nonPhasedCommandTaskSelectorOptions.commandToRun,
      this._nonPhasedCommandTaskSelectorOptions.customParameterValues
    );
    if (commandToRun === undefined && !this._nonPhasedCommandTaskSelectorOptions.ignoreMissingScript) {
      throw new Error(
        `The project [${project.packageName}] does not define a '${this._nonPhasedCommandTaskSelectorOptions.commandToRun}' command in the 'scripts' section of its package.json`
      );
    }

    taskCollection.addTask(
      new ProjectBuilder({
        name: taskName,
        rushProject: project,
        rushConfiguration: this._options.rushConfiguration,
        buildCacheConfiguration: this._options.buildCacheConfiguration,
        commandToRun: commandToRun || '',
        commandName: this._options.commandName,
        isIncrementalBuildAllowed: this._nonPhasedCommandTaskSelectorOptions.isIncrementalBuildAllowed,
        allowWarningsOnSuccess: this._nonPhasedCommandTaskSelectorOptions.allowWarningsOnSuccess,
        packageChangeAnalyzer: this._packageChangeAnalyzer,
        packageDepsFilename: this._nonPhasedCommandTaskSelectorOptions.packageDepsFilename
      })
    );
  }
}
