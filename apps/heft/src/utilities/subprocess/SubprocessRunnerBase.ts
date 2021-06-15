// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as childProcess from 'child_process';
import * as path from 'path';
import { ITerminalProvider, Terminal, ITerminal } from '@rushstack/terminal';

import {
  ISubprocessMessageBase,
  ISubprocessApiCallArg,
  SupportedSerializableArgType,
  ISubprocessApiCallArgWithValue,
  ISerializedErrorValue,
  ISerializedFileErrorValue
} from './SubprocessCommunication';
import { HeftSession } from '../../pluginFramework/HeftSession';
import { TerminalProviderManager } from './TerminalProviderManager';
import {
  SubprocessCommunicationManagerBase,
  ISubprocessCommunicationManagerInitializationOptions
} from './SubprocessCommunicationManagerBase';
import { IScopedLogger } from '../../pluginFramework/logging/ScopedLogger';
import { SubprocessLoggerManager } from './SubprocessLoggerManager';
import { FileError } from '../../pluginFramework/logging/FileError';
import { SubprocessTerminator } from './SubprocessTerminator';

export interface ISubprocessInnerConfiguration {
  globalTerminalProviderId: number;
  terminalSupportsColor: boolean;
  terminalEolCharacter: string;
}

export const SUBPROCESS_RUNNER_CLASS_LABEL: unique symbol = Symbol('IsSubprocessModule');
export const SUBPROCESS_RUNNER_INNER_INVOKE: unique symbol = Symbol('SubprocessInnerInvoke');

interface ISubprocessExitMessage extends ISubprocessMessageBase {
  type: 'exit';
  error: ISubprocessApiCallArg;
}

/**
 * This base class allows an computationally expensive task to be run in a separate NodeJS
 * process.
 *
 * The subprocess can be provided with a configuration, which must be JSON-serializable,
 * and the subprocess can log data via a Terminal object.
 */
export abstract class SubprocessRunnerBase<TSubprocessConfiguration> {
  public static [SUBPROCESS_RUNNER_CLASS_LABEL]: boolean = true;
  private static _subprocessInspectorPort: number = 9229 + 1; // 9229 is the default port

  private _terminalProviderManager!: TerminalProviderManager;
  private _scopedLoggerManager!: SubprocessLoggerManager;
  private _subprocessCommunicationManagerInitializationOptions!: ISubprocessCommunicationManagerInitializationOptions;

  private _innerConfiguration!: ISubprocessInnerConfiguration;
  public _runningAsSubprocess: boolean = false;
  protected readonly _configuration: TSubprocessConfiguration;

  protected _globalTerminal!: ITerminal;
  private readonly _subprocessCommunicationManagers: SubprocessCommunicationManagerBase[] = [];

  /**
   * The subprocess filename. This should be set to __filename in the child class.
   */
  public abstract get filename(): string;

  public get runningAsSubprocess(): boolean {
    return this._runningAsSubprocess;
  }

  /**
   * Constructs an instances of a subprocess runner
   */
  public constructor(
    parentGlobalTerminalProvider: ITerminalProvider,
    configuration: TSubprocessConfiguration,
    heftSession: HeftSession
  ) {
    this._configuration = configuration;

    if (parentGlobalTerminalProvider) {
      // This is the parent process
      this._innerConfiguration = {
        globalTerminalProviderId: undefined!,
        terminalEolCharacter: parentGlobalTerminalProvider.eolCharacter,
        terminalSupportsColor: parentGlobalTerminalProvider.supportsColor
      };

      this._registerDefaultCommunicationManagers(
        {
          sendMessageToParentProcess: this._receiveMessageFromSubprocess.bind(this),
          sendMessageToSubprocess: this._receiveMessageFromParentProcess.bind(this)
        },
        heftSession
      );

      const globalTerminalProviderId: number = this._terminalProviderManager.registerTerminalProvider(
        parentGlobalTerminalProvider
      );
      this._innerConfiguration.globalTerminalProviderId = globalTerminalProviderId;
      this._globalTerminal = new Terminal(
        this._terminalProviderManager.registerSubprocessTerminalProvider(globalTerminalProviderId)
      );
    }
  }

