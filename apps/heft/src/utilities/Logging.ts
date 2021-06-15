// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminal } from '@rushstack/terminal';
import { performance } from 'perf_hooks';

export interface IFinishedWords {
  success: string;
  failure: string;
}

const DEFAULT_FINISHED_WORDS: IFinishedWords = {
  success: 'finished',
  failure: 'encountered an error'
};

export class Logging {
  public static async runFunctionWithLoggingBoundsAsync(
    terminal: ITerminal,
    name: string,
    fn: () => Promise<void>,
    finishedWords: IFinishedWords = DEFAULT_FINISHED_WORDS
  ): Promise<void> {
    terminal.writeLine(` ---- ${name} started ---- `);
    const startTime: number = performance.now();
    let finishedLoggingWord: string = finishedWords.success;
    try {
      await fn();
    } catch (e) {
      finishedLoggingWord = finishedWords.failure;
      throw e;
    } finally {
      const executionTime: number = Math.round(performance.now() - startTime);
      terminal.writeLine(` ---- ${name} ${finishedLoggingWord} (${executionTime}ms) ---- `);
    }
  }
}
