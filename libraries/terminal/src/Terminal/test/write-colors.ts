// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * This file is a little program that prints all of the colors to the console.
 *
 * Run this program with `node write-colors.js`
 */

import { Terminal } from '../Terminal';
import { ConsoleTerminalProvider } from '../ConsoleTerminalProvider';
import { createColorGrid } from './createColorGrid';
import { Colors, IColorableSequence } from '../Colors';

const terminal: Terminal = new Terminal(new ConsoleTerminalProvider());
function writeColorGrid(colorGridSequences: IColorableSequence[][]): void {
  for (const line of colorGridSequences) {
    terminal.writeLine(...line);
  }
}

writeColorGrid(createColorGrid());
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.bold));
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.dim));
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.underline));
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.blink));
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.invertColor));
terminal.writeLine();
writeColorGrid(createColorGrid(Colors.hidden));
terminal.writeLine();

terminal.write('Normal text...');
terminal.writeLine(Colors.green('done'));

terminal.writeError('Error...');
terminal.writeErrorLine(Colors.green('done'));

terminal.writeWarning('Warning...');
terminal.writeWarningLine(Colors.green('done'));
