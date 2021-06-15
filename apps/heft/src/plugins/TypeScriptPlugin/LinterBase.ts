// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { FileSystem, JsonFile } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import {
  IExtendedSourceFile,
  IExtendedProgram,
  IExtendedTypeScript
} from './internalTypings/TypeScriptInternals';
import { PerformanceMeasurer } from '../../utilities/Performance';
import { IScopedLogger } from '../../pluginFramework/logging/ScopedLogger';

export interface ILinterBaseOptions {
  ts: IExtendedTypeScript;
  scopedLogger: IScopedLogger;
  terminalPrefixLabel: string | undefined;
  buildFolderPath: string;
  buildCacheFolderPath: string;
  linterConfigFilePath: string;

  /**
   * A performance measurer for the lint run.
   */
  measurePerformance: PerformanceMeasurer;
}

export interface IRunLinterOptions {
  tsProgram: IExtendedProgram;

  /**
   * All of the files that the TypeScript compiler processed.
   */
  typeScriptFilenames: Set<string>;

  /**
   * The set of files that TypeScript has compiled since the last compilation.
   */
  changedFiles: Set<IExtendedSourceFile>;
}

export interface ITiming {
  duration: number;
  hitCount: number;
}

interface ITsLintCacheData {
  /**
   * The TSLint version and a hash of the TSLint config files. If either changes,
   * the cache is invalidated.
   */
  cacheVersion: string;

  /**
   * This is the result of `Array.from(Map<string, string>)`. The first element of
   * each array item is the file's path and the second element is the file's hash.
   */
  fileVersions: [string, string][];
}

export abstract class LinterBase<TLintResult> {
  protected readonly _scopedLogger: IScopedLogger;
  protected readonly _terminal: ITerminal;
  protected readonly _buildFolderPath: string;
  protected readonly _buildCacheFolderPath: string;
  protected readonly _linterConfigFilePath: string;
  protected readonly _measurePerformance: PerformanceMeasurer;

  private readonly _ts: IExtendedTypeScript;
  private readonly _linterName: string;

  public constructor(linterName: string, options: ILinterBaseOptions) {
    this._scopedLogger = options.scopedLogger;
    this._terminal = this._scopedLogger.terminal;
    this._ts = options.ts;
    this._buildFolderPath = options.buildFolderPath;
    this._buildCacheFolderPath = options.buildCacheFolderPath;
    this._linterConfigFilePath = options.linterConfigFilePath;
    this._linterName = linterName;
    this._measurePerformance = options.measurePerformance;
  }

  protected abstract get cacheVersion(): string;

  public abstract printVersionHeader(): void;

  public async performLintingAsync(options: IRunLinterOptions): Promise<void> {
    await this.initializeAsync(options.tsProgram);

    const tslintConfigVersion: string = this.cacheVersion;
    const cacheFilePath: string = path.join(this._buildCacheFolderPath, `${this._linterName}.json`);

    let tslintCacheData: ITsLintCacheData | undefined;
    try {
      tslintCacheData = await JsonFile.loadAsync(cacheFilePath);
    } catch (e) {
      if (FileSystem.isNotExistError(e)) {
        tslintCacheData = undefined;
      } else {
        throw e;
      }
    }

    const cachedNoFailureFileVersions: Map<string, string> = new Map<string, string>(
      tslintCacheData?.cacheVersion === tslintConfigVersion ? tslintCacheData.fileVersions : []
    );

    const newNoFailureFileVersions: Map<string, string> = new Map<string, string>();

    //#region Code from TSLint
    // Some of this code comes from here:
    // https://github.com/palantir/tslint/blob/24d29e421828348f616bf761adb3892bcdf51662/src/linter.ts#L161-L179
    // Modified to only lint files that have changed and that we care about
    const lintFailures: TLintResult[] = [];

    for (const sourceFile of options.tsProgram.getSourceFiles()) {
      const filePath: string = sourceFile.fileName;

      if (!options.typeScriptFilenames.has(filePath) || (await this.isFileExcludedAsync(filePath))) {
        continue;
      }

      // Older compilers don't compute the ts.SourceFile.version.  If it is missing, then we can't skip processing
      const version: string = sourceFile.version || '';
      const cachedVersion: string = cachedNoFailureFileVersions.get(filePath) || '';
      if (
        cachedVersion === '' ||
        version === '' ||
        cachedVersion !== version ||
        options.changedFiles.has(sourceFile)
      ) {
        this._measurePerformance(this._linterName, () => {
          const failures: TLintResult[] = this.lintFile(sourceFile);
          if (failures.length === 0) {
            newNoFailureFileVersions.set(filePath, version);
          } else {
            lintFailures.push(...failures);
          }
        });
      } else {
        newNoFailureFileVersions.set(filePath, version);
      }
    }
    //#endregion

    this.lintingFinished(lintFailures);

    const updatedTslintCacheData: ITsLintCacheData = {
      cacheVersion: tslintConfigVersion,
      fileVersions: Array.from(newNoFailureFileVersions)
    };
    await JsonFile.saveAsync(updatedTslintCacheData, cacheFilePath, { ensureFolderExists: true });

    const lintTiming: ITiming = this.getTiming(this._linterName);
    this._terminal.writeVerboseLine(`Lint: ${lintTiming.duration}ms (${lintTiming.hitCount} files)`);
  }

  public abstract reportFailures(): void;

  protected getTiming(timingName: string): ITiming {
    return {
      duration: this._ts.performance.getDuration(timingName),
      hitCount: this._ts.performance.getCount(`before${timingName}`)
    };
  }

  protected abstract initializeAsync(tsProgram: IExtendedProgram): void;

  protected abstract lintFile(sourceFile: IExtendedSourceFile): TLintResult[];

  protected abstract lintingFinished(lintFailures: TLintResult[]): void;

  protected abstract isFileExcludedAsync(filePath: string): Promise<boolean>;
}
