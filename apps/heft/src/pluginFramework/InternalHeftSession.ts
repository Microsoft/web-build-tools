// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { SyncHook, FullTap } from 'tapable';

import { IHeftPlugin } from './IHeftPlugin';
import { HeftSession, RegisterAction } from './HeftSession';
import { BuildStage } from '../stages/BuildStage';
import { CleanStage } from '../stages/CleanStage';
import { TestStage } from '../stages/TestStage';
import { MetricsCollector } from '../metrics/MetricsCollector';
import { LoggingManager } from './logging/LoggingManager';
import { IHeftLifecycle } from './HeftLifecycle';
import { TapableUtilities } from '../utilities/TapableUtilities';

/**
 * @internal
 */
export interface IInternalHeftSessionOptions {
  heftLifecycleHook: SyncHook<IHeftLifecycle>;
  buildStage: BuildStage;
  cleanStage: CleanStage;
  testStage: TestStage;

  metricsCollector: MetricsCollector;
  loggingManager: LoggingManager;
  getIsDebugMode(): boolean;
  registerAction: RegisterAction;
}

/**
 * @internal
 */
export class InternalHeftSession {
  private readonly _options: IInternalHeftSessionOptions;
  private _pluginHooks: Map<string, SyncHook<object>> = new Map<string, SyncHook<object>>();

  public constructor(options: IInternalHeftSessionOptions) {
    this._options = options;
  }

  public getSessionForPlugin(thisPlugin: IHeftPlugin): HeftSession {
    return new HeftSession(
      {
        plugin: thisPlugin,
        requestAccessToPluginByName: (
          pluginToAccessName: string,
          pluginApplyFn: (pluginAccessor: object) => void
        ) => {
          let pluginHook: SyncHook<object> | undefined = this._pluginHooks.get(pluginToAccessName);
          if (!pluginHook) {
            pluginHook = new SyncHook<object>(['pluginAccessor']);
            this._pluginHooks.set(pluginToAccessName, pluginHook);
          }

          pluginHook.tap(thisPlugin.pluginName, pluginApplyFn);
        }
      },
      this._options
    );
  }

  public applyPluginHooks(plugin: IHeftPlugin): void {
    const pluginHook: SyncHook<object> | undefined = this._pluginHooks.get(plugin.pluginName);
    const accessor: object | undefined = plugin.accessor;
    if (pluginHook) {
      const taps: FullTap[] = TapableUtilities.getTaps(pluginHook);
      if (taps.length > 0) {
        if (!accessor) {
          const accessingPlugins: Set<string> = new Set<string>(taps.map((x) => x.name));
          throw new Error(
            `Plugin "${plugin.pluginName}" does not provide an accessor property, so it does not provide ` +
              `access to other plugins. Plugins requesting access to "${plugin.pluginName}: ` +
              Array.from(accessingPlugins).join(', ')
          );
        } else {
          pluginHook.call(accessor);
        }
      }
    }
  }
}
