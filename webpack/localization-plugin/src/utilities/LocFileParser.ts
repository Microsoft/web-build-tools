// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { NewlineKind, JsonFile } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import { ILocalizationFile } from '../interfaces';
import { ResxReader } from './ResxReader';
import { Constants } from './Constants';

/**
 * @internal
 */
export interface IParseLocFileOptions {
  terminal: ITerminal;
  filePath: string;
  content: string;
  resxNewlineNormalization: NewlineKind | undefined;
}

interface IParseCacheEntry {
  content: string;
  parsedFile: ILocalizationFile;
}

const parseCache: Map<string, IParseCacheEntry> = new Map<string, IParseCacheEntry>();

/**
 * @internal
 */
export class LocFileParser {
  public static parseLocFile(options: IParseLocFileOptions): ILocalizationFile {
    const fileCacheKey: string = `${options.filePath}?${options.resxNewlineNormalization || 'none'}`;
    if (parseCache.has(fileCacheKey)) {
      const entry: IParseCacheEntry = parseCache.get(fileCacheKey)!;
      if (entry.content === options.content) {
        return entry.parsedFile;
      }
    }

    let parsedFile: ILocalizationFile;
    if (/\.resx$/i.test(options.filePath)) {
      parsedFile = ResxReader.readResxAsLocFile(options.content, {
        terminal: options.terminal,
        resxFilePath: options.filePath,
        newlineNormalization: options.resxNewlineNormalization
      });
    } else {
      parsedFile = JsonFile.parseString(options.content);
      try {
        Constants.LOC_JSON_SCHEMA.validateObject(parsedFile, options.filePath);
      } catch (e) {
        options.terminal.writeError(`The loc file is invalid. Error: ${e}`);
      }
    }

    parseCache.set(fileCacheKey, { content: options.content, parsedFile });
    return parsedFile;
  }
}
