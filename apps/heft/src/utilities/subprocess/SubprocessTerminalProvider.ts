// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider, TerminalProviderSeverity } from '@rushstack/terminal';

import { ISubprocessInnerConfiguration } from './SubprocessRunnerBase';

export class SubprocessTerminalProvider implements ITerminalProvider {
  private _builderConfiguration: ISubprocessInnerConfiguration;

  public write: (data: string, severity: TerminalProviderSeverity) => void;

  public constructor(
    builderConfiguration: ISubprocessInnerConfiguration,
    writeFn: (data: string, severity: TerminalProviderSeverity) => void
  ) {
    if (!process.send) {
      throw new Error(`The process.send function is not supported in this context`);
    }

    this._builderConfiguration = builderConfiguration;
    this.write = writeFn;
  }

  public get supportsColor(): boolean {
    return this._builderConfiguration.terminalSupportsColor;
  }

  public get eolCharacter(): string {
    return this._builderConfiguration.terminalEolCharacter;
  }
}
