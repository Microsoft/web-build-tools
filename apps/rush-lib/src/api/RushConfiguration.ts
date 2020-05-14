// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/* eslint max-lines: off */

import * as path from 'path';
import * as fs from 'fs';
import * as semver from 'semver';
import {
  JsonFile,
  JsonSchema,
  Path,
  PackageName,
  FileSystem
} from '@rushstack/node-core-library';
import { trueCasePathSync } from 'true-case-path';

import { Rush } from '../api/Rush';
import { RushConfigurationProject, IRushConfigurationProjectJson } from './RushConfigurationProject';
import { RushConstants } from '../logic/RushConstants';
import { ApprovedPackagesPolicy } from './ApprovedPackagesPolicy';
import { EventHooks } from './EventHooks';
import { VersionPolicyConfiguration } from './VersionPolicyConfiguration';
import { EnvironmentConfiguration } from './EnvironmentConfiguration';
import { CommonVersionsConfiguration } from './CommonVersionsConfiguration';
import { Utilities } from '../utilities/Utilities';
import { PackageManagerName, PackageManager } from './packageManager/PackageManager';
import { NpmPackageManager } from './packageManager/NpmPackageManager';
import { YarnPackageManager } from './packageManager/YarnPackageManager';
import { PnpmPackageManager } from './packageManager/PnpmPackageManager';
import { ExperimentsConfiguration } from './ExperimentsConfiguration';
import { RushCiMode } from '../logic/RushCiMode';

const MINIMUM_SUPPORTED_RUSH_JSON_VERSION: string = '0.0.0';
const DEFAULT_BRANCH: string = 'master';
const DEFAULT_REMOTE: string = 'origin';

/**
 * A list of known config filenames that are expected to appear in the "./common/config/rush" folder.
 * To avoid confusion/mistakes, any extra files will be reported as an error.
 */
const knownRushConfigFilenames: string[] = [
  '.npmrc',
  '.npmrc-publish',
  RushConstants.pinnedVersionsFilename,
  RushConstants.commonVersionsFilename,
  RushConstants.browserApprovedPackagesFilename,
  RushConstants.nonbrowserApprovedPackagesFilename,
  RushConstants.versionPoliciesFilename,
  RushConstants.commandLineFilename,
  RushConstants.experimentsFilename
];

/**
 * Part of IRushConfigurationJson.
 */
export interface IApprovedPackagesPolicyJson {
  reviewCategories?: string[];
  ignoredNpmScopes?: string[];
}

/**
 * Part of IRushConfigurationJson.
 */
export interface IRushGitPolicyJson {
  allowedEmailRegExps?: string[];
  sampleEmail?: string;
  versionBumpCommitMessage?: string;
}

/**
 * Part of IRushConfigurationJson.
 * @beta
 */
export interface IEventHooksJson {
  /**
   * The list of scripts to run after every Rush build command finishes
   */
  postRushBuild?: string[];
}

/**
 * Part of IRushConfigurationJson.
 */
export interface IRushRepositoryJson {
  /**
   * The remote url of the repository. This helps "rush change" find the right remote to compare against.
   */
  url?: string;

  /**
   * The default branch name. This tells "rush change" which remote branch to compare against.
   */
  defaultBranch?: string;

  /**
   * The default remote. This tells "rush change" which remote to compare against if the remote URL is not set
   * or if a remote matching the provided remote URL is not found.
   */
  defaultRemote?: string;
}

/**
 * This represents the available PNPM store options
 * @public
 */
export type PnpmStoreOptions = 'local' | 'global';

/**
 * Options for the package manager.
 * @public
 */
export interface IPackageManagerOptionsJsonBase {
  /**
   * Environment variables for the package manager
   */
  environmentVariables?: IConfigurationEnvironment
}

/**
 * A collection of environment variables
 * @public
 */
export interface IConfigurationEnvironment {
  /**
   * Environment variables
   */
  [environmentVariableName: string]: IConfigurationEnvironmentVariable;
}

/**
 * Represents the value of an environment variable, and if the value should be overridden if the variable is set
 * in the parent environment.
 * @public
 */
export interface IConfigurationEnvironmentVariable {
  /**
   * Value of the environment variable
   */
  value: string;

  /**
   * Set to true to override the environment variable even if it is set in the parent environment.
   * The default value is false.
   */
  override?: boolean;
}

/**
 * Part of IRushConfigurationJson.
 * @internal
 */
export interface INpmOptionsJson extends IPackageManagerOptionsJsonBase {
}

/**
 * Part of IRushConfigurationJson.
 * @internal
 */
export interface IPnpmOptionsJson extends IPackageManagerOptionsJsonBase {
  /**
   * The store resolution method for PNPM to use
   */
  pnpmStore?: PnpmStoreOptions;
  /**
   * Should PNPM fail if peer dependencies aren't installed?
   */
  strictPeerDependencies?: boolean;
  /**
   * Defines the dependency resolution strategy PNPM will use
   */
  resolutionStrategy?: ResolutionStrategy;
  /**
   * {@inheritDoc PnpmOptionsConfiguration.preventManualShrinkwrapChanges}
   */
  preventManualShrinkwrapChanges?: boolean;
}

/**
 * Part of IRushConfigurationJson.
 * @internal
 */
export interface IYarnOptionsJson extends IPackageManagerOptionsJsonBase {
  /**
   * If true, then Rush will add the "--ignore-engines" option when invoking Yarn.
   * This allows "rush install" to succeed if there are dependencies with engines defined in
   * package.json which do not match the current environment.
   *
   * The default value is false.
   */
  ignoreEngines?: boolean;
}

/**
 * Options defining an allowed variant as part of IRushConfigurationJson.
 */
export interface IRushVariantOptionsJson {
  variantName: string;
  description: string;
}

/**
 * This represents the JSON data structure for the "rush.json" configuration file.
 * See rush.schema.json for documentation.
 */
export interface IRushConfigurationJson {
  $schema: string;
  rushCiModeOverride?: string;
  npmVersion?: string;
  pnpmVersion?: string;
  yarnVersion?: string;
  rushVersion: string;
  repository?: IRushRepositoryJson;
  nodeSupportedVersionRange?: string;
  suppressNodeLtsWarning?: boolean;
  projectFolderMinDepth?: number;
  projectFolderMaxDepth?: number;
  approvedPackagesPolicy?: IApprovedPackagesPolicyJson;
  gitPolicy?: IRushGitPolicyJson;
  telemetryEnabled?: boolean;
  projects: IRushConfigurationProjectJson[];
  eventHooks?: IEventHooksJson;
  hotfixChangeEnabled?: boolean;
  npmOptions?: INpmOptionsJson;
  pnpmOptions?: IPnpmOptionsJson;
  yarnOptions?: IYarnOptionsJson;
  ensureConsistentVersions?: boolean;
  variants?: IRushVariantOptionsJson[];
}

