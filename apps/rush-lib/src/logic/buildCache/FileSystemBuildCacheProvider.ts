// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { FileSystem } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import { RushConfiguration } from '../../api/RushConfiguration';
import { RushUserConfiguration } from '../../api/RushUserConfiguration';

export interface IFileSystemBuildCacheProviderOptions {
  rushConfiguration: RushConfiguration;
  rushUserConfiguration: RushUserConfiguration;
}

const DEFAULT_BUILD_CACHE_FOLDER_NAME: string = 'build-cache';

export class FileSystemBuildCacheProvider {
  private readonly _cacheFolderPath: string;

  public constructor(options: IFileSystemBuildCacheProviderOptions) {
    this._cacheFolderPath =
      options.rushUserConfiguration.buildCacheFolder ||
      path.join(options.rushConfiguration.commonTempFolder, DEFAULT_BUILD_CACHE_FOLDER_NAME);
  }

  public getCacheEntryPath(cacheId: string): string {
    return path.join(this._cacheFolderPath, cacheId);
  }

  public async tryGetCacheEntryPathByIdAsync(
    terminal: ITerminal,
    cacheId: string
  ): Promise<string | undefined> {
    const cacheEntryFilePath: string = this.getCacheEntryPath(cacheId);
    if (await FileSystem.existsAsync(cacheEntryFilePath)) {
      return cacheEntryFilePath;
    } else {
      return undefined;
    }
  }

  public async trySetCacheEntryBufferAsync(
    terminal: ITerminal,
    cacheId: string,
    entryBuffer: Buffer
  ): Promise<string> {
    const cacheEntryFilePath: string = this.getCacheEntryPath(cacheId);
    await FileSystem.writeFileAsync(cacheEntryFilePath, entryBuffer, { ensureFolderExists: true });
    terminal.writeVerboseLine(`Wrote cache entry to "${cacheEntryFilePath}".`);
    return cacheEntryFilePath;
  }
}
