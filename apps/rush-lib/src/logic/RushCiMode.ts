// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as isDetectedModeCi from 'is-ci';
import * as colors from 'colors';

/**
 * Determines if Rush is running in CI mode or NON-CI mode.
 * DO NOT use this class directly; use the isCI property in RushConfiguration object.
 */
export class RushCiMode {

  private readonly _isCI: boolean;

  public constructor(envOverrideMode?: string | undefined, rushConfigOverrideMode?: string | undefined) {
    let overrideMode: string | undefined = undefined;

    if (envOverrideMode) { // env config takes precedence
      overrideMode = envOverrideMode;
      console.log('Environment variable is overriding the Rush CI mode.');
    } else if (rushConfigOverrideMode) {
      console.log('Rush Configuration is overriding the Rush CI mode.');
      overrideMode = rushConfigOverrideMode;
    }

    if (overrideMode === 'CI') {
      console.log(`Rush mode overriden to: ${overrideMode}`);
      this._isCI = true;
    } else if (overrideMode === 'NON-CI') {
      console.log(`Rush mode overriden to: ${overrideMode}`);
      this._isCI = false;
    } else {
      this._isCI = isDetectedModeCi;
      if (overrideMode) {
        console.log(colors.yellow('WARNING: Ignoring unknown Rush mode override string: ' + overrideMode));
      }
    }

    if (this._isCI === isDetectedModeCi) {
      console.log(`Rush is running in ${RushCiMode._getCiModeString(this._isCI)} mode.`);
    } else {
      console.log(colors.yellow(`WARNING: isCI determined the mode as ` +
        `${RushCiMode._getCiModeString(isDetectedModeCi)}, but Rush was overridden to run in ` +
        `${RushCiMode._getCiModeString(this._isCI)} mode. This can have other potential implications: ` +
        `for example your package manager will still behave as if it were running in ` +
        `${RushCiMode._getCiModeString(isDetectedModeCi)} mode.`));
    }
  }

  private static _getCiModeString(isCi: boolean): string {
    return (isDetectedModeCi ? 'CI' : 'NON-CI');
  }

  /**
   * Returns true if rush is running on a CI.
   *
   * The package is-ci is to detect this.
   * Set environment variable RUSH_CI_MODE to override:
   *   To force CI mode, set the environment variable to CI
   *   To force non-CI mode, set the environment variable to NON-CI
   */
  public get isCI(): boolean {
    return this._isCI;
  }
}