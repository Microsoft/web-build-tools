// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { minify, MinifyOptions, MinifyOutput } from 'terser';
import { RawSourceMap } from 'source-map';
import './Base54';

declare module 'terser' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface SourceMapOptions {
    asObject?: boolean;
  }
}

import { IModuleMinificationRequest, IModuleMinificationResult } from '../ModuleMinifierPlugin.types';

/**
 * Minifies a single chunk of code. Factored out for reuse between ThreadPoolMinifier and SynchronousMinifier
 * Mutates terserOptions.output.comments to support comment extraction
 * @internal
 */
export function minifySingleFile(
  request: IModuleMinificationRequest,
  terserOptions: MinifyOptions
): IModuleMinificationResult {
  const output: MinifyOptions['output'] = terserOptions.output || {};
  const { mangle: originalMangle } = terserOptions;

  const mangle: MinifyOptions['mangle'] =
    originalMangle === false ? false : typeof originalMangle === 'object' ? { ...originalMangle } : {};

  const finalOptions: MinifyOptions = {
    ...terserOptions,
    output,
    mangle
  };
  output.comments = false;

  const { code, nameForMap, hash, externals } = request;

  if (mangle && externals) {
    mangle.reserved = mangle.reserved ? externals.concat(mangle.reserved) : externals;
  }

  finalOptions.sourceMap = nameForMap
    ? {
        asObject: true
      }
    : false;

  const minified: MinifyOutput = minify(
    {
      [nameForMap || 'code']: code
    },
    finalOptions
  );

  if (minified.error) {
    return {
      error: minified.error,
      code: undefined,
      map: undefined,
      hash
    };
  }

  return {
    error: undefined,
    code: minified.code!,
    map: minified.map as unknown as RawSourceMap,
    hash
  };
}
