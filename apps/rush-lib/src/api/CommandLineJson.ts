// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * "baseCommand" from command-line.schema.json
 */
export interface IBaseCommandJson {
  commandKind: 'bulk' | 'global' | 'phased';
  name: string;
  summary: string;
  /**
   * If omitted, the summary will be used instead.
   */
  description?: string;
  safeForSimultaneousRushProcesses: boolean;
  autoinstallerName?: string;
}

/**
 * "bulkCommand" from command-line.schema.json
 */
export interface IBulkCommandJson extends IBaseCommandJson {
  commandKind: 'bulk';
  enableParallelism: boolean;
  ignoreDependencyOrder?: boolean;
  ignoreMissingScript?: boolean;
  incremental?: boolean;
  allowWarningsInSuccessfulBuild?: boolean;
  watchForChanges?: boolean;
  disableBuildCache?: boolean;
}

/**
 * "phasedCommand" from command-line.schema.json
 */
export interface IPhasedCommandJson extends IBaseCommandJson {
  commandKind: 'phased';
  phases: string[];
  disableBuildCache?: boolean;
}

/**
 * "globalCommand" from command-line.schema.json
 */
export interface IGlobalCommandJson extends IBaseCommandJson {
  commandKind: 'global';
  shellCommand: string;
}

export type CommandJson = IBulkCommandJson | IGlobalCommandJson | IPhasedCommandJson;

export interface IPhaseDependencies {
  self?: string[];
  upstream?: string[];
}

export interface IPhaseJson {
  name: string;
  summary: string;
  description?: string;
  dependencies?: IPhaseDependencies;
  enableParallelism?: boolean;
  incremental?: boolean;

  ignoreMissingScript?: boolean;
  allowWarningsOnSuccess?: boolean;
}

/**
 * "baseParameter" from command-line.schema.json
 */
export interface IBaseParameterJson {
  parameterKind: 'flag' | 'choice' | 'string';
  longName: string;
  shortName?: string;
  description: string;
  associatedCommands?: string[];
  associatedPhases?: string[];
  required?: boolean;
}

/**
 * "flagParameter" from command-line.schema.json
 */
export interface IFlagParameterJson extends IBaseParameterJson {
  parameterKind: 'flag';
}

/**
 * Part of "choiceParameter" from command-line.schema.json
 */
export interface IChoiceParameterAlternativeJson {
  name: string;
  description: string;
}

/**
 * "choiceParameter" from command-line.schema.json
 */
export interface IChoiceParameterJson extends IBaseParameterJson {
  parameterKind: 'choice';
  alternatives: IChoiceParameterAlternativeJson[];
  defaultValue?: string;
}

export interface IStringParameterJson extends IBaseParameterJson {
  parameterKind: 'string';
  argumentName: string;
}

export type ParameterJson = IFlagParameterJson | IChoiceParameterJson | IStringParameterJson;

/**
 * Interfaces for the file format described by command-line.schema.json
 */
export interface ICommandLineJson {
  commands?: CommandJson[];
  phases?: IPhaseJson[];
  parameters?: ParameterJson[];
}
