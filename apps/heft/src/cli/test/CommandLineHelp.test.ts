// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AnsiEscape } from '@rushstack/terminal';
import * as colorsPackage from 'colors';

import { HeftToolsCommandLineParser } from '../HeftToolsCommandLineParser';

describe('CommandLineHelp', () => {
  let colorsEnabled: boolean;

  let parser: HeftToolsCommandLineParser;

  beforeEach(() => {
    colorsEnabled = colorsPackage.enabled;
    if (!colorsEnabled) {
      colorsPackage.enable();
    }

    // ts-command-line calls process.exit() which interferes with Jest
    jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`Test code called process.exit(${code})`);
    });

    // This call may terminate the entire test run because it invokes process.exit()
    // if it encounters errors.
    // TODO Remove the calls to process.exit() or override them for testing.
    parser = new HeftToolsCommandLineParser();
  });

  afterEach(() => {
    if (!colorsEnabled) {
      colorsPackage.disable();
    }
  });

  it('prints the global help', () => {
    const helpText: string = AnsiEscape.formatForTests(parser.renderHelpText());
    expect(helpText).toMatchSnapshot();
  });

  it(`prints the help for each action`, () => {
    for (const action of parser.actions) {
      const helpText: string = AnsiEscape.formatForTests(action.renderHelpText());
      expect(helpText).toMatchSnapshot(action.actionName);
    }
  });
});
