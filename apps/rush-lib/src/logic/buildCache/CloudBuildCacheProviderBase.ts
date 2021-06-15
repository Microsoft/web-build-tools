// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminal } from '@rushstack/terminal';

export abstract class CloudBuildCacheProviderBase {
  public abstract readonly isCacheWriteAllowed: boolean;

  public abstract tryGetCacheEntryBufferByIdAsync(
    terminal: ITerminal,
    cacheId: string
  ): Promise<Buffer | undefined>;
  public abstract trySetCacheEntryBufferAsync(
    terminal: ITerminal,
    cacheId: string,
    entryBuffer: Buffer
  ): Promise<boolean>;
  public abstract updateCachedCredentialAsync(terminal: ITerminal, credential: string): Promise<void>;
  public abstract updateCachedCredentialInteractiveAsync(terminal: ITerminal): Promise<void>;
  public abstract deleteCachedCredentialsAsync(terminal: ITerminal): Promise<void>;
}
