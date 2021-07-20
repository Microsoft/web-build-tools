// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import colors from 'colors/safe';
import { CommandLineStringParameter, CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { RushCommandLineParser } from '../RushCommandLineParser';
import { BaseRushAction } from './BaseRushAction';
import { VersionMismatchFinder } from '../../logic/versionMismatch/VersionMismatchFinder';
import { Variants } from '../../api/Variants';

export class CheckAction extends BaseRushAction {
  private _variant!: CommandLineStringParameter;
  private _jsonFlag!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'check',
      summary:
        "Checks each project's package.json files and ensures that all dependencies are of the same " +
        'version throughout the repository.',
      documentation:
        "Checks each project's package.json files and ensures that all dependencies are of the " +
        'same version throughout the repository.',
      safeForSimultaneousRushProcesses: true,
      suppressStartupBanner: true,
      parser
    });
  }

  protected onDefineParameters(): void {
    this._variant = this.defineStringParameter(Variants.VARIANT_PARAMETER);
    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If this flag is specified, output will be in JSON format.'
    });
  }

  protected async runAsync(): Promise<void> {
    const variant: string | undefined = this.rushConfiguration.currentInstalledVariant;

    if (!this._variant.value && variant) {
      console.log(
        colors.yellow(
          `Variant '${variant}' has been installed, but 'rush check' is currently checking the default variant. ` +
            `Use 'rush check --variant '${variant}' to check the current installation.`
        )
      );
    }

    VersionMismatchFinder.rushCheck(this.rushConfiguration, {
      variant: this._variant.value,
      printAsJson: this._jsonFlag.value
    });
  }
}
