// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * A Heft plugin for using node-sass during the "build" stage.
 *
 * @packageDocumentation
 */

import type { IHeftPlugin } from '@rushstack/heft';
import { SassTypingsPlugin } from './SassTypingsPlugin';

/**
 * @internal
 */
export default new SassTypingsPlugin() as IHeftPlugin;
