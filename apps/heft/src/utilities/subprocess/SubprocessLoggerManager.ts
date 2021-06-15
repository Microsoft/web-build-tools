// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminalProvider, Terminal } from '@rushstack/terminal';

import {
  ISubprocessMessageBase,
  ISerializedErrorValue,
  ISubprocessApiCallArgWithValue
} from './SubprocessCommunication';
import { SubprocessCommunicationManagerBase } from './SubprocessCommunicationManagerBase';
import { TerminalProviderManager } from './TerminalProviderManager';
import { IScopedLogger, ScopedLogger } from '../../pluginFramework/logging/ScopedLogger';
import { HeftSession } from '../../pluginFramework/HeftSession';
import { SubprocessRunnerBase } from './SubprocessRunnerBase';

const SUBPROCESS_LOGGER_MANAGER_REQUEST_LOGGER_MESSAGE_TYPE: string = 'subprocessLoggerManagerRequestLogger';
const SUBPROCESS_LOGGER_MANAGER_PROVIDE_LOGGER_MESSAGE_TYPE: string = 'subprocessLoggerManagerProvideLogger';
const SUBPROCESS_LOGGER_EMIT_ERROR_WARNING_MESSAGE_TYPE: string = 'subprocessLoggerEmitErrorWarning';

interface IRequestLoggerMessage extends ISubprocessMessageBase {
  loggerName: string;
}

interface IProvideLoggerMessage extends ISubprocessMessageBase {
  loggerName: string;
  terminalProviderId?: number;
  error?: ISubprocessApiCallArgWithValue<ISerializedErrorValue>;
}

interface IEmitErrorOrWarning extends ISubprocessMessageBase {
  loggerId: number;
  errorOrWarning: ISubprocessApiCallArgWithValue<ISerializedErrorValue>;
  isError: boolean;
}

interface IPromiseResult<TResult> {
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
}

export interface ISubprocessLoggerManagerOptions {
  terminalProviderManager: TerminalProviderManager;
  heftSession?: HeftSession;
}

export class SubprocessLoggerManager extends SubprocessCommunicationManagerBase {
  private readonly _terminalProviderManager: TerminalProviderManager;
  private readonly _heftSession: HeftSession | undefined;
  private readonly _loggerNamesAwaitingResponse: Map<string, IPromiseResult<IScopedLogger>> = new Map<
    string,
    IPromiseResult<IScopedLogger>
  >();
  private readonly _requestedLoggers: Map<number, ScopedLogger> = new Map<number, ScopedLogger>();

  public constructor(options: ISubprocessLoggerManagerOptions) {
    super();

    this._heftSession = options.heftSession;
    this._terminalProviderManager = options.terminalProviderManager;
  }

  public async requestScopedLoggerAsync(loggerName: string): Promise<IScopedLogger> {
    if (this._loggerNamesAwaitingResponse.has(loggerName)) {
      throw new Error(`A logger with name "${loggerName}" has already been requested.`);
    }

    try {
      return await new Promise((resolve: (logger: IScopedLogger) => void, reject: (error: Error) => void) => {
        this._loggerNamesAwaitingResponse.set(loggerName, { resolve, reject });

        const message: IRequestLoggerMessage = {
          type: SUBPROCESS_LOGGER_MANAGER_REQUEST_LOGGER_MESSAGE_TYPE,
          loggerName: loggerName
        };
        this.sendMessageToParentProcess(message);
      });
    } finally {
      this._loggerNamesAwaitingResponse.delete(loggerName);
    }
  }

  public canHandleMessageFromSubprocess(message: ISubprocessMessageBase): boolean {
    return (
      message.type === SUBPROCESS_LOGGER_MANAGER_REQUEST_LOGGER_MESSAGE_TYPE ||
      message.type === SUBPROCESS_LOGGER_EMIT_ERROR_WARNING_MESSAGE_TYPE
    );
  }

