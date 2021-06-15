// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBufferTerminalProvider, Terminal, ITerminal } from '@rushstack/terminal';

import { IDisposable, Utilities } from '../Utilities';

describe('Utilities', () => {
  describe('printMessageInBox', () => {
    const MESSAGE: string =
      'Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Maecenas porttitor congue massa. Fusce posuere, magna sed pulvinar ultricies, purus lectus malesuada libero, sit amet commodo magna eros quis urna.';

    let terminalProvider: StringBufferTerminalProvider;
    let terminal: ITerminal;

    beforeEach(() => {
      terminalProvider = new StringBufferTerminalProvider(false);
      terminal = new Terminal(terminalProvider);
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    function validateOutput(expectedWidth: number): void {
      const outputLines: string[] = terminalProvider
        .getOutput({ normalizeSpecialCharacters: true })
        .split('[n]');
      expect(outputLines).toMatchSnapshot();

      expect(outputLines[0].trim().length).toEqual(expectedWidth);
    }

    it('Correctly prints a narrow box', () => {
      Utilities.printMessageInBox(MESSAGE, terminal, 20);
      validateOutput(20);
    });

    it('Correctly prints a wide box', () => {
      Utilities.printMessageInBox(MESSAGE, terminal, 300);
      validateOutput(300);
    });

    it('Correctly gets the console width', () => {
      jest.spyOn(Utilities, 'getConsoleWidth').mockReturnValue(65);

      Utilities.printMessageInBox(MESSAGE, terminal);
      validateOutput(32);
    });
  });

  describe('usingAsync', () => {
    let disposed: boolean;

    beforeEach(() => {
      disposed = false;
    });

    class Disposable implements IDisposable {
      public dispose(): void {
        disposed = true;
      }
    }

    it('Disposes correctly in a simple case', async () => {
      await Utilities.usingAsync(
        () => new Disposable(),
        () => {
          /* no-op */
        }
      );

      expect(disposed).toEqual(true);
    });

    it('Disposes correctly after the operation throws an exception', async () => {
      await expect(
        async () =>
          await Utilities.usingAsync(
            () => new Disposable(),
            () => {
              throw new Error('operation threw');
            }
          )
      ).rejects.toMatchSnapshot();

      expect(disposed).toEqual(true);
    });

    it('Does not dispose if the construction throws an exception', async () => {
      await expect(
        async () =>
          await Utilities.usingAsync(
            async () => {
              throw new Error('constructor threw');
            },
            () => {
              /* no-op */
            }
          )
      ).rejects.toMatchSnapshot();

      expect(disposed).toEqual(false);
    });
  });
});