/**
 * This represents the JSON data structure for the "rush-link.json" data file.
 */
export interface IRushLinkJson {
  localLinks: {
    [name: string]: string[]
  };
}

/**
 * This represents the JSON data structure for the "current-variant.json" data file.
 */
export interface ICurrentVariantJson {
  variant: string | null; // Use `null` instead of `undefined` because `undefined` is not handled by JSON.
}

/**
 * Options that all package managers share.
 *
 * @public
 */
export abstract class PackageManagerOptionsConfigurationBase implements IPackageManagerOptionsJsonBase {
  /**
   * Environment variables for the package manager
   */
  public readonly environmentVariables?: IConfigurationEnvironment

  /** @internal */
  protected constructor(json: IPackageManagerOptionsJsonBase) {
    this.environmentVariables = json.environmentVariables;
  }
}

/**
 * Options that are only used when the NPM package manager is selected.
 *
 * @remarks
 * It is valid to define these options in rush.json even if the NPM package manager
 * is not being used.
 *
 * @public
 */
export class NpmOptionsConfiguration extends PackageManagerOptionsConfigurationBase {
  /** @internal */
  public constructor(json: INpmOptionsJson) {
    super(json);
  }
}

/**
 * Options that are only used when the PNPM package manager is selected.
 *
 * @remarks
 * It is valid to define these options in rush.json even if the PNPM package manager
 * is not being used.
 *
 * @public
 */
export class PnpmOptionsConfiguration extends PackageManagerOptionsConfigurationBase {
  /**
   * The method used to resolve the store used by PNPM.
   *
   * @remarks
   * Available options:
   *  - local: Use the standard Rush store path: common/temp/pnpm-store
   *  - global: Use PNPM's global store path
   */
  public readonly pnpmStore: PnpmStoreOptions;

  /**
   * The path for PNPM to use as the store directory.
   *
   * Will be overridden by environment variable RUSH_PNPM_STORE_PATH
   */
  public readonly pnpmStorePath: string;

  /**
   * If true, then Rush will add the "--strict-peer-dependencies" option when invoking PNPM.
   *
   * @remarks
   * This causes "rush install" to fail if there are unsatisfied peer dependencies, which is
   * an invalid state that can cause build failures or incompatible dependency versions.
   * (For historical reasons, JavaScript package managers generally do not treat this invalid state
   * as an error.)
   *
   * The default value is false.  (For now.)
   */
  public readonly strictPeerDependencies: boolean;

  /**
   * The resolution strategy that will be used by PNPM.
   *
   * @remarks
   * Configures the strategy used to select versions during installation.
   *
   * This feature requires PNPM version 3.1 or newer.  It corresponds to the `--resolution-strategy` command-line
   * option for PNPM.  Possible values are `"fast"` and `"fewer-dependencies"`.  PNPM's default is `"fast"`, but this
   * may be incompatible with certain packages, for example the `@types` packages from DefinitelyTyped.  Rush's default
   * is `"fewer-dependencies"`, which causes PNPM to avoid installing a newer version if an already installed version
   * can be reused; this is more similar to NPM's algorithm.
   *
   * For more background, see this discussion: {@link https://github.com/pnpm/pnpm/issues/1187}
   */
  public readonly resolutionStrategy: ResolutionStrategy;

  /**
   * If true, then `rush install` will report an error if manual modifications
   * were made to the PNPM shrinkwrap file without running `rush update` afterwards.
   *
   * @remarks
   * This feature protects against accidental inconsistencies that may be introduced
   * if the PNPM shrinkwrap file (`pnpm-lock.yaml`) is manually edited.  When this
   * feature is enabled, `rush update` will append a hash to the file as a YAML comment,
   * and then `rush update` and `rush install` will validate the hash.  Note that this does not prohibit
   * manual modifications, but merely requires `rush update` be run
   * afterwards, ensuring that PNPM can report or repair any potential inconsistencies.
   *
   * To temporarily disable this validation when invoking `rush install`, use the
   * `--bypass-policy` command-line parameter.
   *
   * The default value is false.
   */
  public readonly preventManualShrinkwrapChanges: boolean;

  /** @internal */
  public constructor(json: IPnpmOptionsJson, commonTempFolder: string) {
    super(json);
    this.pnpmStore = json.pnpmStore || 'local';
    if (EnvironmentConfiguration.pnpmStorePathOverride) {
      this.pnpmStorePath = EnvironmentConfiguration.pnpmStorePathOverride;
    } else if (this.pnpmStore === 'global') {
      this.pnpmStorePath = '';
    } else {
      this.pnpmStorePath = path.resolve(path.join(commonTempFolder, 'pnpm-store'));
    }
    this.strictPeerDependencies = !!json.strictPeerDependencies;
    this.resolutionStrategy = json.resolutionStrategy || 'fewer-dependencies';
    this.preventManualShrinkwrapChanges = !!json.preventManualShrinkwrapChanges
  }
}

/**
 * Options that are only used when the yarn package manager is selected.
 *
 * @remarks
 * It is valid to define these options in rush.json even if the yarn package manager
 * is not being used.
 *
 * @public
 */
export class YarnOptionsConfiguration extends PackageManagerOptionsConfigurationBase {
  /**
   * If true, then Rush will add the "--ignore-engines" option when invoking Yarn.
   * This allows "rush install" to succeed if there are dependencies with engines defined in
   * package.json which do not match the current environment.
   *
   * The default value is false.
   */
  public readonly ignoreEngines: boolean;

  /** @internal */
  public constructor(json: IYarnOptionsJson) {
    super(json);
    this.ignoreEngines = !!json.ignoreEngines;
  }
}

/**
 * Options for `RushConfiguration.tryFindRushJsonLocation`.
 * @public
 */
export interface ITryFindRushJsonLocationOptions {
  /**
   * Whether to show verbose console messages.  Defaults to false.
   */
  showVerbose?: boolean;    // Defaults to false (inverse of old `verbose` parameter)

  /**
   * The folder path where the search will start.  Defaults tot he current working directory.
   */
  startingFolder?: string;  // Defaults to cwd
}

/**
 * This represents the available PNPM resolution strategies as a string
 * @public
 */
export type ResolutionStrategy = 'fewer-dependencies' | 'fast';

/**
 * This represents the Rush configuration for a repository, based on the "rush.json"
 * configuration file.
 * @public
 */
export class RushConfiguration {
  private static _jsonSchema: JsonSchema = JsonSchema.fromFile(path.join(__dirname, '../schemas/rush.schema.json'));

