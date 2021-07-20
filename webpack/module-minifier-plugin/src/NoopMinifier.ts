// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  IModuleMinificationCallback,
  IModuleMinificationRequest,
  IModuleMinifier
} from './ModuleMinifierPlugin.types';

/**
 * Minifier implementation that does not actually transform the code, for debugging.
 * @public
 */
export class NoopMinifier implements IModuleMinifier {
  /**
   * No-op code transform.
   * @param request - The request to process
   * @param callback - The callback to invoke
   */
  public minify(request: IModuleMinificationRequest, callback: IModuleMinificationCallback): void {
    const { code, hash } = request;

    callback({
      hash,
      error: undefined,
      code,
      map: undefined
    });
  }
}
