// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { render, Result } from 'node-sass';
import postcss from 'postcss';
import cssModules from 'postcss-modules';
import { LegacyAdapters } from '@rushstack/node-core-library';
import { IStringValueTypings, StringValuesTypingsGenerator } from '@rushstack/typings-generator';

/**
 * @public
 */
export interface ISassConfiguration {
  /**
   * Source code root directory.
   * Defaults to "src/".
   */
  srcFolder?: string;

  /**
   * Output directory for generated Sass typings.
   * Defaults to "temp/sass-ts/".
   */
  generatedTsFolder?: string;

  /**
   * Determines if export values are wrapped in a default property, or not.
   * Defaults to true.
   */
  exportAsDefault?: boolean;

  /**
   * Files with these extensions will pass through the Sass transpiler for typings generation.
   * Defaults to [".sass", ".scss", ".css"]
   */
  fileExtensions?: string[];

  /**
   * A list of paths used when resolving Sass imports.
   * The paths should be relative to the project root.
   * Defaults to ["node_modules", "src"]
   */
  importIncludePaths?: string[];

  /**
   * A list of file paths relative to the "src" folder that should be excluded from typings generation.
   */
  excludeFiles?: string[];
}

/**
 * @public
 */
export interface ISassTypingsGeneratorOptions {
  buildFolder: string;
  sassConfiguration: ISassConfiguration;
}

interface IClassMap {
  [className: string]: string;
}

interface ICssModulesOptions {
  getJSON(cssFileName: string, json: IClassMap): void;
  generateScopeName(name: string): string;
}

type TCssModules = (options: ICssModulesOptions) => TCssModules;

/**
 * Generates type files (.d.ts) for Sass/SCSS/CSS files.
 *
 * @public
 */
export class SassTypingsGenerator extends StringValuesTypingsGenerator {
  /**
   * @param buildFolder - The project folder to search for Sass files and
   *     generate typings.
   */
  public constructor(options: ISassTypingsGeneratorOptions) {
    const { buildFolder, sassConfiguration } = options;
    const srcFolder: string = sassConfiguration.srcFolder || path.join(buildFolder, 'src');
    const generatedTsFolder: string =
      sassConfiguration.generatedTsFolder || path.join(buildFolder, 'temp', 'sass-ts');
    const exportAsDefault: boolean =
      sassConfiguration.exportAsDefault === undefined ? true : sassConfiguration.exportAsDefault;
    const exportAsDefaultInterfaceName: string = 'IExportStyles';
    const fileExtensions: string[] = sassConfiguration.fileExtensions || ['.sass', '.scss', '.css'];
    super({
      srcFolder,
      generatedTsFolder,
      exportAsDefault,
      exportAsDefaultInterfaceName,
      fileExtensions,
      filesToIgnore: sassConfiguration.excludeFiles,

      // Generate typings function
      parseAndGenerateTypings: async (fileContents: string, filePath: string) => {
        if (this._isSassPartial(filePath)) {
          // Do not generate typings for Sass partials.
          return;
        }
        const css: string = await this._transpileSassAsync(
          fileContents,
          filePath,
          buildFolder,
          sassConfiguration.importIncludePaths
        );
        const classNames: string[] = await this._getClassNamesFromCSSAsync(css, filePath);
        const sortedClassNames: string[] = classNames.sort((a, b) => a.localeCompare(b));
        const sassTypings: IStringValueTypings = { typings: [] };
        for (const exportName of sortedClassNames) {
          sassTypings.typings.push({ exportName });
        }

        return sassTypings;
      }
    });
  }

  /**
   * Sass partial files are snippets of CSS meant to be included in other Sass files.
   * Partial filenames always begin with a leading underscore and do not produce a CSS output file.
   */
  private _isSassPartial(filePath: string): boolean {
    return path.basename(filePath)[0] === '_';
  }

  private async _transpileSassAsync(
    fileContents: string,
    filePath: string,
    buildFolder: string,
    importIncludePaths: string[] | undefined
  ): Promise<string> {
    const result: Result = await LegacyAdapters.convertCallbackToPromise(render, {
      data: fileContents,
      file: filePath,
      importer: (url: string) => ({ file: this._patchSassUrl(url) }),
      includePaths: importIncludePaths
        ? importIncludePaths
        : [path.join(buildFolder, 'node_modules'), path.join(buildFolder, 'src')],
      indentedSyntax: path.extname(filePath).toLowerCase() === '.sass'
    });

    // Register any @import files as dependencies.
    const target: string = result.stats.entry;
    for (const dependency of result.stats.includedFiles) {
      this.registerDependency(target, dependency);
    }

    return result.css.toString();
  }

  private _patchSassUrl(url: string): string {
    if (url[0] === '~') {
      return 'node_modules/' + url.substr(1);
    }

    return url;
  }

  private async _getClassNamesFromCSSAsync(css: string, filePath: string): Promise<string[]> {
    let classMap: IClassMap = {};
    const cssModulesClassMapPlugin: postcss.Plugin<TCssModules> = cssModules({
      getJSON: (cssFileName: string, json: IClassMap) => {
        classMap = json;
      },
      // Avoid unnecessary name hashing.
      generateScopedName: (name: string) => name
    });
    await postcss([cssModulesClassMapPlugin]).process(css, { from: filePath });
    const classNames: string[] = Object.keys(classMap);

    return classNames;
  }
}
