// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider, TerminalProviderSeverity } from '@rushstack/terminal';
import { CollatedTerminal } from '@rushstack/stream-collator';

export class CollatedTerminalProvider implements ITerminalProvider {
  private readonly _collatedTerminal: CollatedTerminal;
  private _hasErrors: boolean = false;
  private _hasWarnings: boolean = false;

  public readonly supportsColor: boolean = true;
  public readonly eolCharacter: string = '\n';

  public get hasErrors(): boolean {
    return this._hasErrors;
  }

  public get hasWarnings(): boolean {
    return this._hasWarnings;
  }

  public constructor(collatedTerminal: CollatedTerminal) {
    this._collatedTerminal = collatedTerminal;
  }

  public write(data: string, severity: TerminalProviderSeverity): void {
    switch (severity) {
      case TerminalProviderSeverity.log:
      case TerminalProviderSeverity.verbose: {
        this._collatedTerminal.writeStdoutLine(data);
        break;
      }

      case TerminalProviderSeverity.error: {
        this._collatedTerminal.writeStderrLine(data);
        this._hasErrors = true;
        break;
      }

      case TerminalProviderSeverity.warning: {
        this._collatedTerminal.writeStderrLine(data);
        this._hasWarnings = true;
        break;
      }

      default: {
        throw new Error(`Unexpected severity: ${severity}`);
      }
    }
  }
}
