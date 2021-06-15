// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider, TerminalProviderSeverity } from './ITerminalProvider';
import {
  IColorableSequence,
  ColorValue,
  Colors,
  eolSequence,
  TextAttribute,
  ConsoleColorCodes
} from './Colors';

/**
 * @beta
 */
export interface ITerminal {
  /**
   * Write a generic message to the terminal
   */
  write(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write a generic message to the terminal, followed by a newline
   */
  writeLine(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write a warning message to the console with yellow text.
   *
   * @remarks
   * The yellow color takes precedence over any other foreground colors set.
   */
  writeWarning(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write a warning message to the console with yellow text, followed by a newline.
   *
   * @remarks
   * The yellow color takes precedence over any other foreground colors set.
   */
  writeWarningLine(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write an error message to the console with red text.
   *
   * @remarks
   * The red color takes precedence over any other foreground colors set.
   */
  writeError(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write an error message to the console with red text, followed by a newline.
   *
   * @remarks
   * The red color takes precedence over any other foreground colors set.
   */
  writeErrorLine(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write a verbose-level message.
   */
  writeVerbose(...messageParts: (string | IColorableSequence)[]): void;

  /**
   * Write a verbose-level message followed by a newline.
   */
  writeVerboseLine(...messageParts: (string | IColorableSequence)[]): void;
}

/**
 * This class facilitates writing to a console.
 *
 * @beta
 */
export class Terminal implements ITerminal {
  private _providers: Set<ITerminalProvider>;

  public constructor(provider: ITerminalProvider) {
    this._providers = new Set<ITerminalProvider>();
    this._providers.add(provider);
  }

  /**
   * Subscribe a new terminal provider.
   */
  public registerProvider(provider: ITerminalProvider): void {
    this._providers.add(provider);
  }

  /**
   * Unsubscribe a terminal provider. If the provider isn't subscribed, this function does nothing.
   */
  public unregisterProvider(provider: ITerminalProvider): void {
    if (this._providers.has(provider)) {
      this._providers.delete(provider);
    }
  }

  /**
   * {@inheritdoc ITerminal.write}
   */
  public write(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(messageParts, TerminalProviderSeverity.log);
  }

  /**
   * {@inheritdoc ITerminal.writeLine}
   */
  public writeLine(...messageParts: (string | IColorableSequence)[]): void {
    this.write(...messageParts, eolSequence);
  }

  /**
   * {@inheritdoc ITerminal.writeWarning}
   */
  public writeWarning(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(
      messageParts.map(
        (part): IColorableSequence => ({
          ...Colors._normalizeStringOrColorableSequence(part),
          foregroundColor: ColorValue.Yellow
        })
      ),
      TerminalProviderSeverity.warning
    );
  }

  /**
   * {@inheritdoc ITerminal.writeWarningLine}
   */
  public writeWarningLine(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(
      [
        ...messageParts.map(
          (part): IColorableSequence => ({
            ...Colors._normalizeStringOrColorableSequence(part),
            foregroundColor: ColorValue.Yellow
          })
        ),
        eolSequence
      ],
      TerminalProviderSeverity.warning
    );
  }

  /**
   * {@inheritdoc ITerminal.writeError}
   */
  public writeError(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(
      messageParts.map(
        (part): IColorableSequence => ({
          ...Colors._normalizeStringOrColorableSequence(part),
          foregroundColor: ColorValue.Red
        })
      ),
      TerminalProviderSeverity.error
    );
  }

  /**
   * {@inheritdoc ITerminal.writeErrorLine}
   */
  public writeErrorLine(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(
      [
        ...messageParts.map(
          (part): IColorableSequence => ({
            ...Colors._normalizeStringOrColorableSequence(part),
            foregroundColor: ColorValue.Red
          })
        ),
        eolSequence
      ],
      TerminalProviderSeverity.error
    );
  }

  /**
   * {@inheritdoc ITerminal.writeVerbose}
   */
  public writeVerbose(...messageParts: (string | IColorableSequence)[]): void {
    this._writeSegmentsToProviders(messageParts, TerminalProviderSeverity.verbose);
  }

  /**
   * {@inheritdoc ITerminal.writeVerboseLine}
   */
  public writeVerboseLine(...messageParts: (string | IColorableSequence)[]): void {
    this.writeVerbose(...messageParts, eolSequence);
  }

  private _writeSegmentsToProviders(
    segments: (string | IColorableSequence)[],
    severity: TerminalProviderSeverity
  ): void {
    const withColorText: { [eolChar: string]: string } = {};
    const withoutColorText: { [eolChar: string]: string } = {};
    let withColorLines: string[] | undefined;
    let withoutColorLines: string[] | undefined;

    this._providers.forEach((provider) => {
      const eol: string = provider.eolCharacter;
      let textToWrite: string;
      if (provider.supportsColor) {
        if (!withColorLines) {
          withColorLines = this._serializeFormattableTextSegments(segments, true);
        }

        if (!withColorText[eol]) {
          withColorText[eol] = withColorLines.join(eol);
        }

        textToWrite = withColorText[eol];
      } else {
        if (!withoutColorLines) {
          withoutColorLines = this._serializeFormattableTextSegments(segments, false);
        }

        if (!withoutColorText[eol]) {
          withoutColorText[eol] = withoutColorLines.join(eol);
        }

        textToWrite = withoutColorText[eol];
      }

      provider.write(textToWrite, severity);
    });
  }

  private _serializeFormattableTextSegments(
    segments: (string | IColorableSequence)[],
    withColor: boolean
  ): string[] {
    const lines: string[] = [];
    let segmentsToJoin: string[] = [];
    let lastSegmentWasEol: boolean = false;
    for (let i: number = 0; i < segments.length; i++) {
      const segment: IColorableSequence = Colors._normalizeStringOrColorableSequence(segments[i]);
      lastSegmentWasEol = !!segment.isEol;
      if (lastSegmentWasEol) {
        lines.push(segmentsToJoin.join(''));
        segmentsToJoin = [];
      } else {
        if (withColor) {
          const startColorCodes: number[] = [];
          const endColorCodes: number[] = [];
          switch (segment.foregroundColor) {
            case ColorValue.Black: {
              startColorCodes.push(ConsoleColorCodes.BlackForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Red: {
              startColorCodes.push(ConsoleColorCodes.RedForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Green: {
              startColorCodes.push(ConsoleColorCodes.GreenForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Yellow: {
              startColorCodes.push(ConsoleColorCodes.YellowForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Blue: {
              startColorCodes.push(ConsoleColorCodes.BlueForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Magenta: {
              startColorCodes.push(ConsoleColorCodes.MagentaForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Cyan: {
              startColorCodes.push(ConsoleColorCodes.CyanForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.White: {
              startColorCodes.push(ConsoleColorCodes.WhiteForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }

            case ColorValue.Gray: {
              startColorCodes.push(ConsoleColorCodes.GrayForeground);
              endColorCodes.push(ConsoleColorCodes.DefaultForeground);
              break;
            }
          }

          switch (segment.backgroundColor) {
            case ColorValue.Black: {
              startColorCodes.push(ConsoleColorCodes.BlackBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Red: {
              startColorCodes.push(ConsoleColorCodes.RedBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Green: {
              startColorCodes.push(ConsoleColorCodes.GreenBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Yellow: {
              startColorCodes.push(ConsoleColorCodes.YellowBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Blue: {
              startColorCodes.push(ConsoleColorCodes.BlueBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Magenta: {
              startColorCodes.push(ConsoleColorCodes.MagentaBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Cyan: {
              startColorCodes.push(ConsoleColorCodes.CyanBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.White: {
              startColorCodes.push(ConsoleColorCodes.WhiteBackground);
              endColorCodes.push(ConsoleColorCodes.DefaultBackground);
              break;
            }

            case ColorValue.Gray: {
              startColorCodes.push(ConsoleColorCodes.GrayBackground);
              endColorCodes.push(49);
              break;
            }
          }

          if (segment.textAttributes) {
            for (const textAttribute of segment.textAttributes) {
              switch (textAttribute) {
                case TextAttribute.Bold: {
                  startColorCodes.push(ConsoleColorCodes.Bold);
                  endColorCodes.push(ConsoleColorCodes.NormalColorOrIntensity);
                  break;
                }

                case TextAttribute.Dim: {
                  startColorCodes.push(ConsoleColorCodes.Dim);
                  endColorCodes.push(ConsoleColorCodes.NormalColorOrIntensity);
                  break;
                }

                case TextAttribute.Underline: {
                  startColorCodes.push(ConsoleColorCodes.Underline);
                  endColorCodes.push(ConsoleColorCodes.UnderlineOff);
                  break;
                }

                case TextAttribute.Blink: {
                  startColorCodes.push(ConsoleColorCodes.Blink);
                  endColorCodes.push(ConsoleColorCodes.BlinkOff);
                  break;
                }

                case TextAttribute.InvertColor: {
                  startColorCodes.push(ConsoleColorCodes.InvertColor);
                  endColorCodes.push(ConsoleColorCodes.InvertColorOff);
                  break;
                }

                case TextAttribute.Hidden: {
                  startColorCodes.push(ConsoleColorCodes.Hidden);
                  endColorCodes.push(ConsoleColorCodes.HiddenOff);
                  break;
                }
              }
            }
          }

          for (let j: number = 0; j < startColorCodes.length; j++) {
            const code: number = startColorCodes[j];
            segmentsToJoin.push(...['\u001b[', code.toString(), 'm']);
          }

          segmentsToJoin.push(segment.text);

          for (let j: number = endColorCodes.length - 1; j >= 0; j--) {
            const code: number = endColorCodes[j];
            segmentsToJoin.push(...['\u001b[', code.toString(), 'm']);
          }
        } else {
          segmentsToJoin.push(segment.text);
        }
      }
    }

    if (segmentsToJoin.length > 0) {
      lines.push(segmentsToJoin.join(''));
    }

    if (lastSegmentWasEol) {
      lines.push('');
    }

    return lines;
  }
}
