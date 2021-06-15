// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * This file is a little program that prints all of the colors to the console
 */

import { Colors, IColorableSequence } from '../Colors';

export function createColorGrid(
  attributeFunction?: (text: string | IColorableSequence) => IColorableSequence
): IColorableSequence[][] {
  const foregroundFunctions: ((text: string | IColorableSequence) => IColorableSequence)[] = [
    (text) => Colors._normalizeStringOrColorableSequence(text),
    Colors.black,
    Colors.white,
    Colors.gray,
    Colors.magenta,
    Colors.red,
    Colors.yellow,
    Colors.green,
    Colors.cyan,
    Colors.blue
  ];

  const backgroundFunctions: ((text: string | IColorableSequence) => IColorableSequence)[] = [
    (text) => Colors._normalizeStringOrColorableSequence(text),
    Colors.blackBackground,
    Colors.whiteBackground,
    Colors.grayBackground,
    Colors.magentaBackground,
    Colors.redBackground,
    Colors.yellowBackground,
    Colors.greenBackground,
    Colors.cyanBackground,
    Colors.blueBackground
  ];

  const lines: IColorableSequence[][] = [];

  for (const backgroundFunction of backgroundFunctions) {
    const sequences: IColorableSequence[] = [];

    for (const foregroundFunction of foregroundFunctions) {
      let sequence: IColorableSequence = backgroundFunction(foregroundFunction('X'));
      if (attributeFunction) {
        sequence = attributeFunction(sequence);
      }

      sequences.push(sequence);
    }

    lines.push(sequences);
  }

  return lines;
}
