// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import crypto from 'crypto';
import colors from 'colors/safe';
import { FileSystem, AlreadyReportedError, Import } from '@rushstack/node-core-library';

import { BaseShrinkwrapFile } from '../base/BaseShrinkwrapFile';
import { DependencySpecifier } from '../DependencySpecifier';
import {
  PackageManagerOptionsConfigurationBase,
  PnpmOptionsConfiguration
} from '../../api/RushConfiguration';
import { IShrinkwrapFilePolicyValidatorOptions } from '../policy/ShrinkwrapFilePolicy';
import { PNPM_SHRINKWRAP_YAML_FORMAT } from './PnpmYamlCommon';
import { RushConstants } from '../RushConstants';
import { IExperimentsJson } from '../../api/ExperimentsConfiguration';

const yamlModule: typeof import('js-yaml') = Import.lazy('js-yaml', require);

export interface IPeerDependenciesMetaYaml {
  optional?: boolean;
}

export interface IPnpmShrinkwrapDependencyYaml {
  /** Information about the resolved package */
  resolution: {
    /** The hash of the tarball, to ensure archive integrity */
    integrity: string;
    /** The name of the tarball, if this was from a TGX file */
    tarball?: string;
  };
  /** The list of dependencies and the resolved version */
  dependencies?: { [dependency: string]: string };
  /** The list of optional dependencies and the resolved version */
  optionalDependencies?: { [dependency: string]: string };
  /** The list of peer dependencies and the resolved version */
  peerDependencies?: { [dependency: string]: string };
  /**
   * Used to indicate optional peer dependencies, as described in this RFC:
   * https://github.com/yarnpkg/rfcs/blob/master/accepted/0000-optional-peer-dependencies.md
   */
  peerDependenciesMeta?: { [dependency: string]: IPeerDependenciesMetaYaml };
}

export interface IPnpmShrinkwrapImporterYaml {
  /** The list of resolved version numbers for direct dependencies */
  dependencies: { [dependency: string]: string };
  /** The list of resolved version numbers for dev dependencies */
  devDependencies: { [dependency: string]: string };
  /** The list of resolved version numbers for optional dependencies */
  optionalDependencies: { [dependency: string]: string };
  /** The list of specifiers used to resolve dependency versions */
  specifiers: { [dependency: string]: string };
}

/**
 * This interface represents the raw pnpm-lock.YAML file
 * Example:
 *  {
 *    "dependencies": {
 *      "@rush-temp/project1": "file:./projects/project1.tgz"
 *    },
 *    "packages": {
 *      "file:projects/library1.tgz": {
 *        "dependencies: {
 *          "markdown": "0.5.0"
 *        },
 *        "name": "@rush-temp/library1",
 *        "resolution": {
 *          "tarball": "file:projects/library1.tgz"
 *        },
 *        "version": "0.0.0"
 *      },
 *      "markdown/0.5.0": {
 *        "resolution": {
 *          "integrity": "sha1-KCBbVlqK51kt4gdGPWY33BgnIrI="
 *        }
 *      }
 *    },
 *    "registry": "http://localhost:4873/",
 *    "shrinkwrapVersion": 3,
 *    "specifiers": {
 *      "@rush-temp/project1": "file:./projects/project1.tgz"
 *    }
 *  }
 */
interface IPnpmShrinkwrapYaml {
  /** The list of resolved version numbers for direct dependencies */
  dependencies: { [dependency: string]: string };
  /** The list of importers for local workspace projects */
  importers: { [relativePath: string]: IPnpmShrinkwrapImporterYaml };
  /** The description of the solved graph */
  packages: { [dependencyVersion: string]: IPnpmShrinkwrapDependencyYaml };
  /** URL of the registry which was used */
  registry: string;
  /** The list of specifiers used to resolve direct dependency versions */
  specifiers: { [dependency: string]: string };
}

/**
 * Given an encoded "dependency key" from the PNPM shrinkwrap file, this parses it into an equivalent
 * DependencySpecifier.
 *
 * @returns a SemVer string, or undefined if the version specifier cannot be parsed
 */
