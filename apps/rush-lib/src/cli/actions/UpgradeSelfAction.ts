// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as os from 'os';
import colors from 'colors/safe';

import { CommandLineFlagParameter } from '@rushstack/ts-command-line';
import { Import } from '@rushstack/node-core-library';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { UpgradeRushSelf } from '../../logic/UpgradeRushSelf';

import type * as inquirerTypes from 'inquirer';
const inquirer: typeof inquirerTypes = Import.lazy('inquirer', require);

export class UpgradeSelfAction extends BaseRushAction {
  private _debugFlag!: CommandLineFlagParameter;
  private _skipUpdateFlag!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'upgrade-self',
      summary: 'Upgrade rush version in current repository',
      documentation:
        'The "rush upgrade-self" command is used to upgrade rush version in current repository.' +
        'It helps maintainer to upgrade rushVersion in rush.json, settle down the versions of the' +
        ' dependency of rush self, and update lockfile in autoinstallers if changed.',
      parser
    });
  }

  protected onDefineParameters(): void {
    this._debugFlag = this.defineFlagParameter({
      parameterLongName: '--debug',
      description: 'Show the full call stack if an error occurs while executing the tool'
    });
    this._skipUpdateFlag = this.defineFlagParameter({
      parameterLongName: '--skip-update',
      parameterShortName: '-s',
      description:
        'If specified, the "rush update" command will not be run after updating the package.json files.'
    });
  }

  protected async runAsync(): Promise<void> {
    const upgradeRushSelf: UpgradeRushSelf = new UpgradeRushSelf({
      rushConfiguration: this.rushConfiguration,
      isDebug: this._debugFlag.value
    });

    const { needRushUpdate } = await upgradeRushSelf.upgrade();

    if (needRushUpdate && !this._skipUpdateFlag.value) {
      const promptModule: inquirerTypes.PromptModule = inquirer.createPromptModule();
      const { confirmRushUpdate } = await promptModule({
        type: 'confirm',
        name: 'confirmRushUpdate',
        message: `Confirm run rush update?`
      });
      if (confirmRushUpdate) {
        await this._runRushUpdate();
      } else {
        console.log();
        console.log(colors.yellow('package.json changes, please run rush update by yourself :)'));
      }
    }

    console.log(os.EOL + colors.green(`Rush version upgrade successfully`));
  }

  private async _runRushUpdate(): Promise<boolean> {
    const parser: RushCommandLineParser = new RushCommandLineParser();
    return await parser.execute(['update']);
  }
}
