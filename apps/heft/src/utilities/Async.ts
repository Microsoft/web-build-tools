// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Async as CoreAsync } from '@rushstack/node-core-library';
import { ScopedLogger } from '../pluginFramework/logging/ScopedLogger';

/**
 * Helpful async utility methods
 */
export class Async {
  /**
   * Utility method to limit the number of parallel async operations with a promise queue.
   */
  public static async forEachLimitAsync<TEntry>(
    array: TEntry[],
    parallelismLimit: number,
    fn: (entry: TEntry) => Promise<void>
  ): Promise<void> {
    // Defer to the implementation in node-core-library
    return CoreAsync.forEachAsync(array, fn, { concurrency: parallelismLimit });
  }

  /**
   * Utility method to continuously run an async watcher in Heft's watchMode.
   */
  public static runWatcherWithErrorHandling(fn: () => Promise<void>, scopedLogger: ScopedLogger): void {
    try {
      fn().catch((e) => scopedLogger.emitError(e));
    } catch (e) {
      scopedLogger.emitError(e);
    }
  }
}
