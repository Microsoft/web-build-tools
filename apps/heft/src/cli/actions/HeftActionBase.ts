// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  CommandLineAction,
  CommandLineFlagParameter,
  ICommandLineActionOptions,
  ICommandLineFlagDefinition,
  IBaseCommandLineDefinition,
  ICommandLineChoiceDefinition,
  CommandLineChoiceParameter,
  CommandLineIntegerParameter,
  ICommandLineIntegerDefinition,
  CommandLineStringParameter,
  ICommandLineStringDefinition,
  CommandLineStringListParameter,
  ICommandLineStringListDefinition
} from '@rushstack/ts-command-line';
import { IPackageJson, AlreadyReportedError } from '@rushstack/node-core-library';
import { ITerminal, Colors, ConsoleTerminalProvider } from '@rushstack/terminal';
import { performance } from 'perf_hooks';

import { MetricsCollector } from '../../metrics/MetricsCollector';
import { HeftConfiguration } from '../../configuration/HeftConfiguration';
import { BuildStage } from '../../stages/BuildStage';
import { CleanStage } from '../../stages/CleanStage';
import { TestStage } from '../../stages/TestStage';
import { LoggingManager } from '../../pluginFramework/logging/LoggingManager';
import { Constants } from '../../utilities/Constants';

export interface IStages {
  buildStage: BuildStage;
  cleanStage: CleanStage;
  testStage: TestStage;
}

export interface IHeftActionBaseOptions {
  terminal: ITerminal;
  loggingManager: LoggingManager;
  metricsCollector: MetricsCollector;
  heftConfiguration: HeftConfiguration;
  stages: IStages;
}

export abstract class HeftActionBase extends CommandLineAction {
  protected readonly terminal: ITerminal;
  protected readonly loggingManager: LoggingManager;
  protected readonly metricsCollector: MetricsCollector;
  protected readonly heftConfiguration: HeftConfiguration;
  protected readonly stages: IStages;
  protected verboseFlag!: CommandLineFlagParameter;

  public constructor(
    commandLineOptions: ICommandLineActionOptions,
    heftActionOptions: IHeftActionBaseOptions
  ) {
    super(commandLineOptions);
    this.terminal = heftActionOptions.terminal;
    this.loggingManager = heftActionOptions.loggingManager;
    this.metricsCollector = heftActionOptions.metricsCollector;
    this.heftConfiguration = heftActionOptions.heftConfiguration;
    this.stages = heftActionOptions.stages;
    this.setStartTime();
  }

  public onDefineParameters(): void {
    this.verboseFlag = this.defineFlagParameter({
      parameterLongName: '--verbose',
      parameterShortName: '-v',
      description: 'If specified, log information useful for debugging.'
    });
  }

  public defineChoiceParameter(options: ICommandLineChoiceDefinition): CommandLineChoiceParameter {
    this._validateDefinedParameter(options);
    return super.defineChoiceParameter(options);
  }

  public defineFlagParameter(options: ICommandLineFlagDefinition): CommandLineFlagParameter {
    this._validateDefinedParameter(options);
    return super.defineFlagParameter(options);
  }

  public defineIntegerParameter(options: ICommandLineIntegerDefinition): CommandLineIntegerParameter {
    this._validateDefinedParameter(options);
    return super.defineIntegerParameter(options);
  }

  public defineStringParameter(options: ICommandLineStringDefinition): CommandLineStringParameter {
    this._validateDefinedParameter(options);
    return super.defineStringParameter(options);
  }

  public defineStringListParameter(
    options: ICommandLineStringListDefinition
  ): CommandLineStringListParameter {
    this._validateDefinedParameter(options);
    return super.defineStringListParameter(options);
  }

  public setStartTime(): void {
    this.metricsCollector.setStartTime();
  }

  public recordMetrics(): void {
    this.metricsCollector.record(this.actionName);
  }

  public async onExecute(): Promise<void> {
    this.terminal.writeLine(`Starting ${this.actionName}`);

    if (this.verboseFlag.value) {
      if (this.heftConfiguration.terminalProvider instanceof ConsoleTerminalProvider) {
        this.heftConfiguration.terminalProvider.verboseEnabled = true;
      }
    }

    let encounteredError: boolean = false;
    try {
      await this.actionExecuteAsync();
      await this.afterExecuteAsync();
    } catch (e) {
      encounteredError = true;
      throw e;
    } finally {
      this.recordMetrics();

      const warningStrings: string[] = this.loggingManager.getWarningStrings();
      const errorStrings: string[] = this.loggingManager.getErrorStrings();

      const encounteredWarnings: boolean = warningStrings.length > 0;
      encounteredError = encounteredError || errorStrings.length > 0;

      this.terminal.writeLine(
        Colors.bold(
          (encounteredError ? Colors.red : encounteredWarnings ? Colors.yellow : Colors.green)(
            `-------------------- Finished (${Math.round(performance.now()) / 1000}s) --------------------`
          )
        )
      );

      if (warningStrings.length > 0) {
        this.terminal.writeWarningLine(`Encountered ${warningStrings.length} warnings:`);
        for (const warningString of warningStrings) {
          this.terminal.writeWarningLine(`  ${warningString}`);
        }
      }

      if (errorStrings.length > 0) {
        this.terminal.writeErrorLine(`Encountered ${errorStrings.length} errors:`);
        for (const errorString of errorStrings) {
          this.terminal.writeErrorLine(`  ${errorString}`);
        }
      }

      const projectPackageJson: IPackageJson = this.heftConfiguration.projectPackageJson;
      this.terminal.writeLine(
        `Project: ${projectPackageJson.name}`,
        Colors.dim(Colors.gray(`@${projectPackageJson.version}`))
      );
      this.terminal.writeLine(`Heft version: ${this.heftConfiguration.heftPackageJson.version}`);
      this.terminal.writeLine(`Node version: ${process.version}`);
    }

    if (encounteredError) {
      throw new AlreadyReportedError();
    }
  }

  protected abstract actionExecuteAsync(): Promise<void>;

  /**
   * @virtual
   */
  protected async afterExecuteAsync(): Promise<void> {
    /* no-op by default */
  }

  private _validateDefinedParameter(options: IBaseCommandLineDefinition): void {
    if (
      options.parameterLongName === Constants.pluginParameterLongName ||
      options.parameterLongName === Constants.debugParameterLongName
    ) {
      throw new Error(`Actions must not register a parameter with longName "${options.parameterLongName}".`);
    }
  }
}
