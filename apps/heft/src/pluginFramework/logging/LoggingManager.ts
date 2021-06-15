// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider } from '@rushstack/terminal';

import { IHeftPlugin } from '../IHeftPlugin';
import { ScopedLogger } from './ScopedLogger';
import { FileErrorFormat, FileError } from './FileError';

export interface ILoggingManagerOptions {
  terminalProvider: ITerminalProvider;
}

export class LoggingManager {
  private _options: ILoggingManagerOptions;
  private _scopedLoggers: Map<string, ScopedLogger> = new Map<string, ScopedLogger>();
  private _shouldPrintStacks: boolean = false;
  private _hasAnyErrors: boolean = false;

  public get errorsHaveBeenEmitted(): boolean {
    return this._hasAnyErrors;
  }

  public constructor(options: ILoggingManagerOptions) {
    this._options = options;
  }

  public enablePrintStacks(): void {
    this._shouldPrintStacks = true;
  }

  public requestScopedLogger(plugin: IHeftPlugin, loggerName: string): ScopedLogger {
    const existingScopedLogger: ScopedLogger | undefined = this._scopedLoggers.get(loggerName);
    if (existingScopedLogger) {
      throw new Error(
        `A named logger with name "${loggerName}" has already been requested ` +
          `by plugin "${existingScopedLogger._requestingPlugin.pluginName}".`
      );
    } else {
      const scopedLogger: ScopedLogger = new ScopedLogger({
        requestingPlugin: plugin,
        loggerName,
        terminalProvider: this._options.terminalProvider,
        getShouldPrintStacks: () => this._shouldPrintStacks,
        errorHasBeenEmittedCallback: () => (this._hasAnyErrors = true)
      });
      this._scopedLoggers.set(loggerName, scopedLogger);
      return scopedLogger;
    }
  }

  public getErrorStrings(fileErrorFormat?: FileErrorFormat): string[] {
    const result: string[] = [];

    for (const scopedLogger of this._scopedLoggers.values()) {
      result.push(
        ...scopedLogger.errors.map(
          (error) => `[${scopedLogger.loggerName}] ${LoggingManager.getErrorMessage(error, fileErrorFormat)}`
        )
      );
    }

    return result;
  }

  public getWarningStrings(fileErrorFormat?: FileErrorFormat): string[] {
    const result: string[] = [];

    for (const scopedLogger of this._scopedLoggers.values()) {
      result.push(
        ...scopedLogger.warnings.map(
          (warning) =>
            `[${scopedLogger.loggerName}] ${LoggingManager.getErrorMessage(warning, fileErrorFormat)}`
        )
      );
    }

    return result;
  }

  public static getErrorMessage(error: Error, fileErrorFormat?: FileErrorFormat): string {
    if (error instanceof FileError) {
      return error.toString(fileErrorFormat);
    } else {
      return error.message;
    }
  }
}