  private _rushJsonFile: string;
  private _rushJsonFolder: string;
  private _changesFolder: string;
  private _commonFolder: string;
  private _commonTempFolder: string;
  private _commonScriptsFolder: string;
  private _commonRushConfigFolder: string;
  private _isCI: boolean;
  private _packageManager: PackageManagerName;
  private _packageManagerWrapper: PackageManager;
  private _npmCacheFolder: string;
  private _npmTmpFolder: string;
  private _yarnCacheFolder: string;
  private _shrinkwrapFilename: string;
  private _tempShrinkwrapFilename: string;
  private _tempShrinkwrapPreinstallFilename: string;
  private _rushLinkJsonFilename: string;
  private _currentVariantJsonFilename: string;
  private _packageManagerToolVersion: string;
  private _packageManagerToolFilename: string;
  private _projectFolderMinDepth: number;
  private _projectFolderMaxDepth: number;
  private _ensureConsistentVersions: boolean;
  private _suppressNodeLtsWarning: boolean;
  private _variants: {
    [variantName: string]: boolean;
  };

  // "approvedPackagesPolicy" feature
  private _approvedPackagesPolicy: ApprovedPackagesPolicy;

  // "gitPolicy" feature
  private _gitAllowedEmailRegExps: string[];
  private _gitSampleEmail: string;
  private _gitVersionBumpCommitMessage: string | undefined;

  // "hotfixChangeEnabled" feature
  private _hotfixChangeEnabled: boolean;

  // Repository info
  private _repositoryUrl: string | undefined;
  private _repositoryDefaultBranch: string;
  private _repositoryDefaultRemote: string;

  private _npmOptions: NpmOptionsConfiguration;
  private _pnpmOptions: PnpmOptionsConfiguration;
  private _yarnOptions: YarnOptionsConfiguration;
  private _packageManagerConfigurationOptions: PackageManagerOptionsConfigurationBase;

  // Rush hooks
  private _eventHooks: EventHooks;

  private _telemetryEnabled: boolean;

  private _projects: RushConfigurationProject[];
  private _projectsByName: Map<string, RushConfigurationProject>;

  private _versionPolicyConfiguration: VersionPolicyConfiguration;
  private _experimentsConfiguration: ExperimentsConfiguration;

