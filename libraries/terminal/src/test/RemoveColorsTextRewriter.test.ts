// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import colors from 'colors';

import { RemoveColorsTextRewriter } from '../RemoveColorsTextRewriter';
import { TextRewriterState } from '../TextRewriter';
import { AnsiEscape } from '../AnsiEscape';

function testCase(inputs: string[]): void {
  const matcher: RemoveColorsTextRewriter = new RemoveColorsTextRewriter();
  const state: TextRewriterState = matcher.initialize();
  const outputs: string[] = inputs.map((x) => matcher.process(state, x));
  const closeOutput: string = matcher.close(state);
  if (closeOutput !== '') {
    outputs.push('--close--');
    outputs.push(closeOutput);
  }

  expect({
    inputs: inputs.map((x) => AnsiEscape.formatForTests(x)),
    outputs
  }).toMatchSnapshot();
}

describe('RemoveColorsTextRewriter', () => {
  let initialColorsEnabled: boolean;

  beforeAll(() => {
    initialColorsEnabled = colors.enabled;
    colors.enable();
  });

  afterAll(() => {
    if (!initialColorsEnabled) {
      colors.disable();
    }
  });

  it('01 should process empty inputs', () => {
    testCase([]);
    testCase(['']);
    testCase(['', 'a', '']);
  });

  it('02 should remove colors from complete chunks', () => {
    testCase([colors.red('1')]);
    testCase([colors.red('1') + colors.green('2')]);
    testCase([colors.red('1') + '2' + colors.green('3')]);
  });

  it('03 should remove colors from 1-character chunks', () => {
    const source: string = '1' + colors.red('2');
    const inputs: string[] = [];
    for (let i: number = 0; i < source.length; ++i) {
      inputs.push(source.substr(i, 1));
    }
    testCase(inputs);
  });

  it('04 should pass through incomplete partial matches', () => {
    testCase(['\x1b']);
    testCase(['\x1b[\n']);
    testCase(['\x1b[1']);
  });
});
