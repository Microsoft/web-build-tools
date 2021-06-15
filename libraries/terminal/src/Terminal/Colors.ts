// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * @beta
 */
export interface IColorableSequence {
  text: string;
  isEol?: boolean;
  foregroundColor?: ColorValue;
  backgroundColor?: ColorValue;
  textAttributes?: TextAttribute[];
}

export const eolSequence: IColorableSequence = {
  isEol: true
} as IColorableSequence;

/**
 * Colors used with {@link IColorableSequence}.
 * @beta
 */
export enum ColorValue {
  Black,
  Red,
  Green,
  Yellow,
  Blue,
  Magenta,
  Cyan,
  White,
  Gray
}

/**
 * Text styles used with {@link IColorableSequence}.
 * @beta
 */
export enum TextAttribute {
  Bold,
  Dim,
  Underline,
  Blink,
  InvertColor,
  Hidden
}

export enum ConsoleColorCodes {
  BlackForeground = 30,
  RedForeground = 31,
  GreenForeground = 32,
  YellowForeground = 33,
  BlueForeground = 34,
  MagentaForeground = 35,
  CyanForeground = 36,
  WhiteForeground = 37,
  GrayForeground = 90,
  DefaultForeground = 39,

  BlackBackground = 40,
  RedBackground = 41,
  GreenBackground = 42,
  YellowBackground = 43,
  BlueBackground = 44,
  MagentaBackground = 45,
  CyanBackground = 46,
  WhiteBackground = 47,
  GrayBackground = 100,
  DefaultBackground = 49,

  Bold = 1,

  // On Linux, the "BoldOff" code instead causes the text to be double-underlined:
  // https://en.wikipedia.org/wiki/Talk:ANSI_escape_code#SGR_21%E2%80%94%60Bold_off%60_not_widely_supported
  // Use "NormalColorOrIntensity" instead
  // BoldOff = 21,

  Dim = 2,
  NormalColorOrIntensity = 22,
  Underline = 4,
  UnderlineOff = 24,
  Blink = 5,
  BlinkOff = 25,
  InvertColor = 7,
  InvertColorOff = 27,
  Hidden = 8,
  HiddenOff = 28
}

/**
 * The static functions on this class are used to produce colored text
 * for use with the node-core-library terminal.
 *
 * @example
 * terminal.writeLine(Colors.green('Green Text!'), ' ', Colors.blue('Blue Text!'));
 *
 * @beta
 */
export class Colors {
  public static black(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Black
    };
  }

  public static red(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Red
    };
  }

  public static green(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Green
    };
  }

  public static yellow(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Yellow
    };
  }

  public static blue(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Blue
    };
  }

  public static magenta(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Magenta
    };
  }

  public static cyan(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Cyan
    };
  }

  public static white(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.White
    };
  }

  public static gray(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      foregroundColor: ColorValue.Gray
    };
  }

  public static blackBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Black
    };
  }

  public static redBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Red
    };
  }

  public static greenBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Green
    };
  }

  public static yellowBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Yellow
    };
  }

  public static blueBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Blue
    };
  }

  public static magentaBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Magenta
    };
  }

  public static cyanBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Cyan
    };
  }

  public static whiteBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.White
    };
  }

  public static grayBackground(text: string | IColorableSequence): IColorableSequence {
    return {
      ...Colors._normalizeStringOrColorableSequence(text),
      backgroundColor: ColorValue.Gray
    };
  }

  public static bold(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.Bold);
  }

  public static dim(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.Dim);
  }

  public static underline(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.Underline);
  }

  public static blink(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.Blink);
  }

  public static invertColor(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.InvertColor);
  }

  public static hidden(text: string | IColorableSequence): IColorableSequence {
    return Colors._applyTextAttribute(text, TextAttribute.Hidden);
  }

  /**
   * If called with a string, returns the string wrapped in a {@link IColorableSequence}.
   * If called with a {@link IColorableSequence}, returns the {@link IColorableSequence}.
   *
   * @internal
   */
  public static _normalizeStringOrColorableSequence(value: string | IColorableSequence): IColorableSequence {
    if (typeof value === 'string') {
      return {
        text: value
      };
    } else {
      return value;
    }
  }

  private static _applyTextAttribute(
    text: string | IColorableSequence,
    attribute: TextAttribute
  ): IColorableSequence {
    const sequence: IColorableSequence = Colors._normalizeStringOrColorableSequence(text);
    if (!sequence.textAttributes) {
      sequence.textAttributes = [];
    }

    sequence.textAttributes.push(attribute);
    return sequence;
  }
}