  public receiveMessageFromSubprocess(message: ISubprocessMessageBase): void {
    switch (message.type) {
      case SUBPROCESS_LOGGER_MANAGER_REQUEST_LOGGER_MESSAGE_TYPE: {
        // Requesting a new logger
        if (!this._heftSession) {
          throw new Error(
            `A heft session must be provided to the ${SubprocessLoggerManager.name} instance in the ` +
              'parent process.'
          );
        }

        if (!this._terminalProviderManager) {
          throw new Error(
            `A terminal provider manager must be provided to the ${SubprocessLoggerManager.name} instance in the ` +
              'parent process.'
          );
        }

        const typedMessage: IRequestLoggerMessage = message as IRequestLoggerMessage;

        let responseMessage: IProvideLoggerMessage;
        try {
          const logger: ScopedLogger = this._heftSession.requestScopedLogger(typedMessage.loggerName);
          const terminalProviderId: number = this._terminalProviderManager.registerTerminalProvider(
            logger.terminalProvider
          );
          this._requestedLoggers.set(terminalProviderId, logger);

          responseMessage = {
            type: SUBPROCESS_LOGGER_MANAGER_PROVIDE_LOGGER_MESSAGE_TYPE,
            loggerName: typedMessage.loggerName,
            terminalProviderId: terminalProviderId
          };
        } catch (error) {
          responseMessage = {
            type: SUBPROCESS_LOGGER_MANAGER_REQUEST_LOGGER_MESSAGE_TYPE,
            loggerName: typedMessage.loggerName,
            error: SubprocessRunnerBase.serializeForIpcMessage(
              error
            ) as ISubprocessApiCallArgWithValue<ISerializedErrorValue>
          };
        }

        this.sendMessageToSubprocess(responseMessage);

        break;
      }

      case SUBPROCESS_LOGGER_EMIT_ERROR_WARNING_MESSAGE_TYPE: {
        const typedMessage: IEmitErrorOrWarning = message as IEmitErrorOrWarning;
        const logger: ScopedLogger | undefined = this._requestedLoggers.get(typedMessage.loggerId);
        if (!logger) {
          throw new Error(`No logger was was registered with ID ${typedMessage.loggerId}`);
        }

        const errorOrWarning: Error = SubprocessRunnerBase.deserializeFromIpcMessage(
          typedMessage.errorOrWarning
        ) as Error;
        if (typedMessage.isError) {
          logger.emitError(errorOrWarning);
        } else {
          logger.emitWarning(errorOrWarning);
        }

        break;
      }
    }
  }

  public canHandleMessageFromParentProcess(message: ISubprocessMessageBase): boolean {
    return message.type === SUBPROCESS_LOGGER_MANAGER_PROVIDE_LOGGER_MESSAGE_TYPE;
  }

  public receiveMessageFromParentProcess(message: ISubprocessMessageBase): void {
    if (message.type === SUBPROCESS_LOGGER_MANAGER_PROVIDE_LOGGER_MESSAGE_TYPE) {
      const typedMessage: IProvideLoggerMessage = message as IProvideLoggerMessage;
      const response: IPromiseResult<IScopedLogger> | undefined = this._loggerNamesAwaitingResponse.get(
        typedMessage.loggerName
      );
      if (!response) {
        throw new Error(`Missing a registered responder for logger name "${typedMessage.loggerName}"`);
      }

      if (typedMessage.error) {
        const error: Error = SubprocessRunnerBase.deserializeFromIpcMessage(typedMessage.error) as Error;
        response.reject(error);
      } else if (typedMessage.terminalProviderId !== undefined) {
        const terminalProvider: ITerminalProvider =
          this._terminalProviderManager.registerSubprocessTerminalProvider(typedMessage.terminalProviderId);

        const sendErrorOrWarning: (errorOrWarning: Error, isError: boolean) => void = (
          errorOrWarning: Error,
          isError: boolean
        ) => {
          const message: IEmitErrorOrWarning = {
            type: SUBPROCESS_LOGGER_EMIT_ERROR_WARNING_MESSAGE_TYPE,
            loggerId: typedMessage.terminalProviderId!,
            errorOrWarning: SubprocessRunnerBase.serializeForIpcMessage(
              errorOrWarning
            ) as ISubprocessApiCallArgWithValue<ISerializedErrorValue>,
            isError
          };
          this.sendMessageToParentProcess(message);
        };

        const scopedLogger: IScopedLogger = {
          terminal: new Terminal(terminalProvider),
          emitError: (error: Error) => {
            sendErrorOrWarning(error, true);
          },
          emitWarning: (warning: Error) => {
            sendErrorOrWarning(warning, false);
          }
        };
        response.resolve(scopedLogger);
      } else {
        response.reject(new Error('Received an invalid response.'));
      }
    }
  }
}
