// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineStringParameter, CommandLineFlagParameter } from '@rushstack/ts-command-line';
import { AlreadyReportedError } from '@rushstack/node-core-library';
import { ConsoleTerminalProvider, Terminal, ITerminal } from '@rushstack/terminal';

import { RushCommandLineParser } from '../RushCommandLineParser';
import { BaseRushAction } from './BaseRushAction';
import { BuildCacheConfiguration } from '../../api/BuildCacheConfiguration';
import { RushConstants } from '../../logic/RushConstants';

export class UpdateCloudCredentialsAction extends BaseRushAction {
  private _interactiveModeFlag!: CommandLineFlagParameter;
  private _credentialParameter!: CommandLineStringParameter;
  private _deleteFlag!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: RushConstants.updateCloudCredentialsCommandName,
      summary: '(EXPERIMENTAL) Update the credentials used by the build cache provider.',
      documentation:
        '(EXPERIMENTAL) If the build caching feature is configured, this command facilitates ' +
        'updating the credentials used by a cloud-based provider.',
      safeForSimultaneousRushProcesses: false,
      parser
    });
  }

  protected onDefineParameters(): void {
    this._interactiveModeFlag = this.defineFlagParameter({
      parameterLongName: '--interactive',
      parameterShortName: '-i',
      description: 'Run the credential update operation in interactive mode, if supported by the provider.'
    });
    this._credentialParameter = this.defineStringParameter({
      parameterLongName: '--credential',
      argumentName: 'CREDENTIAL_STRING',
      description: 'A static credential, to be cached.'
    });
    this._deleteFlag = this.defineFlagParameter({
      parameterLongName: '--delete',
      parameterShortName: '-d',
      description: 'If specified, delete stored credentials.'
    });
  }

  protected async runAsync(): Promise<void> {
    const terminal: ITerminal = new Terminal(new ConsoleTerminalProvider());

    const buildCacheConfiguration: BuildCacheConfiguration =
      await BuildCacheConfiguration.loadAndRequireEnabledAsync(terminal, this.rushConfiguration);

    if (this._deleteFlag.value) {
      if (this._interactiveModeFlag.value || this._credentialParameter.value !== undefined) {
        terminal.writeErrorLine(
          `If the ${this._deleteFlag.longName} is provided, no other parameters may be provided.`
        );
        throw new AlreadyReportedError();
      } else if (buildCacheConfiguration.cloudCacheProvider) {
        await buildCacheConfiguration.cloudCacheProvider.deleteCachedCredentialsAsync(terminal);
      } else {
        terminal.writeLine('A cloud build cache is not configured; there is nothing to delete.');
      }
    } else if (this._interactiveModeFlag.value && this._credentialParameter.value !== undefined) {
      terminal.writeErrorLine(
        `Both the ${this._interactiveModeFlag.longName} and the ` +
          `${this._credentialParameter.longName} parameters were provided. Only one ` +
          'or the other may be used at a time.'
      );
      throw new AlreadyReportedError();
    } else if (this._interactiveModeFlag.value) {
      if (buildCacheConfiguration.cloudCacheProvider) {
        await buildCacheConfiguration.cloudCacheProvider.updateCachedCredentialInteractiveAsync(terminal);
      } else {
        terminal.writeLine('A cloud build cache is not configured. Credentials are not required.');
      }
    } else if (this._credentialParameter.value !== undefined) {
      if (buildCacheConfiguration.cloudCacheProvider) {
        await buildCacheConfiguration.cloudCacheProvider.updateCachedCredentialAsync(
          terminal,
          this._credentialParameter.value
        );
      } else {
        terminal.writeErrorLine('A cloud build cache is not configured. Credentials are not supported.');
        throw new AlreadyReportedError();
      }
    } else {
      terminal.writeErrorLine(
        `One of the ${this._interactiveModeFlag.longName} parameter, the ` +
          `${this._credentialParameter.longName} parameter, or the ` +
          `${this._deleteFlag.longName} parameter must be provided.`
      );
      throw new AlreadyReportedError();
    }
  }
}
