// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { InternalError, Import } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { IHeftPlugin } from './IHeftPlugin';
import { InternalHeftSession } from './InternalHeftSession';
import { HeftSession } from './HeftSession';
import {
  CoreConfigFiles,
  IHeftConfigurationJsonPluginSpecifier,
  IHeftConfigurationJson
} from '../utilities/CoreConfigFiles';

// Default plugins
import { CopyFilesPlugin } from '../plugins/CopyFilesPlugin';
import { TypeScriptPlugin } from '../plugins/TypeScriptPlugin/TypeScriptPlugin';
import { DeleteGlobsPlugin } from '../plugins/DeleteGlobsPlugin';
import { CopyStaticAssetsPlugin } from '../plugins/CopyStaticAssetsPlugin';
import { ApiExtractorPlugin } from '../plugins/ApiExtractorPlugin/ApiExtractorPlugin';
import { SassTypingsPlugin } from '../plugins/SassTypingsPlugin/SassTypingsPlugin';
import { ProjectValidatorPlugin } from '../plugins/ProjectValidatorPlugin';
import { ToolPackageResolver } from '../utilities/ToolPackageResolver';
import { NodeServicePlugin } from '../plugins/NodeServicePlugin';

export interface IPluginManagerOptions {
  terminal: ITerminal;
  heftConfiguration: HeftConfiguration;
  internalHeftSession: InternalHeftSession;
}

export class PluginManager {
  private _terminal: ITerminal;
  private _heftConfiguration: HeftConfiguration;
  private _internalHeftSession: InternalHeftSession;
  private _appliedPlugins: IHeftPlugin[] = [];
  private _appliedPluginNames: Set<string> = new Set<string>();

  public constructor(options: IPluginManagerOptions) {
    this._terminal = options.terminal;
    this._heftConfiguration = options.heftConfiguration;
    this._internalHeftSession = options.internalHeftSession;
  }

  public initializeDefaultPlugins(): void {
    const taskPackageResolver: ToolPackageResolver = new ToolPackageResolver();

    this._applyPlugin(new TypeScriptPlugin(taskPackageResolver));
    this._applyPlugin(new CopyStaticAssetsPlugin());
    this._applyPlugin(new CopyFilesPlugin());
    this._applyPlugin(new DeleteGlobsPlugin());
    this._applyPlugin(new ApiExtractorPlugin(taskPackageResolver));
    this._applyPlugin(new SassTypingsPlugin());
    this._applyPlugin(new ProjectValidatorPlugin());
    this._applyPlugin(new NodeServicePlugin());
  }

  public initializePlugin(pluginSpecifier: string, options?: object): void {
    const resolvedPluginPath: string = this._resolvePlugin(pluginSpecifier);
    this._initializeResolvedPlugin(resolvedPluginPath, options);
  }

  public async initializePluginsFromConfigFileAsync(): Promise<void> {
    const heftConfigurationJson: IHeftConfigurationJson | undefined =
      await CoreConfigFiles.heftConfigFileLoader.tryLoadConfigurationFileForProjectAsync(
        this._heftConfiguration.globalTerminal,
        this._heftConfiguration.buildFolder,
        this._heftConfiguration.rigConfig
      );
    const heftPluginSpecifiers: IHeftConfigurationJsonPluginSpecifier[] =
      heftConfigurationJson?.heftPlugins || [];

    for (const pluginSpecifier of heftPluginSpecifiers) {
      this._initializeResolvedPlugin(pluginSpecifier.plugin, pluginSpecifier.options);
    }
  }

  public afterInitializeAllPlugins(): void {
    for (const appliedPlugin of this._appliedPlugins) {
      this._internalHeftSession.applyPluginHooks(appliedPlugin);
    }
  }

  private _initializeResolvedPlugin(resolvedPluginPath: string, options?: object): void {
    const plugin: IHeftPlugin<object | void> = this._loadAndValidatePluginPackage(
      resolvedPluginPath,
      options
    );

    if (this._appliedPluginNames.has(plugin.pluginName)) {
      throw new Error(
        `Error applying plugin "${resolvedPluginPath}": A plugin with name "${plugin.pluginName}" has ` +
          'already been applied'
      );
    } else {
      this._applyPlugin(plugin, options);
    }
  }

  private _applyPlugin(plugin: IHeftPlugin<object | void>, options?: object): void {
    try {
      const heftSession: HeftSession = this._internalHeftSession.getSessionForPlugin(plugin);
      plugin.apply(heftSession, this._heftConfiguration, options);
      this._appliedPlugins.push(plugin);
      this._appliedPluginNames.add(plugin.pluginName);
    } catch (e) {
      throw new InternalError(`Error applying "${plugin.pluginName}": ${e}`);
    }
  }

  private _loadAndValidatePluginPackage(resolvedPluginPath: string, options?: object): IHeftPlugin {
    let pluginPackage: IHeftPlugin;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loadedPluginPackage: IHeftPlugin | { default: IHeftPlugin } = require(resolvedPluginPath);
      pluginPackage = (loadedPluginPackage as { default: IHeftPlugin }).default || loadedPluginPackage;
    } catch (e) {
      throw new InternalError(`Error loading plugin package from "${resolvedPluginPath}": ${e}`);
    }

    if (!pluginPackage) {
      throw new InternalError(`Plugin package loaded from "${resolvedPluginPath}" is null or undefined.`);
    }

    this._terminal.writeVerboseLine(`Loaded plugin package from "${resolvedPluginPath}"`);

    if (!pluginPackage.apply || typeof pluginPackage.apply !== 'function') {
      throw new InternalError(
        `Plugin packages must define an "apply" function. The plugin loaded from "${resolvedPluginPath}" ` +
          'either doesn\'t define an "apply" property, or its value isn\'t a function.'
      );
    }

    if (!pluginPackage.pluginName || typeof pluginPackage.pluginName !== 'string') {
      throw new InternalError(
        `Plugin packages must define a "pluginName" property. The plugin loaded from "${resolvedPluginPath}" ` +
          'either doesn\'t define a "pluginName" property, or its value isn\'t a string.'
      );
    }

    if (options && pluginPackage.optionsSchema) {
      try {
        pluginPackage.optionsSchema.validateObject(options, 'config/heft.json');
      } catch (e) {
        throw new Error(
          `Provided options for plugin "${pluginPackage.pluginName}" did not match the provided plugin schema.\n${e}`
        );
      }
    }

    return pluginPackage;
  }

  private _resolvePlugin(pluginSpecifier: string): string {
    let resolvedPluginPath: string;

    this._terminal.writeVerboseLine(`Resolving plugin ${pluginSpecifier}`);

    try {
      resolvedPluginPath = Import.resolveModule({
        modulePath: pluginSpecifier,
        baseFolderPath: this._heftConfiguration.buildFolder
      });
    } catch (e) {
      throw new InternalError(`Error resolving specified plugin "${pluginSpecifier}". Resolve error: ${e}`);
    }

    if (!resolvedPluginPath) {
      throw new InternalError(`Error resolving specified plugin "${pluginSpecifier}".`);
    }

    this._terminal.writeVerboseLine(`Resolved plugin path to ${resolvedPluginPath}`);

    return resolvedPluginPath;
  }
}