  /**
   * Use RushConfiguration.loadFromConfigurationFile() or Use RushConfiguration.loadFromDefaultLocation()
   * instead.
   */
  private constructor(rushConfigurationJson: IRushConfigurationJson, rushJsonFilename: string) {
    EnvironmentConfiguration.initialize();

    if (rushConfigurationJson.nodeSupportedVersionRange) {
      if (!semver.validRange(rushConfigurationJson.nodeSupportedVersionRange)) {
        throw new Error('Error parsing the node-semver expression in the "nodeSupportedVersionRange"'
          + ` field from rush.json: "${rushConfigurationJson.nodeSupportedVersionRange}"`);
      }
      if (!semver.satisfies(process.version, rushConfigurationJson.nodeSupportedVersionRange)) {
        const message: string = `Your dev environment is running Node.js version ${process.version} which does`
          + ` not meet the requirements for building this repository.  (The rush.json configuration`
          + ` requires nodeSupportedVersionRange="${rushConfigurationJson.nodeSupportedVersionRange}")`;
        if (EnvironmentConfiguration.allowUnsupportedNodeVersion) {
          console.warn(message);
        } else {
          throw new Error(message);
        }
      }
    }

    this._rushJsonFile = rushJsonFilename;
    this._rushJsonFolder = path.dirname(rushJsonFilename);

    this._commonFolder = path.resolve(path.join(this._rushJsonFolder, RushConstants.commonFolderName));

    this._commonRushConfigFolder = path.join(this._commonFolder, 'config', 'rush');

    this._commonTempFolder = EnvironmentConfiguration.rushTempFolderOverride ||
      path.join(this._commonFolder, RushConstants.rushTempFolderName);

    this._commonScriptsFolder = path.join(this._commonFolder, 'scripts');

    this._npmCacheFolder = path.resolve(path.join(this._commonTempFolder, 'npm-cache'));
    this._npmTmpFolder = path.resolve(path.join(this._commonTempFolder, 'npm-tmp'));
    this._yarnCacheFolder = path.resolve(path.join(this._commonTempFolder, 'yarn-cache'));

    this._changesFolder = path.join(this._commonFolder, RushConstants.changeFilesFolderName);

    this._rushLinkJsonFilename = path.join(this._commonTempFolder, 'rush-link.json');
    this._currentVariantJsonFilename = path.join(this._commonTempFolder, 'current-variant.json');

    this._suppressNodeLtsWarning = !!rushConfigurationJson.suppressNodeLtsWarning;

    this._ensureConsistentVersions = !!rushConfigurationJson.ensureConsistentVersions;

    const experimentsConfigFile: string = path.join(
      this._commonRushConfigFolder,
      RushConstants.experimentsFilename
    );
    this._experimentsConfiguration = new ExperimentsConfiguration(experimentsConfigFile);

    this._npmOptions = new NpmOptionsConfiguration(rushConfigurationJson.npmOptions || {});
    this._pnpmOptions = new PnpmOptionsConfiguration(rushConfigurationJson.pnpmOptions || {},
      this._commonTempFolder);
    this._yarnOptions = new YarnOptionsConfiguration(rushConfigurationJson.yarnOptions || {});

    // TODO: Add an actual "packageManager" field in rush.json
    const packageManagerFields: string[] = [];

    if (rushConfigurationJson.npmVersion) {
      this._packageManager = 'npm';
      this._packageManagerConfigurationOptions = this._npmOptions;
      packageManagerFields.push('npmVersion');
    }
    if (rushConfigurationJson.pnpmVersion) {
      this._packageManager = 'pnpm';
      this._packageManagerConfigurationOptions = this._pnpmOptions;
      packageManagerFields.push('pnpmVersion');
    }
    if (rushConfigurationJson.yarnVersion) {
      this._packageManager = 'yarn';
      this._packageManagerConfigurationOptions = this._yarnOptions;
      packageManagerFields.push('yarnVersion');
    }

    if (packageManagerFields.length === 0) {
      throw new Error(`The rush.json configuration must specify one of: npmVersion, pnpmVersion, or yarnVersion`);
    }

    if (packageManagerFields.length > 1) {
      throw new Error(`The rush.json configuration cannot specify both ${packageManagerFields[0]}`
        + ` and ${packageManagerFields[1]} `);
    }

    if (this._packageManager === 'npm') {
      this._packageManagerToolVersion = rushConfigurationJson.npmVersion!;
      this._packageManagerWrapper = new NpmPackageManager(this._packageManagerToolVersion);
    } else if (this._packageManager === 'pnpm') {
      this._packageManagerToolVersion = rushConfigurationJson.pnpmVersion!;
      this._packageManagerWrapper = new PnpmPackageManager(this._packageManagerToolVersion);
    } else {
      this._packageManagerToolVersion = rushConfigurationJson.yarnVersion!;
      this._packageManagerWrapper = new YarnPackageManager(this._packageManagerToolVersion);
    }

    this._shrinkwrapFilename = this._packageManagerWrapper.shrinkwrapFilename;

    this._tempShrinkwrapFilename = path.join(
      this._commonTempFolder, this._shrinkwrapFilename
    );
    this._packageManagerToolFilename = path.resolve(path.join(
      this._commonTempFolder, `${this.packageManager}-local`, 'node_modules', '.bin', `${this.packageManager}`
    ));

    /// From "C:\repo\common\temp\pnpm-lock.yaml" --> "C:\repo\common\temp\pnpm-lock-preinstall.yaml"
    const parsedPath: path.ParsedPath = path.parse(this._tempShrinkwrapFilename);
    this._tempShrinkwrapPreinstallFilename = path.join(parsedPath.dir,
      parsedPath.name + '-preinstall' + parsedPath.ext);

    RushConfiguration._validateCommonRushConfigFolder(
      this._commonRushConfigFolder,
      this.packageManager,
      this._shrinkwrapFilename
    );

    this._projectFolderMinDepth = rushConfigurationJson.projectFolderMinDepth !== undefined
      ? rushConfigurationJson.projectFolderMinDepth : 1;
    if (this._projectFolderMinDepth < 1) {
      throw new Error('Invalid projectFolderMinDepth; the minimum possible value is 1');
    }

    this._projectFolderMaxDepth = rushConfigurationJson.projectFolderMaxDepth !== undefined
      ? rushConfigurationJson.projectFolderMaxDepth : 2;
    if (this._projectFolderMaxDepth < this._projectFolderMinDepth) {
      throw new Error('The projectFolderMaxDepth cannot be smaller than the projectFolderMinDepth');
    }

    this._approvedPackagesPolicy = new ApprovedPackagesPolicy(this, rushConfigurationJson);

    this._isCI = new RushCiMode(EnvironmentConfiguration.ciModeOverride, rushConfigurationJson.rushCiModeOverride).isCI;

    this._gitAllowedEmailRegExps = [];
    this._gitSampleEmail = '';
    if (rushConfigurationJson.gitPolicy) {
      if (rushConfigurationJson.gitPolicy.sampleEmail) {
        this._gitSampleEmail = rushConfigurationJson.gitPolicy.sampleEmail;
      }

      if (rushConfigurationJson.gitPolicy.allowedEmailRegExps) {
        this._gitAllowedEmailRegExps = rushConfigurationJson.gitPolicy.allowedEmailRegExps;

        if (this._gitSampleEmail.trim().length < 1) {
          throw new Error('The rush.json file is missing the "sampleEmail" option, ' +
            'which is required when using "allowedEmailRegExps"');
        }
      }

      if (rushConfigurationJson.gitPolicy.versionBumpCommitMessage) {
        this._gitVersionBumpCommitMessage = rushConfigurationJson.gitPolicy.versionBumpCommitMessage;
      }
    }

    this._hotfixChangeEnabled = false;
    if (rushConfigurationJson.hotfixChangeEnabled) {
      this._hotfixChangeEnabled = rushConfigurationJson.hotfixChangeEnabled;
    }


    if (!rushConfigurationJson.repository) {
      rushConfigurationJson.repository = {};
    }

    this._repositoryUrl = rushConfigurationJson.repository.url;
    this._repositoryDefaultBranch = rushConfigurationJson.repository.defaultBranch || DEFAULT_BRANCH;
    this._repositoryDefaultRemote = rushConfigurationJson.repository.defaultRemote || DEFAULT_REMOTE;

    this._telemetryEnabled = !!rushConfigurationJson.telemetryEnabled;
    if (rushConfigurationJson.eventHooks) {
      this._eventHooks = new EventHooks(rushConfigurationJson.eventHooks);
    }

    const versionPolicyConfigFile: string = path.join(
      this._commonRushConfigFolder,
      RushConstants.versionPoliciesFilename
    );
    this._versionPolicyConfiguration = new VersionPolicyConfiguration(versionPolicyConfigFile);

    this._projects = [];
    this._projectsByName = new Map<string, RushConfigurationProject>();

    // We sort the projects array in alphabetical order.  This ensures that the packages
    // are processed in a deterministic order by the various Rush algorithms.
    const sortedProjectJsons: IRushConfigurationProjectJson[] = rushConfigurationJson.projects.slice(0);
    sortedProjectJsons.sort(
      (a: IRushConfigurationProjectJson, b: IRushConfigurationProjectJson) => a.packageName.localeCompare(b.packageName)
    );

    const tempNamesByProject: Map<IRushConfigurationProjectJson, string>
      = RushConfiguration._generateTempNamesForProjects(sortedProjectJsons);

    for (const projectJson of sortedProjectJsons) {
      const tempProjectName: string | undefined = tempNamesByProject.get(projectJson);
      if (tempProjectName) {
        const project: RushConfigurationProject = new RushConfigurationProject(projectJson, this, tempProjectName);
        this._projects.push(project);
        if (this._projectsByName.get(project.packageName)) {
          throw new Error(`The project name "${project.packageName}" was specified more than once`
            + ` in the rush.json configuration file.`);
        }
        this._projectsByName.set(project.packageName, project);
      }
    }

    for (const project of this._projects) {
      project.cyclicDependencyProjects.forEach((cyclicDependencyProject: string) => {
        if (!this.getProjectByName(cyclicDependencyProject)) {
          throw new Error(`In rush.json, the "${cyclicDependencyProject}" project does not exist,`
            + ` but was referenced by the cyclicDependencyProjects for ${project.packageName}`);
        }
      });

      // Compute the downstream dependencies within the list of Rush projects.
      this._populateDownstreamDependencies(project.packageJson.dependencies, project.packageName);
      this._populateDownstreamDependencies(project.packageJson.devDependencies, project.packageName);
      this._versionPolicyConfiguration.validate(this._projectsByName);
    }

    const variants: {
      [variantName: string]: boolean;
    } = {};

    if (rushConfigurationJson.variants) {
      for (const variantOptions of rushConfigurationJson.variants) {
        const {
          variantName
        } = variantOptions;

        if (variants[variantName]) {
          throw new Error(`Duplicate variant named '${variantName}' specified in configuration.`);
        }

        variants[variantName] = true;
      }
    }

    this._variants = variants;
  }

