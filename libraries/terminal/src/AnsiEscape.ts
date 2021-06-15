// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ConsoleColorCodes } from './Terminal/Colors';

/**
 * Options for {@link AnsiEscape.formatForTests}.
 * @public
 */
export interface IAnsiEscapeConvertForTestsOptions {
  /**
   * If true then `\n` will be replaced by `[n]`, and `\r` will be replaced by `[r]`.
   */
  encodeNewlines?: boolean;
}

/**
 * Operations for working with text strings that contain
 * {@link https://en.wikipedia.org/wiki/ANSI_escape_code | ANSI escape codes}.
 * The most commonly used escape codes set the foreground/background color for console output.
 * @public
 */
export class AnsiEscape {
  // For now, we only care about the Control Sequence Introducer (CSI) commands which always start with "[".
  // eslint-disable-next-line no-control-regex
  private static readonly _csiRegExp: RegExp = /\x1b\[([\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e])/gu;

  // Text coloring is performed using Select Graphic Rendition (SGR) codes, which come after the
  // CSI introducer "ESC [".  The SGR sequence is a number followed by "m".
  private static readonly _sgrRegExp: RegExp = /([0-9]+)m/u;

  private static readonly _backslashNRegExp: RegExp = /\n/g;
  private static readonly _backslashRRegExp: RegExp = /\r/g;

  /**
   * Returns the input text with all ANSI escape codes removed.  For example, this is useful when saving
   * colorized console output to a log file.
   */
  public static removeCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(AnsiEscape._csiRegExp, '');
  }

  /**
   * Replaces ANSI escape codes with human-readable tokens.  This is useful for unit tests
   * that compare text strings in test assertions or snapshot files.
   */
  public static formatForTests(text: string, options?: IAnsiEscapeConvertForTestsOptions): string {
    if (!options) {
      options = {};
    }

    let result: string = text.replace(AnsiEscape._csiRegExp, (capture: string, csiCode: string) => {
      // If it is an SGR code, then try to show a friendly token
      const match: RegExpMatchArray | null = csiCode.match(AnsiEscape._sgrRegExp);
      if (match) {
        const sgrParameter: number = parseInt(match[1]);
        const sgrParameterName: string | undefined = AnsiEscape._tryGetSgrFriendlyName(sgrParameter);
        if (sgrParameterName) {
          // Example: "[black-bg]"
          return `[${sgrParameterName}]`;
        }
      }

      // Otherwise show the raw code, but without the "[" from the CSI prefix
      // Example: "[31m]"
      return `[${csiCode}]`;
    });

    if (options.encodeNewlines) {
      result = result
        .replace(AnsiEscape._backslashNRegExp, '[n]')
        .replace(AnsiEscape._backslashRRegExp, `[r]`);
    }
    return result;
  }

  // Returns a human-readable token representing an SGR parameter, or undefined for parameter that is not well-known.
  // The SGR parameter numbers are documented in this table:
  // https://en.wikipedia.org/wiki/ANSI_escape_code#SGR_parameters
  private static _tryGetSgrFriendlyName(sgiParameter: number): string | undefined {
    switch (sgiParameter) {
      case ConsoleColorCodes.BlackForeground:
        return 'black';
      case ConsoleColorCodes.RedForeground:
        return 'red';
      case ConsoleColorCodes.GreenForeground:
        return 'green';
      case ConsoleColorCodes.YellowForeground:
        return 'yellow';
      case ConsoleColorCodes.BlueForeground:
        return 'blue';
      case ConsoleColorCodes.MagentaForeground:
        return 'magenta';
      case ConsoleColorCodes.CyanForeground:
        return 'cyan';
      case ConsoleColorCodes.WhiteForeground:
        return 'white';
      case ConsoleColorCodes.GrayForeground:
        return 'gray';
      case ConsoleColorCodes.DefaultForeground:
        return 'default';

      case ConsoleColorCodes.BlackBackground:
        return 'black-bg';
      case ConsoleColorCodes.RedBackground:
        return 'red-bg';
      case ConsoleColorCodes.GreenBackground:
        return 'green-bg';
      case ConsoleColorCodes.YellowBackground:
        return 'yellow-bg';
      case ConsoleColorCodes.BlueBackground:
        return 'blue-bg';
      case ConsoleColorCodes.MagentaBackground:
        return 'magenta-bg';
      case ConsoleColorCodes.CyanBackground:
        return 'cyan-bg';
      case ConsoleColorCodes.WhiteBackground:
        return 'white-bg';
      case ConsoleColorCodes.GrayBackground:
        return 'gray-bg';
      case ConsoleColorCodes.DefaultBackground:
        return 'default-bg';

      case ConsoleColorCodes.Bold:
        return 'bold';
      case ConsoleColorCodes.Dim:
        return 'dim';
      case ConsoleColorCodes.NormalColorOrIntensity:
        return 'normal';
      case ConsoleColorCodes.Underline:
        return 'underline';
      case ConsoleColorCodes.UnderlineOff:
        return 'underline-off';
      case ConsoleColorCodes.Blink:
        return 'blink';
      case ConsoleColorCodes.BlinkOff:
        return 'blink-off';
      case ConsoleColorCodes.InvertColor:
        return 'invert';
      case ConsoleColorCodes.InvertColorOff:
        return 'invert-off';
      case ConsoleColorCodes.Hidden:
        return 'hidden';
      case ConsoleColorCodes.HiddenOff:
        return 'hidden-off';
      default:
        return undefined;
    }
  }
}
