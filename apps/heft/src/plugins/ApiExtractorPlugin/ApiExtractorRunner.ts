// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as semver from 'semver';
import * as path from 'path';
import { Path } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';
import type * as TApiExtractor from '@microsoft/api-extractor';

import { SubprocessRunnerBase } from '../../utilities/subprocess/SubprocessRunnerBase';
import { IScopedLogger } from '../../pluginFramework/logging/ScopedLogger';

export interface IApiExtractorRunnerConfiguration {
  /**
   * The path to the Extractor's config file ("api-extractor.json")
   *
   * For example, /home/username/code/repo/project/config/api-extractor.json
   */
  apiExtractorJsonFilePath: string;

  /**
   * The path to the @microsoft/api-extractor package
   *
   * For example, /home/username/code/repo/project/node_modules/@microsoft/api-extractor
   */
  apiExtractorPackagePath: string;

  /**
   * The path to the typescript package
   *
   * For example, /home/username/code/repo/project/node_modules/typescript
   */
  typescriptPackagePath: string | undefined;

  /**
   * The folder of the project being built
   *
   * For example, /home/username/code/repo/project
   */
  buildFolder: string;

  /**
   * If set to true, run API Extractor in production mode
   */
  production: boolean;
}

export class ApiExtractorRunner extends SubprocessRunnerBase<IApiExtractorRunnerConfiguration> {
  private _scopedLogger!: IScopedLogger;
  private _terminal!: ITerminal;

  public get filename(): string {
    return __filename;
  }

  public async invokeAsync(): Promise<void> {
    this._scopedLogger = await this.requestScopedLoggerAsync('api-extractor');
    this._terminal = this._scopedLogger.terminal;

    const apiExtractor: typeof TApiExtractor = require(this._configuration.apiExtractorPackagePath);

    this._scopedLogger.terminal.writeLine(`Using API Extractor version ${apiExtractor.Extractor.version}`);

    const apiExtractorVersion: semver.SemVer | null = semver.parse(apiExtractor.Extractor.version);
    if (
      !apiExtractorVersion ||
      apiExtractorVersion.major < 7 ||
      (apiExtractorVersion.major === 7 && apiExtractorVersion.minor < 10)
    ) {
      this._scopedLogger.emitWarning(new Error(`Heft requires API Extractor version 7.10.0 or newer`));
    }

    const configObjectFullPath: string = this._configuration.apiExtractorJsonFilePath;
    const configObject: TApiExtractor.IConfigFile =
      apiExtractor.ExtractorConfig.loadFile(configObjectFullPath);

    const extractorConfig: TApiExtractor.ExtractorConfig = apiExtractor.ExtractorConfig.prepare({
      configObject,
      configObjectFullPath,
      packageJsonFullPath: path.join(this._configuration.buildFolder, 'package.json'),
      projectFolderLookupToken: this._configuration.buildFolder
    });

    const extractorOptions: TApiExtractor.IExtractorInvokeOptions = {
      localBuild: !this._configuration.production,
      typescriptCompilerFolder: this._configuration.typescriptPackagePath,
      messageCallback: (message: TApiExtractor.ExtractorMessage) => {
        switch (message.logLevel) {
          case apiExtractor.ExtractorLogLevel.Error: {
            let logMessage: string;
            if (message.sourceFilePath) {
              const filePathForLog: string = Path.isUnderOrEqual(
                message.sourceFilePath,
                this._configuration.buildFolder
              )
                ? path.relative(this._configuration.buildFolder, message.sourceFilePath)
                : message.sourceFilePath;
              logMessage =
                `${filePathForLog}:${message.sourceFileLine}:${message.sourceFileColumn} - ` +
                `(${message.category}) ${message.text}`;
            } else {
              logMessage = message.text;
            }

            this._scopedLogger.emitError(new Error(logMessage));
            break;
          }

          case apiExtractor.ExtractorLogLevel.Warning: {
            let logMessage: string;
            if (message.sourceFilePath) {
              const filePathForLog: string = Path.isUnderOrEqual(
                message.sourceFilePath,
                this._configuration.buildFolder
              )
                ? path.relative(this._configuration.buildFolder, message.sourceFilePath)
                : message.sourceFilePath;
              logMessage =
                `${filePathForLog}:${message.sourceFileLine}:${message.sourceFileColumn} - ` +
                `(${message.messageId}) ${message.text}`;
            } else {
              logMessage = message.text;
            }

            this._scopedLogger.emitWarning(new Error(logMessage));
            break;
          }

          case apiExtractor.ExtractorLogLevel.Verbose: {
            this._terminal.writeVerboseLine(message.text);
            break;
          }

          case apiExtractor.ExtractorLogLevel.Info: {
            this._terminal.writeLine(message.text);
            break;
          }

          case apiExtractor.ExtractorLogLevel.None: {
            // Ignore messages with ExtractorLogLevel.None
            break;
          }

          default:
            this._scopedLogger.emitError(
              new Error(`Unexpected API Extractor log level: ${message.logLevel}`)
            );
        }

        message.handled = true;
      }
    };

    const apiExtractorResult: TApiExtractor.ExtractorResult = apiExtractor.Extractor.invoke(
      extractorConfig,
      extractorOptions
    );

    const { errorCount, warningCount } = apiExtractorResult;
    if (errorCount > 0) {
      this._terminal.writeErrorLine(
        `API Extractor completed with ${errorCount} error${errorCount > 1 ? 's' : ''}`
      );
    } else if (warningCount > 0) {
      this._terminal.writeWarningLine(
        `API Extractor completed with ${warningCount} warning${warningCount > 1 ? 's' : ''}`
      );
    }

    if (!apiExtractorResult.succeeded) {
      throw new Error('API Extractor failed.');
    }

    if (apiExtractorResult.apiReportChanged && this._configuration.production) {
      throw new Error('API Report changed.');
    }
  }
}
