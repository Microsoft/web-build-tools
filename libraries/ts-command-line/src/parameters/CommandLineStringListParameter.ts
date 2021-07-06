// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ICommandLineStringListDefinition } from './CommandLineDefinition';
import { CommandLineParameterWithArgument, CommandLineParameterKind } from './BaseClasses';
import { EnvironmentVariableParser } from './EnvironmentVariableParser';

/**
 * The data type returned by {@link CommandLineParameterProvider.defineStringListParameter}.
 * @public
 */
export class CommandLineStringListParameter extends CommandLineParameterWithArgument {
  private _values: string[] = [];

  /** @internal */
  public constructor(definition: ICommandLineStringListDefinition) {
    super(definition);
  }

  /** {@inheritDoc CommandLineParameter.kind} */
  public get kind(): CommandLineParameterKind {
    return CommandLineParameterKind.StringList;
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

    // If an environment variable exists, attempt to parse it as a list
    if (this.environmentVariable !== undefined) {
      const values: string[] | undefined = EnvironmentVariableParser.parseAsList(this.environmentVariable);
      if (values) {
        this._values = values;
        return;
      }
    }

    // (No default value for string lists)

    this._values = [];
  }

  /**
   * Returns the string arguments for a string list parameter that was parsed from the command line.
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
