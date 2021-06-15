// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { PackageJsonLookup, INodePackageJson, Import } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';
import { RigConfig } from '@rushstack/rig-package';

import { HeftConfiguration } from '../configuration/HeftConfiguration';

export interface IToolPackageResolution {
  typeScriptPackagePath: string | undefined;
  tslintPackagePath: string | undefined;
  eslintPackagePath: string | undefined;
  apiExtractorPackagePath: string | undefined;
}

export class ToolPackageResolver {
  private _packageJsonLookup: PackageJsonLookup = new PackageJsonLookup();
  private _resolverCache: Map<string, Promise<IToolPackageResolution>> = new Map<
    string,
    Promise<IToolPackageResolution>
  >();

  public async resolveToolPackagesAsync(
    heftConfiguration: HeftConfiguration,
    terminal: ITerminal
  ): Promise<IToolPackageResolution> {
    const buildFolder: string = heftConfiguration.buildFolder;
    const projectFolder: string | undefined = this._packageJsonLookup.tryGetPackageFolderFor(buildFolder);
    if (!projectFolder) {
      throw new Error(`Unable to find a package.json file for "${buildFolder}" `);
    }

    let resolutionPromise: Promise<IToolPackageResolution> | undefined =
      this._resolverCache.get(projectFolder);
    if (!resolutionPromise) {
      resolutionPromise = this._resolveToolPackagesInnerAsync(heftConfiguration, terminal);
      this._resolverCache.set(projectFolder, resolutionPromise);
    }

    return await resolutionPromise;
  }

  private async _resolveToolPackagesInnerAsync(
    heftConfiguration: HeftConfiguration,
    terminal: ITerminal
  ): Promise<IToolPackageResolution> {
    // The following rules will apply independently to each tool (TypeScript, AE, ESLint, TSLint)
    // - If the local project has a devDependency (not regular or peer dependency) on the tool,
    // that has highest precedence.
    // - OTHERWISE if there is a rig.json file, then look at the rig's package.json. Does it have a
    // regular dependency (not dev or peer dependency) on the tool? If yes, then
    // resolve the tool from the rig package folder.
    // - OTHERWISE try to resolve it from the current project.

    const typeScriptPackageResolvePromise: Promise<string | undefined> = this._tryResolveToolPackageAsync(
      'typescript',
      heftConfiguration,
      terminal
    );
    const tslintPackageResolvePromise: Promise<string | undefined> = this._tryResolveToolPackageAsync(
      'tslint',
      heftConfiguration,
      terminal
    );
    const eslintPackageResolvePromise: Promise<string | undefined> = this._tryResolveToolPackageAsync(
      'eslint',
      heftConfiguration,
      terminal
    );
    const apiExtractorPackageResolvePromise: Promise<string | undefined> = this._tryResolveToolPackageAsync(
      '@microsoft/api-extractor',
      heftConfiguration,
      terminal
    );

    const [typeScriptPackagePath, tslintPackagePath, eslintPackagePath, apiExtractorPackagePath] =
      await Promise.all([
        typeScriptPackageResolvePromise,
        tslintPackageResolvePromise,
        eslintPackageResolvePromise,
        apiExtractorPackageResolvePromise
      ]);
    return {
      apiExtractorPackagePath,
      typeScriptPackagePath,
      tslintPackagePath,
      eslintPackagePath
    };
  }

  private async _tryResolveToolPackageAsync(
    toolPackageName: string,
    heftConfiguration: HeftConfiguration,
    terminal: ITerminal
  ): Promise<string | undefined> {
    // See if the project has a devDependency on the package
    if (
      heftConfiguration.projectPackageJson.devDependencies &&
      heftConfiguration.projectPackageJson.devDependencies[toolPackageName]
    ) {
      try {
        const resolvedPackageFolder: string = Import.resolvePackage({
          packageName: toolPackageName,
          baseFolderPath: heftConfiguration.buildFolder
        });
        terminal.writeVerboseLine(`Resolved "${toolPackageName}" as a direct devDependency of the project.`);
        return resolvedPackageFolder;
      } catch (e) {
        terminal.writeWarningLine(
          `"${toolPackageName}" is listed as a direct devDependency of the project, but could not be resolved. ` +
            'Have dependencies been installed?'
        );
        return undefined;
      }
    }

    const rigConfiguration: RigConfig = heftConfiguration.rigConfig;
    if (rigConfiguration.rigFound) {
      const rigFolder: string = rigConfiguration.getResolvedProfileFolder();
      const rigPackageJsonPath: string | undefined =
        this._packageJsonLookup.tryGetPackageJsonFilePathFor(rigFolder);
      if (!rigPackageJsonPath) {
        throw new Error(
          `Unable to resolve the package.json file for the "${rigConfiguration.rigPackageName}" rig package.`
        );
      }
      const rigPackageJson: INodePackageJson =
        this._packageJsonLookup.loadNodePackageJson(rigPackageJsonPath);
      if (rigPackageJson.dependencies && rigPackageJson.dependencies[toolPackageName]) {
        try {
          const resolvedPackageFolder: string = Import.resolvePackage({
            packageName: toolPackageName,
            baseFolderPath: path.dirname(rigPackageJsonPath)
          });
          terminal.writeVerboseLine(
            `Resolved "${toolPackageName}" as a dependency of the "${rigConfiguration.rigPackageName}" rig package.`
          );
          return resolvedPackageFolder;
        } catch (e) {
          terminal.writeWarningLine(
            `"${toolPackageName}" is listed as a dependency of the "${rigConfiguration.rigPackageName}" rig package, ` +
              'but could not be resolved. Have dependencies been installed?'
          );
          return undefined;
        }
      }
    }

    try {
      const resolvedPackageFolder: string = Import.resolvePackage({
        packageName: toolPackageName,
        baseFolderPath: heftConfiguration.buildFolder
      });
      terminal.writeVerboseLine(`Resolved "${toolPackageName}" from ${resolvedPackageFolder}.`);
      return resolvedPackageFolder;
    } catch (e) {
      // Ignore
      return undefined;
    }
  }
}