  /**
   * Loads the configuration data from an Rush.json configuration file and returns
   * an RushConfiguration object.
   */
  public static loadFromConfigurationFile(rushJsonFilename: string): RushConfiguration {
    let resolvedRushJsonFilename: string = path.resolve(rushJsonFilename);
    // Load the rush.json before we fix the casing. If the case is wrong on a case-sensitive filesystem,
    // the next line show throw.
    const rushConfigurationJson: IRushConfigurationJson = JsonFile.load(resolvedRushJsonFilename);

    try {
      resolvedRushJsonFilename = trueCasePathSync(resolvedRushJsonFilename);
    } catch (error) {
      /* ignore errors from true-case-path */
    }

    // Check the Rush version *before* we validate the schema, since if the version is outdated
    // then the schema may have changed. This should no longer be a problem after Rush 4.0 and the C2R wrapper,
    // but we'll validate anyway.
    const expectedRushVersion: string = rushConfigurationJson.rushVersion;

    const rushJsonBaseName: string = path.basename(resolvedRushJsonFilename);

    // If the version is missing or malformed, fall through and let the schema handle it.
    if (expectedRushVersion && semver.valid(expectedRushVersion)) {
      // Make sure the requested version isn't too old
      if (semver.lt(expectedRushVersion, MINIMUM_SUPPORTED_RUSH_JSON_VERSION)) {
        throw new Error(`${rushJsonBaseName} is version ${expectedRushVersion}, which is too old for this tool. ` +
          `The minimum supported version is ${MINIMUM_SUPPORTED_RUSH_JSON_VERSION}.`);
      }

      // Make sure the requested version isn't too new.
      //
      // If the major/minor versions are the same, then we consider the file to be compatible.
      // This is somewhat lax, e.g. "5.0.2-dev.3" will be assumed to be loadable by rush-lib 5.0.0.
      //
      // IMPORTANT: Whenever a breaking change is introduced for one of the config files, we must
      // increment the minor version number for Rush.
      if (semver.major(Rush.version) !== semver.major(expectedRushVersion)
        || semver.minor(Rush.version) !== semver.minor(expectedRushVersion)) {

        // If the major/minor are different, then make sure it's an older version.
        if (semver.lt(Rush.version, expectedRushVersion)) {
          throw new Error(`Unable to load ${rushJsonBaseName} because its RushVersion is`
            + ` ${rushConfigurationJson.rushVersion}, whereas @microsoft/rush-lib is version ${Rush.version}.`
            + ` Consider upgrading the library.`);
        }
      }
    }

    RushConfiguration._jsonSchema.validateObject(rushConfigurationJson, resolvedRushJsonFilename);

    return new RushConfiguration(rushConfigurationJson, resolvedRushJsonFilename);
  }

  public static loadFromDefaultLocation(options?: ITryFindRushJsonLocationOptions): RushConfiguration {
    const rushJsonLocation: string | undefined = RushConfiguration.tryFindRushJsonLocation(options);

    if (rushJsonLocation) {
      return RushConfiguration.loadFromConfigurationFile(rushJsonLocation);
    } else {
      throw Utilities.getRushConfigNotFoundError();
    }
  }

  /**
   * Find the rush.json location and return the path, or undefined if a rush.json can't be found.
   */
  public static tryFindRushJsonLocation(options?: ITryFindRushJsonLocationOptions): string | undefined {
    const optionsIn: ITryFindRushJsonLocationOptions = options || {};
    const verbose: boolean = optionsIn.showVerbose || false;
    let currentFolder: string = optionsIn.startingFolder || process.cwd();

    // Look upwards at parent folders until we find a folder containing rush.json
    for (let i: number = 0; i < 10; ++i) {
      const rushJsonFilename: string = path.join(currentFolder, 'rush.json');

      if (FileSystem.exists(rushJsonFilename)) {
        if (i > 0 && verbose) {
          console.log('Found configuration in ' + rushJsonFilename);
        }

        if (verbose) {
          console.log('');
        }

        return rushJsonFilename;
      }

      const parentFolder: string = path.dirname(currentFolder);
      if (parentFolder === currentFolder) {
        break;
      }

      currentFolder = parentFolder;
    }

    return undefined;
  }

  /**
   * This generates the unique names that are used to create temporary projects
   * in the Rush common folder.
   * NOTE: sortedProjectJsons is sorted by the caller.
   */
  private static _generateTempNamesForProjects(sortedProjectJsons: IRushConfigurationProjectJson[]):
    Map<IRushConfigurationProjectJson, string> {

    const tempNamesByProject: Map<IRushConfigurationProjectJson, string> =
      new Map<IRushConfigurationProjectJson, string>();
    const usedTempNames: Set<string> = new Set<string>();

    // NOTE: projectJsons was already sorted in alphabetical order by the caller.
    for (const projectJson of sortedProjectJsons) {
      // If the name is "@ms/MyProject", extract the "MyProject" part
      const unscopedName: string = PackageName.getUnscopedName(projectJson.packageName);

      // Generate a unique like name "@rush-temp/MyProject", or "@rush-temp/MyProject-2" if
      // there is a naming conflict
      let counter: number = 0;
      let tempProjectName: string = `${RushConstants.rushTempNpmScope}/${unscopedName}`;
      while (usedTempNames.has(tempProjectName)) {
        ++counter;
        tempProjectName = `${RushConstants.rushTempNpmScope}/${unscopedName}-${counter}`;
      }
      usedTempNames.add(tempProjectName);
      tempNamesByProject.set(projectJson, tempProjectName);
    }

    return tempNamesByProject;
  }

  /**
   * If someone adds a config file in the "common/rush/config" folder, it would be a bad
   * experience for Rush to silently ignore their file simply because they misspelled the
   * filename, or maybe it's an old format that's no longer supported.  The
   * _validateCommonRushConfigFolder() function makes sure that this folder only contains
   * recognized config files.
   */
  private static _validateCommonRushConfigFolder(
    commonRushConfigFolder: string,
    packageManager: PackageManagerName,
    shrinkwrapFilename: string
  ): void {
    if (!FileSystem.exists(commonRushConfigFolder)) {
      console.log(`Creating folder: ${commonRushConfigFolder}`);
      FileSystem.ensureFolder(commonRushConfigFolder);
      return;
    }

    for (const filename of FileSystem.readFolder(commonRushConfigFolder)) {

      // Ignore things that aren't actual files
      const stat: fs.Stats = FileSystem.getLinkStatistics(path.join(commonRushConfigFolder, filename));
      if (!stat.isFile() && !stat.isSymbolicLink()) {
        continue;
      }

      // Ignore harmless file extensions
      const fileExtension: string = path.extname(filename);
      if (['.bak', '.disabled', '.md', '.old', '.orig'].indexOf(fileExtension) >= 0) {
        continue;
      }

      const knownSet: Set<string> = new Set<string>(knownRushConfigFilenames.map(x => x.toUpperCase()));

      // Add the shrinkwrap filename for the package manager to the known set.
      knownSet.add(shrinkwrapFilename.toUpperCase());

      // If the package manager is pnpm, then also add the pnpm file to the known set.
      if (packageManager === 'pnpm') {
        knownSet.add(RushConstants.pnpmfileFilename.toUpperCase());
      }

      // Is the filename something we know?  If not, report an error.
      if (!knownSet.has(filename.toUpperCase())) {
        throw new Error(`An unrecognized file "${filename}" was found in the Rush config folder:`
          + ` ${commonRushConfigFolder}`);
      }
    }

    const pinnedVersionsFilename: string = path.join(commonRushConfigFolder, RushConstants.pinnedVersionsFilename);
    if (FileSystem.exists(pinnedVersionsFilename)) {
      throw new Error('The "pinned-versions.json" config file is no longer supported;'
        + ' please move your settings to the "preferredVersions" field of a "common-versions.json" config file.'
        + ` (See the ${RushConstants.rushWebSiteUrl} documentation for details.)\n\n`
        + pinnedVersionsFilename);
    }
  }

