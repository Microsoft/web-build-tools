// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBuilder, Text } from '@rushstack/node-core-library';

import { ITerminalProvider, TerminalProviderSeverity } from './ITerminalProvider';
import { AnsiEscape } from '../AnsiEscape';

/**
 * @beta
 */
export interface IStringBufferOutputOptions {
  /**
   * If set to true, special characters like \\n, \\r, and the \\u001b character
   * in color control tokens will get normalized to [-n-], [-r-], and [-x-] respectively
   *
   * This option defaults to `true`
   */
  normalizeSpecialCharacters: boolean;
}

/**
 * Terminal provider that stores written data in buffers separated by severity.
 * This terminal provider is designed to be used when code that prints to a terminal
 * is being unit tested.
 *
 * @beta
 */
export class StringBufferTerminalProvider implements ITerminalProvider {
  private _standardBuffer: StringBuilder = new StringBuilder();
  private _verboseBuffer: StringBuilder = new StringBuilder();
  private _warningBuffer: StringBuilder = new StringBuilder();
  private _errorBuffer: StringBuilder = new StringBuilder();

  private _supportsColor: boolean;

  public constructor(supportsColor: boolean = false) {
    this._supportsColor = supportsColor;
  }

  /**
   * {@inheritDoc ITerminalProvider.write}
   */
  public write(data: string, severity: TerminalProviderSeverity): void {
    switch (severity) {
      case TerminalProviderSeverity.warning: {
        this._warningBuffer.append(data);
        break;
      }

      case TerminalProviderSeverity.error: {
        this._errorBuffer.append(data);
        break;
      }

      case TerminalProviderSeverity.verbose: {
        this._verboseBuffer.append(data);
        break;
      }

      case TerminalProviderSeverity.log:
      default: {
        this._standardBuffer.append(data);
        break;
      }
    }
  }

  /**
   * {@inheritDoc ITerminalProvider.eolCharacter}
   */
  public get eolCharacter(): string {
    return '[n]';
  }

  /**
   * {@inheritDoc ITerminalProvider.supportsColor}
   */
  public get supportsColor(): boolean {
    return this._supportsColor;
  }

  /**
   * Get everything that has been written at log-level severity.
   */
  public getOutput(options?: IStringBufferOutputOptions): string {
    return this._normalizeOutput(this._standardBuffer.toString(), options);
  }

  /**
   * Get everything that has been written at verbose-level severity.
   */
  public getVerbose(options?: IStringBufferOutputOptions): string {
    return this._normalizeOutput(this._verboseBuffer.toString(), options);
  }

  /**
   * Get everything that has been written at error-level severity.
   */
  public getErrorOutput(options?: IStringBufferOutputOptions): string {
    return this._normalizeOutput(this._errorBuffer.toString(), options);
  }

  /**
   * Get everything that has been written at warning-level severity.
   */
  public getWarningOutput(options?: IStringBufferOutputOptions): string {
    return this._normalizeOutput(this._warningBuffer.toString(), options);
  }

  private _normalizeOutput(s: string, options: IStringBufferOutputOptions | undefined): string {
    options = {
      normalizeSpecialCharacters: true,

      ...(options || {})
    };

    s = Text.convertToLf(s);

    if (options.normalizeSpecialCharacters) {
      return AnsiEscape.formatForTests(s, { encodeNewlines: true });
    } else {
      return s;
    }
  }
}
