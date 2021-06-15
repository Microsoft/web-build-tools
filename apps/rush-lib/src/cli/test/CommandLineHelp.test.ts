// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AnsiEscape } from '@rushstack/terminal';
import * as colorsPackage from 'colors';
import * as path from 'path';

import { RushCommandLineParser } from '../RushCommandLineParser';

describe('CommandLineHelp', () => {
  let oldCwd: string | undefined;
  let colorsEnabled: boolean;

  let parser: RushCommandLineParser;

  beforeEach(() => {
    // ts-command-line calls process.exit() which interferes with Jest
    jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`Test code called process.exit(${code})`);
    });

    oldCwd = process.cwd();
    const localCwd: string = path.join(__dirname, 'repo');

    process.chdir(localCwd);

    colorsEnabled = colorsPackage.enabled;
    if (!colorsEnabled) {
      colorsPackage.enable();
    }

    // This call may terminate the entire test run because it invokes process.exit()
    // if it encounters errors.
    // TODO Remove the calls to process.exit() or override them for testing.
    parser = new RushCommandLineParser();
    parser.execute().catch(console.error);
  });

  afterEach(() => {
    if (oldCwd) {
      process.chdir(oldCwd);
    }

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