  /**
   * Returns true if the current mode is CI
   */
  public get isCI(): boolean {
    return this._isCI;
  }

  /**
   * The name of the package manager being used to install dependencies
   */
  public get packageManager(): PackageManagerName {
    return this._packageManager;
  }

  /**
   * {@inheritdoc PackageManager}
   *
   * @privateremarks
   * In the next major breaking API change, we will rename this property to "packageManager" and eliminate the
   * old property with that name.
   *
   * @beta
   */
  public get packageManagerWrapper(): PackageManager {
    return this._packageManagerWrapper;
  }

  /**
   * The absolute path to the "rush.json" configuration file that was loaded to construct this object.
   */
  public get rushJsonFile(): string {
    return this._rushJsonFile;
  }

  /**
   * The absolute path of the folder that contains rush.json for this project.
   */
  public get rushJsonFolder(): string {
    return this._rushJsonFolder;
  }

  /**
   * The folder that contains all change files.
   */
  public get changesFolder(): string {
    return this._changesFolder;
  }

  /**
   * The fully resolved path for the "common" folder where Rush will store settings that
   * affect all Rush projects.  This is always a subfolder of the folder containing "rush.json".
   * Example: `C:\MyRepo\common`
   */
  public get commonFolder(): string {
    return this._commonFolder;
  }

  /**
   * The folder where Rush's additional config files are stored.  This folder is always a
   * subfolder called `config\rush` inside the common folder.  (The `common\config` folder
   * is reserved for configuration files used by other tools.)  To avoid confusion or mistakes,
   * Rush will report an error if this this folder contains any unrecognized files.
   *
   * Example: `C:\MyRepo\common\config\rush`
   */
  public get commonRushConfigFolder(): string {
    return this._commonRushConfigFolder;
  }

  /**
   * The folder where temporary files will be stored.  This is always a subfolder called "temp"
   * under the common folder.
   * Example: `C:\MyRepo\common\temp`
   */
  public get commonTempFolder(): string {
    return this._commonTempFolder;
  }

  /**
   * The folder where automation scripts are stored.  This is always a subfolder called "scripts"
   * under the common folder.
   * Example: `C:\MyRepo\common\scripts`
   */
  public get commonScriptsFolder(): string {
    return this._commonScriptsFolder;
  }

  /**
   * The local folder that will store the NPM package cache.  Rush does not rely on the
   * npm's default global cache folder, because npm's caching implementation does not
   * reliably handle multiple processes.  (For example, if a build box is running
   * "rush install" simultaneously for two different working folders, it may fail randomly.)
   *
   * Example: `C:\MyRepo\common\temp\npm-cache`
   */
  public get npmCacheFolder(): string {
    return this._npmCacheFolder;
  }

  /**
   * The local folder where npm's temporary files will be written during installation.
   * Rush does not rely on the global default folder, because it may be on a different
   * hard disk.
   *
   * Example: `C:\MyRepo\common\temp\npm-tmp`
   */
  public get npmTmpFolder(): string {
    return this._npmTmpFolder;
  }

  /**
   * The local folder that will store the Yarn package cache.
   *
   * Example: `C:\MyRepo\common\temp\yarn-cache`
   */
  public get yarnCacheFolder(): string {
    return this._yarnCacheFolder;
  }

  /**
   * The full path of the shrinkwrap file that is tracked by Git.  (The "rush install"
   * command uses a temporary copy, whose path is tempShrinkwrapFilename.)
   * @remarks
   * This property merely reports the filename; the file itself may not actually exist.
   * Example: `C:\MyRepo\common\npm-shrinkwrap.json` or `C:\MyRepo\common\pnpm-lock.yaml`
   *
   * @deprecated Use `getCommittedShrinkwrapFilename` instead, which gets the correct common
   * shrinkwrap file name for a given active variant.
   */
  public get committedShrinkwrapFilename(): string {
    return this.getCommittedShrinkwrapFilename();
  }

  /**
   * The filename (without any path) of the shrinkwrap file that is used by the package manager.
   * @remarks
   * This property merely reports the filename; the file itself may not actually exist.
   * Example: `npm-shrinkwrap.json` or `pnpm-lock.yaml`
   */
  public get shrinkwrapFilename(): string {
    return this._shrinkwrapFilename;
  }

  /**
   * The full path of the temporary shrinkwrap file that is used during "rush install".
   * This file may get rewritten by the package manager during installation.
   * @remarks
   * This property merely reports the filename; the file itself may not actually exist.
   * Example: `C:\MyRepo\common\temp\npm-shrinkwrap.json` or `C:\MyRepo\common\temp\pnpm-lock.yaml`
   */
  public get tempShrinkwrapFilename(): string {
    return this._tempShrinkwrapFilename;
  }

  /**
   * The full path of a backup copy of tempShrinkwrapFilename. This backup copy is made
   * before installation begins, and can be compared to determine how the package manager
   * modified tempShrinkwrapFilename.
   * @remarks
   * This property merely reports the filename; the file itself may not actually exist.
   * Example: `C:\MyRepo\common\temp\npm-shrinkwrap-preinstall.json`
   * or `C:\MyRepo\common\temp\pnpm-lock-preinstall.yaml`
   */
  public get tempShrinkwrapPreinstallFilename(): string {
    return this._tempShrinkwrapPreinstallFilename;
  }

