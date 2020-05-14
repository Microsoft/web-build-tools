// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as isCI from 'is-ci';

import { RushCiMode } from '../RushCiMode';

describe('IsCI', () => {
  it('determines the current mode as CI if RUSH_CI_MODE is set to CI', (done: jest.DoneCallback) => {

    expect(new RushCiMode('CI', '').isCI).toBe(true);
    expect(new RushCiMode('CI', 'NON-CI').isCI).toBe(true);
    expect(new RushCiMode('CI', 'AAA').isCI).toBe(true);
    expect(new RushCiMode('CI', undefined).isCI).toBe(true);

    done();
  });

  it('determines the current mode as NON-CI if RUSH_CI_MODE is set to NON-CI', (done: jest.DoneCallback) => {
    expect(new RushCiMode('NON-CI', '').isCI).toBe(false);
    expect(new RushCiMode('NON-CI', 'NON-CI').isCI).toBe(false);
    expect(new RushCiMode('NON-CI', 'AAA').isCI).toBe(false);
    expect(new RushCiMode('NON-CI', undefined).isCI).toBe(false);

    done();
  });

  it(
    'determines the current mode as returned by the isCI package if RUSH_CI_MODE is neither set to CI nor to NON-CI',
    (done: jest.DoneCallback) => {
      expect(new RushCiMode('gas', '').isCI).toBe(isCI);
      expect(new RushCiMode('NONCI', 'NON-CI').isCI).toBe(isCI);
      expect(new RushCiMode('NOCI', 'AAA').isCI).toBe(isCI);
      expect(new RushCiMode(undefined, undefined).isCI).toBe(isCI);
      expect(new RushCiMode('', '').isCI).toBe(isCI);

      done();
    }
  );
});