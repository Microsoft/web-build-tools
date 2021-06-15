// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { loader } from 'webpack';
import { Terminal, ITerminal } from '@rushstack/terminal';

import { LocalizationPlugin } from '../LocalizationPlugin';
import { ILocalizationFile } from '../interfaces';
import { LocFileParser } from '../utilities/LocFileParser';
import { loaderFactory, IBaseLoaderOptions } from './LoaderFactory';
import { EntityMarker } from '../utilities/EntityMarker';
import { LoaderTerminalProvider } from '../utilities/LoaderTerminalProvider';

export interface ILocLoaderOptions extends IBaseLoaderOptions {
  pluginInstance: LocalizationPlugin;
}

export default loaderFactory(function (
  this: loader.LoaderContext,
  locFilePath: string,
  content: string,
  options: ILocLoaderOptions
) {
  const { pluginInstance } = options;
  const terminal: ITerminal = new Terminal(LoaderTerminalProvider.getTerminalProviderForLoader(this));
  const locFileData: ILocalizationFile = LocFileParser.parseLocFile({
    content,
    terminal,
    filePath: locFilePath,
    resxNewlineNormalization: options.resxNewlineNormalization
  });
  const { additionalLoadedFilePaths, errors } = pluginInstance.addDefaultLocFile(
    terminal,
    locFilePath,
    locFileData
  );
  for (const additionalFile of additionalLoadedFilePaths) {
    this.dependency(additionalFile);
  }

  for (const error of errors) {
    this.emitError(error);
  }

  const resultObject: { [stringName: string]: string } = {};
  // eslint-disable-next-line guard-for-in
  for (const stringName in locFileData) {
    const stringKey: string = `${locFilePath}?${stringName}`;
    if (pluginInstance.stringKeys.has(stringKey)) {
      resultObject[stringName] = pluginInstance.stringKeys.get(stringKey)!.value;
    } else {
      throw new Error(`Unexpected - missing placeholder for string key "${stringKey}"`);
    }
  }

  EntityMarker.markEntity(this._module, true);

  return resultObject;
});
