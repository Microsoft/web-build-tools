// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal, ITerminal, ITerminalProvider, TerminalProviderSeverity } from '@rushstack/terminal';

export class PrefixProxyTerminalProvider implements ITerminalProvider {
  private _parent: ITerminalProvider;
  private _prefix: string;

  public constructor(parent: ITerminalProvider, prefix: string) {
    this._parent = parent;
    this._prefix = prefix;
  }

  public static getTerminal(parent: ITerminalProvider, prefix: string): ITerminal {
    const provider: ITerminalProvider = new PrefixProxyTerminalProvider(parent, prefix);
    return new Terminal(provider);
  }

  public get supportsColor(): boolean {
    return this._parent.supportsColor;
  }

  public get eolCharacter(): string {
    return this._parent.eolCharacter;
  }

  public write(data: string, severity: TerminalProviderSeverity): void {
    this._parent.write(this._prefix + data, severity);
  }
}
