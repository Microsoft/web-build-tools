// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Hook, FullTap } from 'tapable';

export class TapableUtilities {
  public static getTaps<THook extends Hook<unknown, unknown>>(hook: THook): FullTap[] {
    const result: FullTap[] = [];

    hook.intercept({
      register: (tap) => {
        result.push(tap);
        return tap;
      }
    });

    return result;
  }
}