  public static initializeSubprocess<TSubprocessConfiguration>(
    thisType: new (
      parentGlobalTerminalProvider: ITerminalProvider,
      configuration: TSubprocessConfiguration,
      heftSession: HeftSession
    ) => SubprocessRunnerBase<TSubprocessConfiguration>,
    innerConfiguration: ISubprocessInnerConfiguration,
    configuration: TSubprocessConfiguration
  ): SubprocessRunnerBase<TSubprocessConfiguration> {
    const subprocessRunner: SubprocessRunnerBase<TSubprocessConfiguration> = new thisType(
      undefined!,
      configuration,
      undefined!
    );
    subprocessRunner._runningAsSubprocess = true;
    subprocessRunner._innerConfiguration = innerConfiguration;

    subprocessRunner._registerDefaultCommunicationManagers(
      {
        sendMessageToParentProcess: process.send!.bind(process),
        sendMessageToSubprocess: () => {
          throw new Error('A subprocess cannot send a message to itself.');
        }
      },
      undefined
    );

    subprocessRunner._globalTerminal = new Terminal(
      subprocessRunner._terminalProviderManager.registerSubprocessTerminalProvider(
        innerConfiguration.globalTerminalProviderId
      )
    );

    return subprocessRunner;
  }

  public invokeAsSubprocessAsync(): Promise<void> {
    return new Promise((resolve: () => void, reject: (error: Error) => void) => {
      const subprocess: childProcess.ChildProcess = childProcess.fork(
        path.resolve(__dirname, 'startSubprocess'),
        [this.filename, JSON.stringify(this._innerConfiguration), JSON.stringify(this._configuration)],
        {
          execArgv: this._processNodeArgsForSubprocess(this._globalTerminal, process.execArgv),
          ...SubprocessTerminator.RECOMMENDED_OPTIONS
        }
      );

      SubprocessTerminator.killProcessTreeOnExit(subprocess, SubprocessTerminator.RECOMMENDED_OPTIONS);

      this._terminalProviderManager.registerSubprocess(subprocess);
      this._scopedLoggerManager.registerSubprocess(subprocess);

      let hasExited: boolean = false;
      let exitError: Error | undefined;

      subprocess.on('message', (message: ISubprocessMessageBase) => {
        switch (message.type) {
          case 'exit': {
            if (hasExited) {
              throw new Error(
                `Subprocess communication error. Received a duplicate "${message.type}" message.`
              );
            }

            const exitMessage: ISubprocessExitMessage = message as ISubprocessExitMessage;
            hasExited = true;
            exitError = SubprocessRunnerBase.deserializeFromIpcMessage(exitMessage.error) as
              | Error
              | undefined;

            break;
          }

          default: {
            if (hasExited) {
              throw new Error(
                'Subprocess communication error. Received a message after the subprocess ' +
                  'has indicated that it has exited'
              );
            }

            this._receiveMessageFromSubprocess(message);
          }
        }
      });

      subprocess.on('close', () => {
        if (exitError) {
          reject(exitError);
        } else if (!hasExited) {
          reject(new Error('Subprocess exited before sending "exit" message.'));
        } else {
          resolve();
        }
      });
    });
  }

  public abstract invokeAsync(): Promise<void>;

  public async [SUBPROCESS_RUNNER_INNER_INVOKE](): Promise<void> {
    process.on('message', (message: ISubprocessMessageBase) => {
      this._receiveMessageFromParentProcess(message);
    });

    let error: Error | undefined = undefined;
    try {
      await this.invokeAsync();
    } catch (e) {
      error = e;
    } finally {
      process.removeAllListeners();

      const exitMessage: ISubprocessExitMessage = {
        type: 'exit',
        error: SubprocessRunnerBase.serializeForIpcMessage(error)
      };
      process.send!(exitMessage);
    }
  }

  protected registerSubprocessCommunicationManager(
    communicationManager: SubprocessCommunicationManagerBase
  ): void {
    if (this._subprocessCommunicationManagerInitializationOptions) {
      communicationManager.initialize(this._subprocessCommunicationManagerInitializationOptions);
    }

    this._subprocessCommunicationManagers.push(communicationManager);
  }

  protected async requestScopedLoggerAsync(loggerName: string): Promise<IScopedLogger> {
    return await this._scopedLoggerManager.requestScopedLoggerAsync(loggerName);
  }

  private _registerDefaultCommunicationManagers(
    subprocessCommunicationManagerInitializationOptions: ISubprocessCommunicationManagerInitializationOptions,
    heftSession: HeftSession | undefined
  ): void {
    if (this._subprocessCommunicationManagerInitializationOptions) {
      throw new Error('Default subprocess communication managers have already been registered.');
    }

    this._subprocessCommunicationManagerInitializationOptions =
      subprocessCommunicationManagerInitializationOptions;

    for (const communicationManager of this._subprocessCommunicationManagers) {
      communicationManager.initialize(this._subprocessCommunicationManagerInitializationOptions);
    }

    this._terminalProviderManager = new TerminalProviderManager({
      configuration: this._innerConfiguration
    });
    this._scopedLoggerManager = new SubprocessLoggerManager({
      terminalProviderManager: this._terminalProviderManager,
      heftSession: heftSession
    });

    this.registerSubprocessCommunicationManager(this._terminalProviderManager);
    this.registerSubprocessCommunicationManager(this._scopedLoggerManager);
  }

