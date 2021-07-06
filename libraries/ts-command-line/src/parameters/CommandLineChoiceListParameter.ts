// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ICommandLineChoiceListDefinition } from './CommandLineDefinition';
import { CommandLineParameter, CommandLineParameterKind } from './BaseClasses';
import { EnvironmentVariableParser } from './EnvironmentVariableParser';

/**
 * The data type returned by {@link CommandLineParameterProvider.defineChoiceListParameter}.
 * @public
 */
export class CommandLineChoiceListParameter extends CommandLineParameter {
  /** {@inheritDoc ICommandLineChoiceListDefinition.alternatives} */
  public readonly alternatives: ReadonlyArray<string>;

  private _values: string[] = [];

  /** {@inheritDoc ICommandLineChoiceListDefinition.completions} */
  public readonly completions: (() => Promise<string[]>) | undefined;

  /** @internal */
  public constructor(definition: ICommandLineChoiceListDefinition) {
    super(definition);

    if (definition.alternatives.length < 1) {
      throw new Error(
        `When defining a choice list parameter, the alternatives list must contain at least one value.`
      );
    }

    this.alternatives = definition.alternatives;
    this.completions = definition.completions;
  }

  /** {@inheritDoc CommandLineParameter.kind} */
  public get kind(): CommandLineParameterKind {
    return CommandLineParameterKind.ChoiceList;
  }

  /**
   * {@inheritDoc CommandLineParameter._setValue}
   * @internal
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public _setValue(data: any): void {
    // If argparse passed us a value, confirm it is valid. Note that argparse
    // may pass an array of arrays of args, so we flatten it before validating
    // each entry.
    if (data !== null && data !== undefined) {
      if (!Array.isArray(data)) {
        this.reportInvalidData(data);
      }
      const values: unknown[] = data.reduce((list, item) => list.concat(item), []);
      for (const item of values) {
        if (typeof item !== 'string') {
          this.reportInvalidData(data);
        }
      }
      this._values = values as string[];
      return;
    }

    if (this.environmentVariable !== undefined) {
      const values: string[] | undefined = EnvironmentVariableParser.parseAsList(this.environmentVariable);
      if (values) {
        for (const value of values) {
          if (this.alternatives.indexOf(value) < 0) {
            const choices: string = '"' + this.alternatives.join('", "') + '"';
            throw new Error(
              `Invalid value "${value}" for the environment variable` +
                ` ${this.environmentVariable}.  Valid choices are: ${choices}`
            );
          }
        }
        this._values = values;
        return;
      }
    }

    // (No default value for choice lists)

    this._values = [];
  }

  /**
   * Returns the string arguments for a choice list parameter that was parsed from the command line.
   *
   * @remarks
   * The array will be empty if the command-line has not been parsed yet,
   * or if the parameter was omitted and has no default value.
   */
  public get values(): ReadonlyArray<string> {
    return this._values;
  }

  /** {@inheritDoc CommandLineParameter.appendToArgList} @override */
  public appendToArgList(argList: string[]): void {
    if (this.values.length > 0) {
      for (const value of this.values) {
        argList.push(this.longName);
        argList.push(value);
      }
    }
  }
}
