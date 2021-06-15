// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider, TerminalProviderSeverity } from '@rushstack/terminal';

import { ISubprocessInnerConfiguration } from './SubprocessRunnerBase';
import { ISubprocessMessageBase } from './SubprocessCommunication';
import { SubprocessCommunicationManagerBase } from './SubprocessCommunicationManagerBase';

const TERMINAL_PROVIDER_MESSAGE_TYPE: string = 'terminalProviderMessage';

interface ITerminalProviderSubprocessMessage extends ISubprocessMessageBase {
  terminalProviderId: number;
  data: string;
  severity: TerminalProviderSeverity;
}

export interface ITerminalProviderManagerOptions {
  configuration: ISubprocessInnerConfiguration;
}

export class TerminalProviderManager extends SubprocessCommunicationManagerBase {
  private _terminalProviderIdCounter: number = 0;
  private readonly _terminalProviders: Map<number, ITerminalProvider> = new Map<number, ITerminalProvider>();
  private readonly _configuration: ISubprocessInnerConfiguration;

  public constructor(options: ITerminalProviderManagerOptions) {
    super();

    this._configuration = options.configuration;
  }

  public registerTerminalProvider(terminalProvider: ITerminalProvider): number {
    const id: number = this._terminalProviderIdCounter++;
    this._terminalProviders.set(id, terminalProvider);

    return id;
  }

  public registerSubprocessTerminalProvider(terminalProviderId: number): ITerminalProvider {
    const terminalProvider: ITerminalProvider = {
      eolCharacter: this._configuration.terminalEolCharacter,
      supportsColor: this._configuration.terminalSupportsColor,
      write: (data: string, severity: TerminalProviderSeverity) => {
        const message: ITerminalProviderSubprocessMessage = {
          type: TERMINAL_PROVIDER_MESSAGE_TYPE,
          terminalProviderId,
          data,
          severity
        };
        this.sendMessageToParentProcess(message);
      }
    };

    return terminalProvider;
  }

  public canHandleMessageFromSubprocess(message: ISubprocessMessageBase): boolean {
    return message.type === TERMINAL_PROVIDER_MESSAGE_TYPE;
  }

  public receiveMessageFromSubprocess(message: ISubprocessMessageBase): void {
    if (message.type === TERMINAL_PROVIDER_MESSAGE_TYPE) {
      const { terminalProviderId, data, severity } = message as ITerminalProviderSubprocessMessage;
      const terminalProvider: ITerminalProvider | undefined = this._terminalProviders.get(terminalProviderId);
      if (terminalProvider) {
        terminalProvider.write(data, severity);
      } else {
        throw new Error(`A terminal provider with ID ${terminalProviderId} has not been registered.`);
      }
    }
  }

  public canHandleMessageFromParentProcess(message: ISubprocessMessageBase): boolean {
    return false;
  }

  public receiveMessageFromParentProcess(message: ISubprocessMessageBase): void {}
}
