// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringValuesTypingsGenerator, IStringValueTyping } from '@rushstack/typings-generator';
import { NewlineKind } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';

import { ILocalizationFile } from './interfaces';
import { LocFileParser } from './utilities/LocFileParser';

/**
 * @public
 */
export interface ITypingsGeneratorOptions {
  srcFolder: string;
  generatedTsFolder: string;
  terminal?: ITerminal;
  exportAsDefault?: boolean;
  filesToIgnore?: string[];
  resxNewlineNormalization?: NewlineKind | undefined;
}

/**
 * This is a simple tool that generates .d.ts files for .loc.json and .resx files.
 *
 * @public
 */
export class LocFileTypingsGenerator extends StringValuesTypingsGenerator {
  public constructor(options: ITypingsGeneratorOptions) {
    super({
      ...options,
      fileExtensions: ['.resx', '.loc.json'],
      parseAndGenerateTypings: (fileContents: string, filePath: string) => {
        const locFileData: ILocalizationFile = LocFileParser.parseLocFile({
          filePath: filePath,
          content: fileContents,
          terminal: this._options.terminal!,
          resxNewlineNormalization: options.resxNewlineNormalization
        });

        const typings: IStringValueTyping[] = [];

        // eslint-disable-next-line guard-for-in
        for (const stringName in locFileData) {
          typings.push({
            exportName: stringName,
            comment: locFileData[stringName].comment
          });
        }

        return { typings };
      }
    });
  }
}