  /**
   * Returns an English phrase such as "shrinkwrap file" that can be used in logging messages
   * to refer to the shrinkwrap file using appropriate terminology for the currently selected
   * package manager.
   */
  public get shrinkwrapFilePhrase(): string {
    if (this._packageManager === 'yarn') {
      // Eventually we'd like to be consistent with Yarn's terminology of calling this a "lock file",
      // but a lot of Rush documentation uses "shrinkwrap" file and would all need to be updated.
      return 'shrinkwrap file (yarn.lock)';
    } else {
      return 'shrinkwrap file';
    }
  }

  /**
   * The filename of the build dependency data file.  By default this is
   * called 'rush-link.json' resides in the Rush common folder.
   * Its data structure is defined by IRushLinkJson.
   *
   * Example: `C:\MyRepo\common\temp\rush-link.json`
   */
  public get rushLinkJsonFilename(): string {
    return this._rushLinkJsonFilename;
  }

  /**
   * The filename of the variant dependency data file.  By default this is
   * called 'current-variant.json' resides in the Rush common folder.
   * Its data structure is defined by ICurrentVariantJson.
   *
   * Example: `C:\MyRepo\common\temp\current-variant.json`
   */
  public get currentVariantJsonFilename(): string {
    return this._currentVariantJsonFilename;
  }

  /**
   * The version of the locally installed NPM tool.  (Example: "1.2.3")
   */
  public get packageManagerToolVersion(): string {
    return this._packageManagerToolVersion;
  }

  /**
   * The absolute path to the locally installed NPM tool.  If "rush install" has not
   * been run, then this file may not exist yet.
   * Example: `C:\MyRepo\common\temp\npm-local\node_modules\.bin\npm`
   */
  public get packageManagerToolFilename(): string {
    return this._packageManagerToolFilename;
  }

  /**
   * The minimum allowable folder depth for the projectFolder field in the rush.json file.
   * This setting provides a way for repository maintainers to discourage nesting of project folders
   * that makes the directory tree more difficult to navigate.  The default value is 2,
   * which implements a standard 2-level hierarchy of <categoryFolder>/<projectFolder>/package.json.
   */
  public get projectFolderMinDepth(): number {
    return this._projectFolderMinDepth;
  }

  /**
   * The maximum allowable folder depth for the projectFolder field in the rush.json file.
   * This setting provides a way for repository maintainers to discourage nesting of project folders
   * that makes the directory tree more difficult to navigate.  The default value is 2,
   * which implements on a standard convention of <categoryFolder>/<projectFolder>/package.json.
   */
  public get projectFolderMaxDepth(): number {
    return this._projectFolderMaxDepth;
  }

  /**
   * The "approvedPackagesPolicy" settings.
   */
  public get approvedPackagesPolicy(): ApprovedPackagesPolicy {
    return this._approvedPackagesPolicy;
  }

  /**
   * [Part of the "gitPolicy" feature.]
   * A list of regular expressions describing allowable email patterns for Git commits.
   * They are case-insensitive anchored JavaScript RegExps.
   * Example: `".*@example\.com"`
   * This array will never be undefined.
   */
  public get gitAllowedEmailRegExps(): string[] {
    return this._gitAllowedEmailRegExps;
  }

  /**
   * [Part of the "gitPolicy" feature.]
   * An example valid email address that conforms to one of the allowedEmailRegExps.
   * Example: `"foxtrot@example\.com"`
   * This will never be undefined, and will always be nonempty if gitAllowedEmailRegExps is used.
   */
  public get gitSampleEmail(): string {
    return this._gitSampleEmail;
  }

  /**
   * [Part of the "gitPolicy" feature.]
   * The commit message to use when committing changes during 'rush publish'
   */
  public get gitVersionBumpCommitMessage(): string | undefined {
    return this._gitVersionBumpCommitMessage;
  }

  /**
   * [Part of the "hotfixChange" feature.]
   * Enables creating hotfix changes
   */
  public get hotfixChangeEnabled(): boolean {
    return this._hotfixChangeEnabled;
  }

  /**
   * The remote url of the repository. This helps "rush change" find the right remote to compare against.
   */
  public get repositoryUrl(): string | undefined {
    return this._repositoryUrl;
  }

  /**
   * The default branch name. This tells "rush change" which remote branch to compare against.
   */
  public get repositoryDefaultBranch(): string {
    return this._repositoryDefaultBranch;
  }

  /**
   * The default remote. This tells "rush change" which remote to compare against if the remote URL is not set
   * or if a remote matching the provided remote URL is not found.
   */
  public get repositoryDefaultRemote(): string {
    return this._repositoryDefaultRemote;
  }

  /**
   * The default fully-qualified git remote branch of the repository. This helps "rush change" find the right branch to compare against.
   */
  public get repositoryDefaultFullyQualifiedRemoteBranch(): string {
    return `${this.repositoryDefaultRemote}/${this.repositoryDefaultBranch}`;
  }

  /**
    * Odd-numbered major versions of Node.js are experimental.  Even-numbered releases
    * spend six months in a stabilization period before the first Long Term Support (LTS) version.
    * For example, 8.9.0 was the first LTS version of Node.js 8.  Pre-LTS versions are not recommended
    * for production usage because they frequently have bugs.  They may cause Rush itself
    * to malfunction.
    *
    * Rush normally prints a warning if it detects a pre-LTS Node.js version.  If you are testing
    * pre-LTS versions in preparation for supporting the first LTS version, you can use this setting
    * to disable Rush's warning.
   */
  public get suppressNodeLtsWarning(): boolean {
    return this._suppressNodeLtsWarning;
  }

  /**
   * If true, then consistent version specifiers for dependencies will be enforced.
   * I.e. "rush check" is run before some commands.
   */
  public get ensureConsistentVersions(): boolean {
    return this._ensureConsistentVersions;
  }

  /**
   * Indicates whether telemetry collection is enabled for Rush runs.
   * @beta
   */
  public get telemetryEnabled(): boolean {
    return this._telemetryEnabled;
  }

  public get projects(): RushConfigurationProject[] {
    return this._projects;
  }

  public get projectsByName(): Map<string, RushConfigurationProject> {
    return this._projectsByName;
  }

  /**
   * {@inheritDoc NpmOptionsConfiguration}
   */
  public get npmOptions(): NpmOptionsConfiguration {
    return this._npmOptions;
  }

  /**
   * {@inheritDoc PnpmOptionsConfiguration}
   */
  public get pnpmOptions(): PnpmOptionsConfiguration {
    return this._pnpmOptions;
  }

  /**
   * {@inheritDoc YarnOptionsConfiguration}
   */
  public get yarnOptions(): YarnOptionsConfiguration {
    return this._yarnOptions;
  }

