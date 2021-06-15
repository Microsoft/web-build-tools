// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal, ITerminal, ITerminalProvider } from '@rushstack/terminal';

import { IHeftPlugin } from '../IHeftPlugin';
import { PrefixProxyTerminalProvider } from '../../utilities/PrefixProxyTerminalProvider';
import { LoggingManager } from './LoggingManager';

export interface IScopedLoggerOptions {
  requestingPlugin: IHeftPlugin;
  loggerName: string;
  terminalProvider: ITerminalProvider;
  getShouldPrintStacks: () => boolean;
  errorHasBeenEmittedCallback: () => void;
}

/**
 * @public
 */
export interface IScopedLogger {
  readonly terminal: ITerminal;

  /**
   * Call this function to emit an error to the heft runtime.
   */
  emitError(error: Error): void;

  /**
   * Call this function to emit an warning to the heft runtime.
   */
  emitWarning(warning: Error): void;
}

/**
 * @public
 */
export class ScopedLogger implements IScopedLogger {
  private readonly _options: IScopedLoggerOptions;
  private readonly _errors: Error[] = [];
  private readonly _warnings: Error[] = [];

  private get _shouldPrintStacks(): boolean {
    return this._options.getShouldPrintStacks();
  }

  public get errors(): ReadonlyArray<Error> {
    return [...this._errors];
  }

  public get warnings(): ReadonlyArray<Error> {
    return [...this._warnings];
  }

  /**
   * @internal
   */
  public readonly _requestingPlugin: IHeftPlugin;

  public readonly loggerName: string;

  public readonly terminalProvider: ITerminalProvider;

  public readonly terminal: ITerminal;

  /**
   * @internal
   */
  public constructor(options: IScopedLoggerOptions) {
    this._options = options;
    this._requestingPlugin = options.requestingPlugin;
    this.loggerName = options.loggerName;

    this.terminalProvider = new PrefixProxyTerminalProvider(
      options.terminalProvider,
      `[${this.loggerName}] `
    );
    this.terminal = new Terminal(this.terminalProvider);
  }

  /**
   * {@inheritdoc IScopedLogger.emitError}
   */
  public emitError(error: Error): void {
    this._errors.push(error);
    this.terminal.writeErrorLine(`Error: ${LoggingManager.getErrorMessage(error)}`);
    if (this._shouldPrintStacks && error.stack) {
      this.terminal.writeErrorLine(error.stack);
    }
  }

  /**
   * {@inheritdoc IScopedLogger.emitWarning}
   */
  public emitWarning(warning: Error): void {
    this._warnings.push(warning);
    this.terminal.writeWarningLine(`Warning: ${LoggingManager.getErrorMessage(warning)}`);
    if (this._shouldPrintStacks && warning.stack) {
      this.terminal.writeWarningLine(warning.stack);
    }
  }
}
