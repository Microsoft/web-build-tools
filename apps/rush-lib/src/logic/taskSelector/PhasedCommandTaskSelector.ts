// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { InternalError } from '@rushstack/node-core-library';

import { IPhaseJson } from '../../api/CommandLineJson';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { RushConstants } from '../RushConstants';
import { ProjectBuilder } from '../taskRunner/ProjectBuilder';
import { TaskCollection } from '../taskRunner/TaskCollection';
import { ITaskSelectorOptions, TaskSelectorBase } from './TaskSelectorBase';
import { Utilities } from '../../utilities/Utilities';

export interface IPhaseToRun {
  phase: IPhaseJson;
  customParameterValues: string[];
}

export interface IPhasedCommandTaskSelectorOptions {
  phases: Map<string, IPhaseToRun>;
  selectedPhases: Set<string>;
}

export class PhasedCommandTaskSelector extends TaskSelectorBase {
  private _phasedCommandTaskSelectorOptions: IPhasedCommandTaskSelectorOptions;

  public constructor(
    options: ITaskSelectorOptions,
    phasedCommandTaskSelectorOptions: IPhasedCommandTaskSelectorOptions
  ) {
    super(options);

    this._phasedCommandTaskSelectorOptions = phasedCommandTaskSelectorOptions;
  }

  protected _createTaskCollection(projects: ReadonlySet<RushConfigurationProject>): TaskCollection {
    const taskCollection: TaskCollection = new TaskCollection();

    const selectedPhases: Set<string> = this._phasedCommandTaskSelectorOptions.selectedPhases;
    const phases: Map<string, IPhaseToRun> = this._phasedCommandTaskSelectorOptions.phases;

    const friendlyPhaseNames: Map<string, string> = new Map<string, string>();
    // Register all tasks
    for (const phaseName of selectedPhases) {
      const phaseToRun: IPhaseToRun | undefined = phases.get(phaseName);
      if (!phaseToRun) {
        throw new InternalError(
          `Expected to find phase "${phaseName}", but it was not present in the ` +
            `list of phases provided to the ${PhasedCommandTaskSelector.name}. This is unexpected.`
        );
      }

      const friendlyPhaseName: string = phaseName.substring(RushConstants.phaseNamePrefix.length);
      friendlyPhaseNames.set(phaseName, friendlyPhaseName);
      const packageDepsFilename: string = Utilities.getPackageDepsFilenameForCommand(friendlyPhaseName);

      for (const project of projects) {
        const commandToRun: string | undefined = TaskSelectorBase.getScriptToRun(
          project,
          phaseToRun.phase.name,
          phaseToRun.customParameterValues
        );

        if (commandToRun === undefined && !phaseToRun.phase.ignoreMissingScript) {
          throw new Error(
            `The project [${project.packageName}] does not define a '${phaseToRun.phase.name}' command in the 'scripts' section of its package.json`
          );
        }

        const taskName: string = ProjectBuilder.getTaskName(project, friendlyPhaseName);
        if (!taskCollection.hasTask(taskName)) {
          taskCollection.addTask(
            new ProjectBuilder({
              name: taskName,
              rushProject: project,
              rushConfiguration: this._options.rushConfiguration,
              buildCacheConfiguration: this._options.buildCacheConfiguration,
              commandToRun: commandToRun || '',
              commandName: this._options.commandName,
              isIncrementalBuildAllowed: !!phaseToRun.phase.incremental,
              allowWarningsOnSuccess: !!phaseToRun.phase.allowWarningsOnSuccess,
              packageChangeAnalyzer: this._packageChangeAnalyzer,
              packageDepsFilename: packageDepsFilename
            })
          );
        }
      }
    }

    const dependencyMap: Map<string, Set<string>> = new Map<string, Set<string>>();

    // Generate the filtered dependency graph
    function getDependencyTaskNames(
      project: RushConfigurationProject,
      phaseName: string,
      taskName: string = ProjectBuilder.getTaskName(project, friendlyPhaseNames.get(phaseName)!)
    ): Set<string> {
      let dependencyTaskNames: Set<string> | undefined = dependencyMap.get(taskName);
      if (!dependencyTaskNames) {
        dependencyTaskNames = new Set();
        dependencyMap.set(taskName, dependencyTaskNames);

        const phase: IPhaseJson = phases.get(phaseName)!.phase;
        if (phase.dependencies?.self) {
          for (const selfDependencyPhaseName of phase.dependencies.self) {
            dependencyTaskNames.add(
              ProjectBuilder.getTaskName(project, friendlyPhaseNames.get(selfDependencyPhaseName))
            );
          }
        }

        if (phase.dependencies?.upstream) {
          for (const upstreamDependencyPhaseName of phase.dependencies.upstream) {
            for (const dep of project.dependencyProjects) {
              if (projects.has(dep)) {
                // Add direct relationships for projects in the set
                dependencyTaskNames.add(
                  ProjectBuilder.getTaskName(dep, friendlyPhaseNames.get(upstreamDependencyPhaseName))
                );
              } else {
                // Add indirect relationships for projects not in the set
                for (const indirectDep of getDependencyTaskNames(dep, upstreamDependencyPhaseName)) {
                  dependencyTaskNames.add(indirectDep);
                }
              }
            }
          }
        }
      }

      return dependencyTaskNames;
    }

    // Add ordering relationships for each dependency
    for (const phaseName of selectedPhases) {
      for (const project of projects) {
        const friendlyPhaseName: string = friendlyPhaseNames.get(phaseName)!;
        const taskName: string = ProjectBuilder.getTaskName(project, friendlyPhaseName);
        taskCollection.addDependencies(taskName, getDependencyTaskNames(project, phaseName, taskName));
      }
    }

    return taskCollection;
  }
}