  /**
   * The configuration options used by the current package manager.
   * @remarks
   * For package manager specific variants, reference {@link RushConfiguration.npmOptions | npmOptions},
   * {@link RushConfiguration.pnpmOptions | pnpmOptions}, or {@link RushConfiguration.yarnOptions | yarnOptions}.
   */
  public get packageManagerOptions(): PackageManagerOptionsConfigurationBase {
    return this._packageManagerConfigurationOptions;
  }

  /**
   * Settings from the common-versions.json config file.
   * @remarks
   * If the common-versions.json file is missing, this property will not be undefined.
   * Instead it will be initialized in an empty state, and calling CommonVersionsConfiguration.save()
   * will create the file.
   *
   * @deprecated Use `getCommonVersions` instead, which gets the correct common version data
   * for a given active variant.
   */
  public get commonVersions(): CommonVersionsConfiguration {
    return this.getCommonVersions();
  }

  /**
   * Gets the currently-installed variant, if an installation has occurred.
   * For Rush operations which do not take a --variant parameter, this method
   * determines which variant, if any, was last specified when performing "rush install"
   * or "rush update".
   */
  public get currentInstalledVariant(): string | undefined {
    let variant: string | undefined;

    if (FileSystem.exists(this._currentVariantJsonFilename)) {
      const currentVariantJson: ICurrentVariantJson = JsonFile.load(this._currentVariantJsonFilename);

      variant = currentVariantJson.variant || undefined;
    }

    return variant;
  }

  /**
   * The rush hooks. It allows customized scripts to run at the specified point.
   * @beta
   */
  public get eventHooks(): EventHooks {
    return this._eventHooks;
  }

  /**
   * Gets the path to the common-versions.json config file for a specific variant.
   * @param variant - The name of the current variant in use by the active command.
   */
  public getCommonVersionsFilePath(variant?: string | undefined): string {
    const commonVersionsFilename: string = path.join(this.commonRushConfigFolder,
      ...(variant ? [RushConstants.rushVariantsFolderName, variant] : []),
      RushConstants.commonVersionsFilename);
    return commonVersionsFilename;
  }

  /**
   * Gets the settings from the common-versions.json config file for a specific variant.
   * @param variant - The name of the current variant in use by the active command.
   */
  public getCommonVersions(variant?: string | undefined): CommonVersionsConfiguration {
    const commonVersionsFilename: string = this.getCommonVersionsFilePath(variant);
    return CommonVersionsConfiguration.loadFromFile(commonVersionsFilename);
  }

  /**
   * Gets the committed shrinkwrap file name for a specific variant.
   * @param variant - The name of the current variant in use by the active command.
   */
  public getCommittedShrinkwrapFilename(variant?: string | undefined): string {
    if (variant) {
      if (!this._variants[variant]) {
        throw new Error(
          `Invalid variant name '${variant}'. The provided variant parameter needs to be ` +
          `one of the following from rush.json: ` +
          `${Object.keys(this._variants).map((name: string) => `"${name}"`).join(', ')}.`);
      }
    }

    const variantConfigFolderPath: string = this._getVariantConfigFolderPath(variant);

    return path.join(variantConfigFolderPath, this._shrinkwrapFilename);
  }

  /**
   * Gets the absolute path for "pnpmfile.js" for a specific variant.
   * @param variant - The name of the current variant in use by the active command.
   * @remarks
   * The file path is returned even if PNPM is not configured as the package manager.
   */
  public getPnpmfilePath(variant?: string | undefined): string {
    const variantConfigFolderPath: string = this._getVariantConfigFolderPath(variant);

    return path.join(
      variantConfigFolderPath,
      RushConstants.pnpmfileFilename);
  }

  /**
   * Looks up a project in the projectsByName map.  If the project is not found,
   * then undefined is returned.
   */
  public getProjectByName(projectName: string): RushConfigurationProject | undefined {
    return this._projectsByName.get(projectName);
  }

  /**
   * This is used e.g. by command-line interfaces such as "rush build --to example".
   * If "example" is not a project name, then it also looks for a scoped name
   * like `@something/example`.  If exactly one project matches this heuristic, it
   * is returned.  Otherwise, undefined is returned.
   */
  public findProjectByShorthandName(shorthandProjectName: string): RushConfigurationProject | undefined {
    // Is there an exact match?
    let result: RushConfigurationProject | undefined = this._projectsByName.get(shorthandProjectName);
    if (result) {
      return result;
    }

    // Is there an approximate match?
    for (const project of this._projects) {
      if (PackageName.getUnscopedName(project.packageName) === shorthandProjectName) {
        if (result) {
          // Ambiguous -- there is more than one match
          return undefined;
        } else {
          result = project;
        }
      }
    }
    return result;
  }

  /**
   * Looks up a project by its RushConfigurationProject.tempProjectName field.
   * @returns The found project, or undefined if no match was found.
   */
  public findProjectByTempName(tempProjectName: string): RushConfigurationProject | undefined {
    // Is there an approximate match?
    for (const project of this._projects) {
      if (project.tempProjectName === tempProjectName) {
        return project;
      }
    }
    return undefined;
  }

  /**
   * @beta
   */
  public get versionPolicyConfiguration(): VersionPolicyConfiguration {
    return this._versionPolicyConfiguration;
  }

  /**
   * This configuration object contains settings repo maintainers have specified to enable
   * and disable experimental Rush features.
   *
   * @beta
   */
  public get experimentsConfiguration(): ExperimentsConfiguration {
    return this._experimentsConfiguration;
  }

  /**
   * Returns the project for which the specified path is underneath that project's folder.
   * If the path is not under any project's folder, returns undefined.
   */
  public tryGetProjectForPath(currentFolderPath: string): RushConfigurationProject | undefined {
    const resolvedPath: string = path.resolve(currentFolderPath);
    for (const project of this.projects) {
      if (Path.isUnderOrEqual(resolvedPath, project.projectFolder)) {
        return project;
      }
    }
    return undefined;
  }

  private _populateDownstreamDependencies(
    dependencies: { [key: string]: string } | undefined,
    packageName: string): void {

    if (!dependencies) {
      return;
    }
    Object.keys(dependencies).forEach(dependencyName => {
      const depProject: RushConfigurationProject | undefined = this._projectsByName.get(dependencyName);

      if (depProject) {
        depProject.downstreamDependencyProjects.push(packageName);
      }
    });
  }

  private _getVariantConfigFolderPath(variant?: string | undefined): string {
    if (variant) {
      if (!this._variants[variant]) {
        throw new Error(
          `Invalid variant name '${variant}'. The provided variant parameter needs to be ` +
          `one of the following from rush.json: ` +
          `${Object.keys(this._variants).map((name: string) => `"${name}"`).join(', ')}.`);
      }
    }

    return path.join(
      this._commonRushConfigFolder,
      ...(variant ? [RushConstants.rushVariantsFolderName, variant] : [])
    );
  }
}
