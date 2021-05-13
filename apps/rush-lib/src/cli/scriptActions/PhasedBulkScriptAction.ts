// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { InternalError } from '@rushstack/node-core-library';
import { CommandLineParameter } from '@rushstack/ts-command-line';
import { IPhaseJson, ParameterJson } from '../../api/CommandLineJson';
import {
  IPhaseToRun,
  IPhasedCommandTaskSelectorOptions,
  PhasedCommandTaskSelector
} from '../../logic/taskSelector/PhasedCommandTaskSelector';
import { ITaskSelectorOptions } from '../../logic/taskSelector/TaskSelectorBase';
import { BulkScriptActionBase, IBulkScriptActionBaseOptions } from './BulkScriptActionBase';

export interface IPhasedBulkScriptActionOptions
  extends Omit<IBulkScriptActionBaseOptions, 'ignoreDependencyOrder' | 'incremental' | 'enableParallelism'> {
  commandPhaseNames: string[];
}

export class PhasedBulkScriptAction extends BulkScriptActionBase {
  private readonly _phases: Map<string, IPhaseJson>;
  private readonly _selectedPhaseNames: Set<string>;

  public constructor(options: IPhasedBulkScriptActionOptions) {
    const selectedPhaseNames: Set<string> = new Set<string>();
    const phases: Map<string, IPhaseJson> = options.commandLineConfiguration.phases;
    for (const phaseName of options.commandPhaseNames) {
      PhasedBulkScriptAction._collectPhaseDependencies(phases, phaseName, selectedPhaseNames);
    }
    const incremental: boolean = Array.from(selectedPhaseNames).some(
      (selectedPhaseName) => phases.get(selectedPhaseName)?.incremental
    );
    const enableParallelism: boolean = Array.from(selectedPhaseNames).some(
      (selectedPhaseName) => phases.get(selectedPhaseName)?.enableParallelism
    );

    super({
      ...options,
      ignoreDependencyOrder: false,
      incremental,
      enableParallelism
    });

    this._phases = phases;
    this._selectedPhaseNames = selectedPhaseNames;
  }

  public _getTaskSelector(taskSelectorOptions: ITaskSelectorOptions): PhasedCommandTaskSelector {
    const commandLineParametersByPhase: Map<string, ParameterJson[]> = new Map<string, ParameterJson[]>();
    for (const commandLineParameter of this._commandLineConfiguration.parameters) {
      if (commandLineParameter.associatedPhases) {
        for (const associatedPhaseName of commandLineParameter.associatedPhases) {
          let commandLineParametersForPhase: ParameterJson[] | undefined = commandLineParametersByPhase.get(
            associatedPhaseName
          );
          if (!commandLineParametersForPhase) {
            commandLineParametersForPhase = [];
            commandLineParametersByPhase.set(associatedPhaseName, commandLineParametersForPhase);
          }

          commandLineParametersForPhase.push(commandLineParameter);
        }
      }
    }

    const phasesToRun: Map<string, IPhaseToRun> = new Map<string, IPhaseToRun>();
    for (const selectedPhaseName of this._selectedPhaseNames) {
      const phase: IPhaseJson = this._phases.get(selectedPhaseName)!;

      const customParameterValues: string[] = [];
      const commandLineParametersForPhase: ParameterJson[] | undefined = commandLineParametersByPhase.get(
        selectedPhaseName
      );
      if (commandLineParametersForPhase) {
        for (const commandLineParameterForPhase of commandLineParametersForPhase) {
          const customParameter: CommandLineParameter | undefined = this.customParameters.get(
            commandLineParameterForPhase.longName
          );
          if (customParameter) {
            customParameter.appendToArgList(customParameterValues);
          }
        }
      }

      phasesToRun.set(selectedPhaseName, {
        phase,
        customParameterValues
      });
    }

    const nonPhasedCommandTaskSelectorOptions: IPhasedCommandTaskSelectorOptions = {
      phases: phasesToRun,
      selectedPhases: this._selectedPhaseNames
    };

    return new PhasedCommandTaskSelector(taskSelectorOptions, nonPhasedCommandTaskSelectorOptions);
  }

  private static _collectPhaseDependencies(
    phases: Map<string, IPhaseJson>,
    phaseName: string,
    collectedPhaseNames: Set<string>
  ): void {
    const phase: IPhaseJson | undefined = phases.get(phaseName);
    if (!phase) {
      throw new InternalError(
        `Expected to find phase "${phaseName}", but it was not present in the ` +
          `list of phases provided to the ${PhasedBulkScriptAction.name}. This is unexpected.`
      );
    }

    collectedPhaseNames.add(phase.name);
    if (phase.dependencies?.self) {
      for (const dependencyPhaseName of phase.dependencies.self) {
        if (!collectedPhaseNames.has(dependencyPhaseName)) {
          PhasedBulkScriptAction._collectPhaseDependencies(phases, dependencyPhaseName, collectedPhaseNames);
        }
      }
    }

    if (phase.dependencies?.upstream) {
      for (const dependencyPhaseName of phase.dependencies.upstream) {
        if (!collectedPhaseNames.has(dependencyPhaseName)) {
          PhasedBulkScriptAction._collectPhaseDependencies(phases, dependencyPhaseName, collectedPhaseNames);
        }
      }
    }
  }
}
