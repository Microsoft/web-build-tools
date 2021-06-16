// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AsyncParallelHook } from 'tapable';
import { FileSystem } from '@rushstack/node-core-library';

import { StageBase, StageHooksBase, IStageContext } from './StageBase';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { LoggingManager } from '../pluginFramework/logging/LoggingManager';

/**
 * @public
 */
export class CleanStageHooks extends StageHooksBase<ICleanStageProperties> {
  public readonly run: AsyncParallelHook<[]> = new AsyncParallelHook();
}

/**
 * @public
 */
export interface ICleanStageProperties {
  deleteCache: boolean;
  pathsToDelete: Set<string>;
}

export interface ICleanStageOptions {
  deleteCache?: boolean;
}

/**
 * @public
 */
export interface ICleanStageContext extends IStageContext<CleanStageHooks, ICleanStageProperties> {}

export class CleanStage extends StageBase<CleanStageHooks, ICleanStageProperties, ICleanStageOptions> {
  public constructor(heftConfiguration: HeftConfiguration, loggingManager: LoggingManager) {
    super(heftConfiguration, loggingManager, CleanStageHooks);
  }

  protected async getDefaultStagePropertiesAsync(
    options: ICleanStageOptions
  ): Promise<ICleanStageProperties> {
    return {
      deleteCache: false,
      ...options,
      pathsToDelete: new Set<string>()
    };
  }

  protected async executeInnerAsync(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.stageProperties.deleteCache) {
      promises.push(FileSystem.deleteFolderAsync(this.heftConfiguration.buildCacheFolder));
    }

    promises.push(this.stageHooks.run.promise());

    await Promise.all(promises);
  }
}
