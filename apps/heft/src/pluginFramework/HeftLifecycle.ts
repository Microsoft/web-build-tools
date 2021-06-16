// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AsyncParallelHook } from 'tapable';

/** @internal */
export interface IHeftLifecycle {
  hooks: HeftLifecycleHooks;
}

/** @internal */
export class HeftLifecycleHooks {
  public toolStart: AsyncParallelHook<[]> = new AsyncParallelHook();
}
