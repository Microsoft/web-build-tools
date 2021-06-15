// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AnsiEscape } from './AnsiEscape';
import { TextRewriter, TextRewriterState } from './TextRewriter';

enum State {
  // Buffer is empty, and we're looking for the ESC character
  Start,
  // We're looking for the '[' character
  AwaitingBracket,
  // We're reading the codes after the '[' character
  ReadingCodes
}

interface IRemoveColorsTextRewriterState extends TextRewriterState {
  buffer: string;
  parseState: State;
}

/**
 * For use with {@link TextRewriterTransform}, this rewriter removes ANSI escape codes
 * including colored text.
 *
 * @remarks
 * The implementation also removes other ANSI escape codes such as cursor positioning.
 * The specific set of affected codes may be adjusted in the future.
 *
 * @public
 */
export class RemoveColorsTextRewriter extends TextRewriter {
  public initialize(): TextRewriterState {
    return { buffer: '', parseState: State.Start } as IRemoveColorsTextRewriterState;
  }

  public process(unknownState: TextRewriterState, text: string): string {
    const state: IRemoveColorsTextRewriterState = unknownState as IRemoveColorsTextRewriterState;

    // We will be matching AnsiEscape._csiRegExp:
    //
    //  /\x1b\[([\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e])/gu
    //
    const ESC: string = '\x1b';

    let result: string = '';
    let index: number = 0;

    while (index < text.length) {
      if (state.parseState === State.Start) {
        // The buffer is empty, which means we haven't found anything yet

        const csiIndex: number = text.indexOf(ESC, index);
        if (csiIndex < 0) {
          // We reached the end of "text" without finding another CSI prefix
          result += text.substring(index);
          break;
        }

        // Append everything up to the CSI prefix
        result += text.substring(index, csiIndex);

        // Save the partial match in the buffer
        state.buffer = ESC;
        index = csiIndex + 1;
        state.parseState = State.AwaitingBracket;
      } else {
        // The buffer has characters, which means we started matching a partial sequence

        // Read another character into the buffer
        const c: string = text[index];
        ++index;
        state.buffer += c;

        if (state.parseState === State.AwaitingBracket) {
          if (c === '[') {
            state.parseState = State.ReadingCodes;
          } else {
            // Failed to match, so append the buffer and start over
            result += state.buffer;
            state.buffer = '';
            state.parseState = State.Start;
          }
        } else {
          // state.state === State.ReadingCodes

          // Stop when we reach any character that is not [\x30-\x3f] or [\x20-\x2f]
          const code: number = c.charCodeAt(0);
          if (code < 0x20 || code > 0x3f) {
            result += AnsiEscape.removeCodes(state.buffer);
            state.buffer = '';
            state.parseState = State.Start;
          }
        }
      }
    }

    return result;
  }

  public close(unknownState: TextRewriterState): string {
    const state: IRemoveColorsTextRewriterState = unknownState as IRemoveColorsTextRewriterState;

    const result: string = state.buffer;
    state.buffer = '';
    return result;
  }
}
