// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineFlagParameter } from '@rushstack/ts-command-line';
import { ConsoleTerminalProvider, Colors, Import, Terminal } from '@rushstack/node-core-library';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { UpgradeRushSelf } from '../../logic/UpgradeRushSelf';

import type * as inquirerTypes from 'inquirer';
const inquirer: typeof inquirerTypes = Import.lazy('inquirer', require);

export class UpgradeSelfAction extends BaseRushAction {
  private _skipUpdateFlag!: CommandLineFlagParameter;
  private readonly _terminal: Terminal;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'upgrade-self',
      summary: 'Upgrade rush version in current repository',
      documentation:
        'The "rush upgrade-self" command is used to upgrade rush version in current repository. ' +
        'It helps maintainer to upgrade rushVersion in rush.json, settle down the versions of the' +
        ' dependency of rush self, and update lockfile in autoinstallers if changed.',
      parser
    });
    this._terminal = new Terminal(
      new ConsoleTerminalProvider({
        verboseEnabled: this.parser.isDebug
      })
    );
  }

  protected onDefineParameters(): void {
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
      terminal: this._terminal
    });

    const { needRushUpdate } = await upgradeRushSelf.upgradeAsync();

    if (needRushUpdate && !this._skipUpdateFlag.value) {
      const promptModule: inquirerTypes.PromptModule = inquirer.createPromptModule();
      const { confirmRushUpdate } = await promptModule({
        type: 'confirm',
        name: 'confirmRushUpdate',
        message: `Confirm run rush update?`
      });
      if (confirmRushUpdate) {
        const executeResult: boolean = await this._runRushUpdate();
        if (!executeResult) {
          this._terminal.writeErrorLine(`Run "rush update" failed...`);
        }
      } else {
        this._terminal.writeWarningLine(
          'There are package.json changes. Run "rush update" to update the lockfile.'
        );
      }
    }

    this._terminal.writeLine(Colors.green(`Rush version successfully updated`));
  }

  private async _runRushUpdate(): Promise<boolean> {
    const parser: RushCommandLineParser = new RushCommandLineParser();
    return await parser.execute(['update']);
  }
}
