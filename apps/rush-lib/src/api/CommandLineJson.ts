// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * "baseCommand" from command-line.schema.json
 */
export interface IBaseCommandJson {
  commandKind: 'bulk' | 'global';
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
  script?: string | string[];
  ignoreMissingScript?: boolean;
  incremental?: boolean;
  allowWarningsInSuccessfulBuild?: boolean;
}

/**
 * "globalCommand" from command-line.schema.json
 */
export interface IGlobalCommandJson extends IBaseCommandJson {
  commandKind: 'global';
  shellCommand: string;
}

export type CommandJson = IBulkCommandJson | IGlobalCommandJson;

/**
 * "baseParameter" from command-line.schema.json
 */
export interface IBaseParameterJson {
  parameterKind: 'flag' | 'choice' | 'string';
  longName: string;
  shortName?: string;
  description: string;
  associatedCommands: string[];
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
  parameters?: ParameterJson[];
}
