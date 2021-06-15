// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { loader } from 'webpack';
import { Terminal } from '@rushstack/terminal';

import { ILocalizationFile } from '../interfaces';
import { LocFileParser } from '../utilities/LocFileParser';
import { loaderFactory, IBaseLoaderOptions } from './LoaderFactory';
import { LoaderTerminalProvider } from '../utilities/LoaderTerminalProvider';

export default loaderFactory(function (
  this: loader.LoaderContext,
  locFilePath: string,
  content: string,
  options: IBaseLoaderOptions
) {
  const locFileData: ILocalizationFile = LocFileParser.parseLocFile({
    content,
    filePath: locFilePath,
    terminal: new Terminal(LoaderTerminalProvider.getTerminalProviderForLoader(this)),
    resxNewlineNormalization: options.resxNewlineNormalization
  });
  const resultObject: { [stringName: string]: string } = {};
  for (const [stringName, stringValue] of Object.entries(locFileData)) {
    resultObject[stringName] = stringValue.value;
  }

  return resultObject;
});