  private _processNodeArgsForSubprocess(terminal: ITerminal, nodeArgs: string[]): string[] {
    nodeArgs = [...nodeArgs]; // Clone the args array
    const inspectPort: number = SubprocessRunnerBase._subprocessInspectorPort++;
    let willUseInspector: boolean = false;

    for (let i: number = 0; i < nodeArgs.length; i++) {
      // The '--inspect' and '--inspect-brk' arguments can have an explicit port specified with syntax that
      // looks like '--inspect=<port>', so we'll split by the '=' character in case the port is explicitly specified
      const [firstNodeArgPart]: string[] = nodeArgs[i].split('=');
      if (firstNodeArgPart === '--inspect' || firstNodeArgPart === '--inspect-brk') {
        nodeArgs[i] = `${firstNodeArgPart}=${inspectPort}`;
        willUseInspector = true;
      }
    }

    if (willUseInspector) {
      terminal.writeLine(`Subprocess with inspector bound to port ${inspectPort}`);
    }

    return nodeArgs;
  }

  private _receiveMessageFromParentProcess(message: ISubprocessMessageBase): void {
    for (const subprocessCommunicationManager of this._subprocessCommunicationManagers) {
      if (subprocessCommunicationManager.canHandleMessageFromParentProcess(message)) {
        subprocessCommunicationManager.receiveMessageFromParentProcess(message);
        return;
      }
    }

    throw new Error(
      'Subprocess communication manager. No communication manager can handle message type ' +
        `"${message.type}" from parent process.`
    );
  }

  private _receiveMessageFromSubprocess(message: ISubprocessMessageBase): void {
    for (const subprocessCommunicationManager of this._subprocessCommunicationManagers) {
      if (subprocessCommunicationManager.canHandleMessageFromSubprocess(message)) {
        subprocessCommunicationManager.receiveMessageFromSubprocess(message);
        return;
      }
    }

    throw new Error(
      'Subprocess communication manager. No communication manager can handle message type ' +
        `"${message.type}" from subprocess.`
    );
  }

  public static serializeForIpcMessage(arg: unknown): ISubprocessApiCallArg {
    if (arg === undefined) {
      return { type: SupportedSerializableArgType.Undefined };
    } else if (arg === null) {
      return { type: SupportedSerializableArgType.Null };
    }

    switch (typeof arg) {
      case 'object': {
        if (arg instanceof FileError) {
          const result: ISubprocessApiCallArgWithValue<ISerializedFileErrorValue> = {
            type: SupportedSerializableArgType.FileError,
            value: {
              errorMessage: arg.message,
              errorStack: arg.stack,
              filePath: arg.filePath,
              line: arg.line,
              column: arg.column
            }
          };

          return result;
        } else if (arg instanceof Error) {
          const result: ISubprocessApiCallArgWithValue<ISerializedErrorValue> = {
            type: SupportedSerializableArgType.Error,
            value: {
              errorMessage: arg.message,
              errorStack: arg.stack
            }
          };

          return result;
        }

        break;
      }

      case 'string':
      case 'number':
      case 'boolean': {
        const result: ISubprocessApiCallArgWithValue = {
          type: SupportedSerializableArgType.Primitive,
          value: arg
        };

        return result;
      }
    }

    throw new Error(`Argument (${arg}) is not supported in subprocess communication.`);
  }

  public static deserializeFromIpcMessage(arg: ISubprocessApiCallArg): unknown | undefined {
    switch (arg.type) {
      case SupportedSerializableArgType.Undefined: {
        return undefined;
      }

      case SupportedSerializableArgType.Null: {
        return null;
      }

      case SupportedSerializableArgType.Error: {
        const typedArg: ISubprocessApiCallArgWithValue<ISerializedErrorValue> =
          arg as ISubprocessApiCallArgWithValue<ISerializedErrorValue>;
        const result: Error = new Error(typedArg.value.errorMessage);
        result.stack = typedArg.value.errorStack;
        return result;
      }

      case SupportedSerializableArgType.FileError: {
        const typedArg: ISubprocessApiCallArgWithValue<ISerializedFileErrorValue> =
          arg as ISubprocessApiCallArgWithValue<ISerializedFileErrorValue>;
        const result: FileError = new FileError(
          typedArg.value.errorMessage,
          typedArg.value.filePath,
          typedArg.value.line,
          typedArg.value.column
        );
        result.stack = typedArg.value.errorStack;
        return result;
      }

      case SupportedSerializableArgType.Primitive: {
        const typedArg: ISubprocessApiCallArgWithValue = arg as ISubprocessApiCallArgWithValue;
        return typedArg.value;
      }

      default:
        throw new Error(`Unexpected arg type "${arg.type}".`);
    }
  }
}