export function parsePnpmDependencyKey(
  dependencyName: string,
  dependencyKey: string
): DependencySpecifier | undefined {
  if (!dependencyKey) {
    return undefined;
  }

  if (/^\w+:/.test(dependencyKey)) {
    // If it starts with an NPM scheme such as "file:projects/my-app.tgz", we don't support that
    return undefined;
  }

  // The package name parsed from the dependency key, or dependencyName if it was omitted.
  // Example: "@scope/depame"
  let parsedPackageName: string;

  // The trailing portion of the dependency key that includes the version and optional peer dependency path.
  // Example: "2.8.0/chai@3.5.0+sinon@1.17.7"
  let parsedInstallPath: string;

  // Example: "path.pkgs.visualstudio.com/@scope/depame/1.4.0"  --> 0="@scope/depame" 1="1.4.0"
  // Example: "/isarray/2.0.1"                                  --> 0="isarray"       1="2.0.1"
  // Example: "/sinon-chai/2.8.0/chai@3.5.0+sinon@1.17.7"       --> 0="sinon-chai"    1="2.8.0/chai@3.5.0+sinon@1.17.7"
  const packageNameMatch: RegExpMatchArray | null = /^[^\/]*\/((?:@[^\/]+\/)?[^\/]+)\/(.*)$/.exec(
    dependencyKey
  );
  if (packageNameMatch) {
    parsedPackageName = packageNameMatch[1];
    parsedInstallPath = packageNameMatch[2];
  } else {
    parsedPackageName = dependencyName;

    // Example: "23.6.0_babel-core@6.26.3"
    // Example: "23.6.0"
    parsedInstallPath = dependencyKey;
  }

  // The SemVer value
  // Example: "2.8.0"
  let parsedVersionPart: string;

  // Example: "23.6.0_babel-core@6.26.3" --> "23.6.0"
  // Example: "2.8.0/chai@3.5.0+sinon@1.17.7" --> "2.8.0"
  const versionMatch: RegExpMatchArray | null = /^([^\/_]+)[\/_]/.exec(parsedInstallPath);
  if (versionMatch) {
    parsedVersionPart = versionMatch[1];
  } else {
    // Example: "2.8.0"
    parsedVersionPart = parsedInstallPath;
  }

  // By this point, we expect parsedVersionPart to be a valid SemVer range
  if (!parsedVersionPart) {
    return undefined;
  }

  if (!semver.valid(parsedVersionPart)) {
    const urlRegex: RegExp = /^(@?)([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}\/([^\/\\]+\/?)*([^\/\\]+)$/i;
    // Test for urls:
    // Examples:
    //     @github.com/abc/def/188ed64efd5218beda276e02f2277bf3a6b745b2
    //     github.com/abc/def/188ed64efd5218beda276e02f2277bf3a6b745b2
    //     github.com.au/abc/def/188ed64efd5218beda276e02f2277bf3a6b745b2
    //     bitbucket.com/abc/def/188ed64efd5218beda276e02f2277bf3a6b745b2
    //     bitbucket.co.in/abc/def/188ed64efd5218beda276e02f2277bf3a6b745b2
    if (urlRegex.test(dependencyKey)) {
      const dependencySpecifier: DependencySpecifier = new DependencySpecifier(dependencyName, dependencyKey);
      return dependencySpecifier;
    } else {
      return undefined;
    }
  }

  // Is it an alias for a different package?
  if (parsedPackageName === dependencyName) {
    // No, it's a regular dependency
    return new DependencySpecifier(parsedPackageName, parsedVersionPart);
  } else {
    // If the parsed package name is different from the dependencyName, then this is an NPM package alias
    return new DependencySpecifier(dependencyName, `npm:${parsedPackageName}@${parsedVersionPart}`);
  }
}

export class PnpmShrinkwrapFile extends BaseShrinkwrapFile {
  /**
   * The filename of the shrinkwrap file.
   */
  public readonly shrinkwrapFilename: string;

  private readonly _shrinkwrapJson: IPnpmShrinkwrapYaml;

  private constructor(shrinkwrapJson: IPnpmShrinkwrapYaml, shrinkwrapFilename: string) {
    super();
    this._shrinkwrapJson = shrinkwrapJson;
    this.shrinkwrapFilename = shrinkwrapFilename;

    // Normalize the data
    if (!this._shrinkwrapJson.registry) {
      this._shrinkwrapJson.registry = '';
    }
    if (!this._shrinkwrapJson.dependencies) {
      this._shrinkwrapJson.dependencies = {};
    }
    if (!this._shrinkwrapJson.importers) {
      this._shrinkwrapJson.importers = {};
    }
    if (!this._shrinkwrapJson.specifiers) {
      this._shrinkwrapJson.specifiers = {};
    }
    if (!this._shrinkwrapJson.packages) {
      this._shrinkwrapJson.packages = {};
    }
  }

  public static loadFromFile(
    shrinkwrapYamlFilename: string,
    pnpmOptions: PnpmOptionsConfiguration
  ): PnpmShrinkwrapFile | undefined {
    try {
      if (!FileSystem.exists(shrinkwrapYamlFilename)) {
        return undefined; // file does not exist
      }

      const shrinkwrapContent: string = FileSystem.readFile(shrinkwrapYamlFilename);
      const parsedData: IPnpmShrinkwrapYaml = yamlModule.safeLoad(shrinkwrapContent);
      return new PnpmShrinkwrapFile(parsedData, shrinkwrapYamlFilename);
    } catch (error) {
      throw new Error(`Error reading "${shrinkwrapYamlFilename}":${os.EOL}  ${error.message}`);
    }
  }

  public getShrinkwrapHash(experimentsConfig?: IExperimentsJson): string {
    const shrinkwrapContent: string = this.serialize(experimentsConfig);
    return crypto.createHash('sha1').update(shrinkwrapContent).digest('hex');
  }

  /** @override */
  public validate(
    packageManagerOptionsConfig: PackageManagerOptionsConfigurationBase,
    policyOptions: IShrinkwrapFilePolicyValidatorOptions,
    experimentsConfig?: IExperimentsJson
  ): void {
    super.validate(packageManagerOptionsConfig, policyOptions);
    if (!(packageManagerOptionsConfig instanceof PnpmOptionsConfiguration)) {
      throw new Error('The provided package manager options are not valid for PNPM shrinkwrap files.');
    }

    if (!policyOptions.allowShrinkwrapUpdates) {
      if (!policyOptions.repoState.isValid) {
        console.log(
          colors.red(
            `The ${RushConstants.repoStateFilename} file is invalid. There may be a merge conflict marker ` +
              'in the file. You may need to run "rush update" to refresh its contents.'
          ) + os.EOL
        );
        throw new AlreadyReportedError();
      }

      // Only check the hash if allowShrinkwrapUpdates is false. If true, the shrinkwrap file
      // may have changed and the hash could be invalid.
      if (packageManagerOptionsConfig.preventManualShrinkwrapChanges) {
        if (!policyOptions.repoState.pnpmShrinkwrapHash) {
          console.log(
            colors.red(
              'The existing shrinkwrap file hash could not be found. You may need to run "rush update" to ' +
                'populate the hash. See the "preventManualShrinkwrapChanges" setting documentation for details.'
            ) + os.EOL
          );
          throw new AlreadyReportedError();
        }

        if (this.getShrinkwrapHash(experimentsConfig) !== policyOptions.repoState.pnpmShrinkwrapHash) {
          console.log(
            colors.red(
              'The shrinkwrap file hash does not match the expected hash. Please run "rush update" to ensure the ' +
                'shrinkwrap file is up to date. See the "preventManualShrinkwrapChanges" setting documentation for ' +
                'details.'
            ) + os.EOL
          );
          throw new AlreadyReportedError();
        }
      }
    }
  }

  /** @override */
  public getTempProjectNames(): ReadonlyArray<string> {
    return this._getTempProjectNames(this._shrinkwrapJson.dependencies);
  }

  /**
   * Gets the path to the tarball file if the package is a tarball.
   * Returns undefined if the package entry doesn't exist or the package isn't a tarball.
   * Example of return value: file:projects/build-tools.tgz
   */
  public getTarballPath(packageName: string): string | undefined {
    const dependency: IPnpmShrinkwrapDependencyYaml = this._shrinkwrapJson.packages[packageName];

    if (!dependency) {
      return undefined;
    }

    return dependency.resolution.tarball;
  }

  public getTopLevelDependencyKey(dependencyName: string): string | undefined {
    return BaseShrinkwrapFile.tryGetValue(this._shrinkwrapJson.dependencies, dependencyName);
  }

  /**
   * Gets the version number from the list of top-level dependencies in the "dependencies" section
   * of the shrinkwrap file. Sample return values:
   *   '2.1.113'
   *   '1.9.0-dev.27'
   *   'file:projects/empty-webpart-project.tgz'
   *   undefined
   *
   * @override
   */
  public getTopLevelDependencyVersion(dependencyName: string): DependencySpecifier | undefined {
    let value: string | undefined = BaseShrinkwrapFile.tryGetValue(
      this._shrinkwrapJson.dependencies,
      dependencyName
    );
    if (value) {
      // Getting the top level dependency version from a PNPM lockfile version 5.1
      // --------------------------------------------------------------------------
      //
      // 1) Top-level tarball dependency entries in pnpm-lock.yaml look like:
      //    '@rush-temp/sp-filepicker': 'file:projects/sp-filepicker.tgz_0ec79d3b08edd81ebf49cd19ca50b3f5'

      //    Then, it would be defined below:
      //    'file:projects/sp-filepicker.tgz_0ec79d3b08edd81ebf49cd19ca50b3f5':
      //      dependencies:
      //       '@microsoft/load-themed-styles': 1.10.7
      //       ...
      //      resolution:
      //       integrity: sha512-guuoFIc**==
      //       tarball: 'file:projects/sp-filepicker.tgz'

      //    Here, we are interested in the part 'file:projects/sp-filepicker.tgz'. Splitting by underscores is not the
      //    best way to get this because file names could have underscores in them. Instead, we could use the tarball
      //    field in the resolution section.

      // 2) Top-level non-tarball dependency entries in pnpm-lock.yaml would look like:
      //    '@rushstack/set-webpack-public-path-plugin': 2.1.133
      //    @microsoft/sp-build-node': 1.9.0-dev.27_typescript@2.9.2

      //    Here, we could just split by underscores and take the first part.

      // The below code is also compatible with lockfile versions < 5.1

      const dependency: IPnpmShrinkwrapDependencyYaml = this._shrinkwrapJson.packages[value];

      if (
        dependency &&
        dependency.resolution &&
        dependency.resolution.tarball &&
        value.startsWith(dependency.resolution.tarball)
      ) {
        return new DependencySpecifier(dependencyName, dependency.resolution.tarball);
      } else {
        const underscoreIndex: number = value.indexOf('_');
        if (underscoreIndex >= 0) {
          value = value.substr(0, underscoreIndex);
        }
      }

      return new DependencySpecifier(dependencyName, value);
    }
    return undefined;
  }

  /**
   * The PNPM shrinkwrap file has top-level dependencies on the temp projects like this:
   *
   * ```
   * dependencies:
   *   '@rush-temp/my-app': 'file:projects/my-app.tgz_25c559a5921686293a001a397be4dce0'
   * packages:
   *   /@types/node/10.14.15:
   *     dev: false
   *   'file:projects/my-app.tgz_25c559a5921686293a001a397be4dce0':
   *     dev: false
   *     name: '@rush-temp/my-app'
   *     version: 0.0.0
   * ```
   *
   * We refer to 'file:projects/my-app.tgz_25c559a5921686293a001a397be4dce0' as the temp project dependency key
   * of the temp project '@rush-temp/my-app'.
   */
  public getTempProjectDependencyKey(tempProjectName: string): string | undefined {
    const tempProjectDependencyKey: string | undefined = BaseShrinkwrapFile.tryGetValue(
      this._shrinkwrapJson.dependencies,
      tempProjectName
    );

    if (tempProjectDependencyKey) {
      return tempProjectDependencyKey;
    }

    return undefined;
  }

  public getShrinkwrapEntryFromTempProjectDependencyKey(
    tempProjectDependencyKey: string
  ): IPnpmShrinkwrapDependencyYaml | undefined {
    return this._shrinkwrapJson.packages[tempProjectDependencyKey];
  }

  public getShrinkwrapEntry(name: string, version: string): IPnpmShrinkwrapDependencyYaml | undefined {
    // Version can sometimes be in the form of a path that's already in the /name/version format.
    const packageId: string = version.indexOf('/') !== -1 ? version : `/${name}/${version}`;
    return this._shrinkwrapJson.packages[packageId];
  }

  /**
   * Serializes the PNPM Shrinkwrap file
   *
   * @override
   */
  protected serialize(experiments?: IExperimentsJson): string {
    // Ensure that if any of the top-level properties are provided but empty are removed. We populate the object
    // properties when we read the shrinkwrap but PNPM does not set these top-level properties unless they are present.
    const shrinkwrapToSerialize: { [key: string]: unknown } = {};
    const { omitImportersFromPreventManualShrinkwrapChanges } = experiments || {};
    for (const [key, value] of Object.entries(this._shrinkwrapJson)) {
      // The 'omitImportersFromPreventManualShrinkwrapChanges' experiment skips the 'importers' section
      // when computing the hash, since the main concern is changes to the overall external dependency footprint
      if (omitImportersFromPreventManualShrinkwrapChanges && key === 'importers') {
        continue;
      }

      if (!value || typeof value !== 'object' || Object.keys(value).length > 0) {
        shrinkwrapToSerialize[key] = value;
      }
    }

    return yamlModule.safeDump(shrinkwrapToSerialize, PNPM_SHRINKWRAP_YAML_FORMAT);
  }

  /**
   * Gets the resolved version number of a dependency for a specific temp project.
   * For PNPM, we can reuse the version that another project is using.
   * Note that this function modifies the shrinkwrap data if tryReusingPackageVersionsFromShrinkwrap is set to true.
   *
   * @override
   */
  protected tryEnsureDependencyVersion(
    dependencySpecifier: DependencySpecifier,
    tempProjectName: string,
    tryReusingPackageVersionsFromShrinkwrap: boolean
  ): DependencySpecifier | undefined {
    // PNPM doesn't have the same advantage of NPM, where we can skip generate as long as the
    // shrinkwrap file puts our dependency in either the top of the node_modules folder
    // or underneath the package we are looking at.
    // This is because the PNPM shrinkwrap file describes the exact links that need to be created
    // to recreate the graph..
    // Because of this, we actually need to check for a version that this package is directly
    // linked to.

    const packageName: string = dependencySpecifier.packageName;

    const tempProjectDependencyKey: string | undefined = this.getTempProjectDependencyKey(tempProjectName);
    if (!tempProjectDependencyKey) {
      return undefined;
    }

    const packageDescription: IPnpmShrinkwrapDependencyYaml | undefined = this._getPackageDescription(
      tempProjectDependencyKey
    );
    if (!packageDescription || !packageDescription.dependencies) {
      return undefined;
    }

    if (!packageDescription.dependencies.hasOwnProperty(packageName)) {
      if (tryReusingPackageVersionsFromShrinkwrap && dependencySpecifier.versionSpecifier) {
        // this means the current temp project doesn't provide this dependency,
        // however, we may be able to use a different version. we prefer the latest version
        let latestVersion: string | undefined = undefined;
        let usedOtherTempProject: string | undefined = undefined;

        for (const otherTempProject of this.getTempProjectNames()) {
          const otherVersionSpecifier: DependencySpecifier | undefined = this._getDependencySpecifier(
            dependencySpecifier.packageName,
            otherTempProject
          );

          if (otherVersionSpecifier) {
            const otherVersion: string = otherVersionSpecifier.versionSpecifier;

            if (semver.satisfies(otherVersion, dependencySpecifier.versionSpecifier)) {
              if (!latestVersion || semver.gt(otherVersion, latestVersion)) {
                latestVersion = otherVersion;
                usedOtherTempProject = otherTempProject;
              }
            }
          }
        }

        if (latestVersion && usedOtherTempProject) {
          // go ahead and fixup the shrinkwrap file to point at this
          const dependencies: { [key: string]: string } | undefined =
            this._shrinkwrapJson.packages[tempProjectDependencyKey].dependencies || {};

          // _getDependencySpecifier should ensure the existence of the dependencyVersion
          const dependencyVersion: string = this._getDependencyVersion(packageName, usedOtherTempProject)!;
          dependencies[packageName] = dependencyVersion;
          this._shrinkwrapJson.packages[tempProjectDependencyKey].dependencies = dependencies;

          return new DependencySpecifier(dependencySpecifier.packageName, latestVersion);
        }
      }

      return undefined;
    }

    const dependencyKey: string = packageDescription.dependencies[packageName];
    return this._parsePnpmDependencyKey(packageName, dependencyKey);
  }

  /** @override */
  public getWorkspaceKeys(): ReadonlyArray<string> {
    const result: string[] = [];
    for (const key of Object.keys(this._shrinkwrapJson.importers)) {
      // Avoid including the common workspace
      if (key !== '.') {
        result.push(key);
      }
    }
    result.sort(); // make the result deterministic
    return result;
  }

  /** @override */
  public getWorkspaceKeyByPath(workspaceRoot: string, projectFolder: string): string {
    return path.relative(workspaceRoot, projectFolder).replace(new RegExp(`\\${path.sep}`, 'g'), '/');
  }

  public getWorkspaceImporter(importerPath: string): IPnpmShrinkwrapImporterYaml | undefined {
    return BaseShrinkwrapFile.tryGetValue(this._shrinkwrapJson.importers, importerPath);
  }

  /**
   * Gets the resolved version number of a dependency for a specific temp project.
   * For PNPM, we can reuse the version that another project is using.
   * Note that this function modifies the shrinkwrap data.
   *
   * @override
   */
  protected getWorkspaceDependencyVersion(
    dependencySpecifier: DependencySpecifier,
    workspaceKey: string
  ): DependencySpecifier | undefined {
    // PNPM doesn't have the same advantage of NPM, where we can skip generate as long as the
    // shrinkwrap file puts our dependency in either the top of the node_modules folder
    // or underneath the package we are looking at.
    // This is because the PNPM shrinkwrap file describes the exact links that need to be created
    // to recreate the graph..
    // Because of this, we actually need to check for a version that this package is directly
    // linked to.

    const packageName: string = dependencySpecifier.packageName;
    const projectImporter: IPnpmShrinkwrapImporterYaml | undefined = this.getWorkspaceImporter(workspaceKey);
    if (!projectImporter) {
      return undefined;
    }

    const allDependencies: { [dependency: string]: string } = {
      ...(projectImporter.optionalDependencies || {}),
      ...(projectImporter.dependencies || {}),
      ...(projectImporter.devDependencies || {})
    };
    if (!allDependencies.hasOwnProperty(packageName)) {
      return undefined;
    }

    const dependencyKey: string = allDependencies[packageName];
    return this._parsePnpmDependencyKey(packageName, dependencyKey);
  }

  /**
   * Returns the version of a dependency being used by a given project
   */
  private _getDependencyVersion(dependencyName: string, tempProjectName: string): string | undefined {
    const tempProjectDependencyKey: string | undefined = this.getTempProjectDependencyKey(tempProjectName);
    if (!tempProjectDependencyKey) {
      throw new Error(`Cannot get dependency key for temp project: ${tempProjectName}`);
    }

    const packageDescription: IPnpmShrinkwrapDependencyYaml | undefined = this._getPackageDescription(
      tempProjectDependencyKey
    );
    if (!packageDescription || !packageDescription.dependencies) {
      return undefined;
    }

    if (!packageDescription.dependencies.hasOwnProperty(dependencyName)) {
      return undefined;
    }

    return packageDescription.dependencies[dependencyName];
  }

  /**
   * Returns the dependency specifier of a dependency being used by a given project
   */
  private _getDependencySpecifier(
    dependencyName: string,
    tempProjectName: string
  ): DependencySpecifier | undefined {
    const dependencyVersion: string | undefined = this._getDependencyVersion(dependencyName, tempProjectName);

    if (!dependencyVersion) {
      return undefined;
    }

    return this._parsePnpmDependencyKey(dependencyName, dependencyVersion);
  }

  /**
   * Gets the package description for a tempProject from the shrinkwrap file.
   */
  private _getPackageDescription(
    tempProjectDependencyKey: string
  ): IPnpmShrinkwrapDependencyYaml | undefined {
    const packageDescription: IPnpmShrinkwrapDependencyYaml | undefined = BaseShrinkwrapFile.tryGetValue(
      this._shrinkwrapJson.packages,
      tempProjectDependencyKey
    );

    if (!packageDescription || !packageDescription.dependencies) {
      return undefined;
    }

    return packageDescription;
  }

  private _parsePnpmDependencyKey(
    dependencyName: string,
    pnpmDependencyKey: string
  ): DependencySpecifier | undefined {
    if (pnpmDependencyKey) {
      const result: DependencySpecifier | undefined = parsePnpmDependencyKey(
        dependencyName,
        pnpmDependencyKey
      );

      if (!result) {
        throw new Error(
          `Cannot parse PNPM shrinkwrap version specifier: "${pnpmDependencyKey}"` +
            ` for "${dependencyName}"`
        );
      }

      return result;
    } else {
      return undefined;
    }
  }
}
