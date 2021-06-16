// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StageBase, StageHooksBase, IStageContext } from './StageBase';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { AsyncSeriesHook, AsyncParallelHook } from 'tapable';
import { LoggingManager } from '../pluginFramework/logging/LoggingManager';

/**
 * @public
 */
export class TestStageHooks extends StageHooksBase<ITestStageProperties> {
  public readonly run: AsyncParallelHook<[]> = new AsyncParallelHook();
  public readonly configureTest: AsyncSeriesHook<[]> = new AsyncSeriesHook();
}

/**
 * @public
 */
export interface ITestStageProperties {
  watchMode: boolean;
  updateSnapshots: boolean;

  findRelatedTests: ReadonlyArray<string> | undefined;
  passWithNoTests: boolean | undefined;
  silent: boolean | undefined;
  testNamePattern: string | undefined;
  testPathPattern: ReadonlyArray<string> | undefined;
  testTimeout: number | undefined;
  detectOpenHandles: boolean | undefined;
  debugHeftReporter: boolean | undefined;
  maxWorkers: string | undefined;
}

/**
 * @public
 */
export interface ITestStageContext extends IStageContext<TestStageHooks, ITestStageProperties> {}

export interface ITestStageOptions {
  watchMode: boolean;
  updateSnapshots: boolean;

  findRelatedTests: ReadonlyArray<string> | undefined;
  passWithNoTests: boolean | undefined;
  silent: boolean | undefined;
  testNamePattern: string | undefined;
  testPathPattern: ReadonlyArray<string> | undefined;
  testTimeout: number | undefined;
  detectOpenHandles: boolean | undefined;
  debugHeftReporter: boolean | undefined;
  maxWorkers: string | undefined;
}

export class TestStage extends StageBase<TestStageHooks, ITestStageProperties, ITestStageOptions> {
  public constructor(heftConfiguration: HeftConfiguration, loggingManager: LoggingManager) {
    super(heftConfiguration, loggingManager, TestStageHooks);
  }

  protected async getDefaultStagePropertiesAsync(options: ITestStageOptions): Promise<ITestStageProperties> {
    return {
      watchMode: options.watchMode,
      updateSnapshots: options.updateSnapshots,

      findRelatedTests: options.findRelatedTests,
      passWithNoTests: options.passWithNoTests,
      silent: options.silent,
      testNamePattern: options.testNamePattern,
      testPathPattern: options.testPathPattern,
      testTimeout: options.testTimeout,
      detectOpenHandles: options.detectOpenHandles,
      debugHeftReporter: options.debugHeftReporter,
      maxWorkers: options.maxWorkers
    };
  }

  protected async executeInnerAsync(): Promise<void> {
    await this.stageHooks.configureTest.promise();
    await this.stageHooks.run.promise();
  }
}
