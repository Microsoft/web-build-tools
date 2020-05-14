// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/* eslint max-lines: off */

import * as glob from 'glob';
import * as colors from 'colors';
import * as fetch from 'node-fetch';
import * as http from 'http';
import HttpsProxyAgent = require('https-proxy-agent');
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as tar from 'tar';
import * as globEscape from 'glob-escape';
import {
  JsonFile,
  LockFile,
  Text,
  IPackageJson,
  MapExtensions,
  FileSystem,
  FileConstants,
  Sort,
  PosixModeBits,
  JsonObject
} from '@rushstack/node-core-library';

import { ApprovedPackagesChecker } from '../logic/ApprovedPackagesChecker';
import { AsyncRecycler } from '../utilities/AsyncRecycler';
import { BaseLinkManager } from '../logic/base/BaseLinkManager';
import { BaseShrinkwrapFile } from '../logic/base/BaseShrinkwrapFile';
import { PolicyValidator } from '../logic/policy/PolicyValidator';
import { IRushTempPackageJson } from '../logic/base/BasePackage';
import { Git } from '../logic/Git';
import { LastInstallFlag } from '../api/LastInstallFlag';
import { LinkManagerFactory } from '../logic/LinkManagerFactory';
import { PurgeManager } from './PurgeManager';
import { RushConfiguration, ICurrentVariantJson, IConfigurationEnvironment } from '../api/RushConfiguration';
import { RushConfigurationProject } from '../api/RushConfigurationProject';
import { RushConstants } from '../logic/RushConstants';
import { ShrinkwrapFileFactory } from '../logic/ShrinkwrapFileFactory';
import { Stopwatch } from '../utilities/Stopwatch';
import { Utilities } from '../utilities/Utilities';
import { Rush } from '../api/Rush';
import { PackageJsonEditor, DependencyType, PackageJsonDependency } from '../api/PackageJsonEditor';
import { AlreadyReportedError } from '../utilities/AlreadyReportedError';
import { CommonVersionsConfiguration } from '../api/CommonVersionsConfiguration';
import { RushGlobalFolder } from '../api/RushGlobalFolder';
import { PackageManagerName } from '../api/packageManager/PackageManager';
import { PnpmPackageManager } from '../api/packageManager/PnpmPackageManager';
import { DependencySpecifier } from './DependencySpecifier';
import { EnvironmentConfiguration } from '../api/EnvironmentConfiguration';

// The PosixModeBits are intended to be used with bitwise operations.
/* eslint-disable no-bitwise */

/**
 * The "noMtime" flag is new in tar@4.4.1 and not available yet for \@types/tar.
 * As a temporary workaround, augment the type.
 */
declare module 'tar' {
  // eslint-disable-next-line @typescript-eslint/interface-name-prefix
  export interface CreateOptions {
    /**
     * "Set to true to omit writing mtime values for entries. Note that this prevents using other
     * mtime-based features like tar.update or the keepNewer option with the resulting tar archive."
     */
    noMtime?: boolean;
  }
}

export interface IInstallManagerOptions {
  /**
   * Whether the global "--debug" flag was specified.
   */
  debug: boolean;
  /**
   * Whether or not Rush will automatically update the shrinkwrap file.
   * True for "rush update", false for "rush install".
   */
  allowShrinkwrapUpdates: boolean;
  /**
   * Whether to skip policy checks.
   */
  bypassPolicy: boolean;
  /**
   * Whether to skip linking, i.e. require "rush link" to be done manually later.
   */
  noLink: boolean;
  /**
   * Whether to delete the shrinkwrap file before installation, i.e. so that all dependencies
   * will be upgraded to the latest SemVer-compatible version.
   */
  fullUpgrade: boolean;
  /**
   * Whether to force an update to the shrinkwrap file even if it appears to be unnecessary.
   * Normally Rush uses heuristics to determine when "pnpm install" can be skipped,
   * but sometimes the heuristics can be inaccurate due to external influences
   * (pnpmfile.js script logic, registry changes, etc).
   */
  recheckShrinkwrap: boolean;

  /**
   * The value of the "--network-concurrency" command-line parameter, which
   * is a diagnostic option used to troubleshoot network failures.
   *
   * Currently only supported for PNPM.
   */
  networkConcurrency: number | undefined;

  /**
   * Whether or not to collect verbose logs from the package manager.
   * If specified when using PNPM, the logs will be in /common/temp/pnpm.log
   */
  collectLogFile: boolean;

  /**
   * The variant to consider when performing installations and validating shrinkwrap updates.
   */
  variant?: string | undefined;

  /**
   * Retry the install the specified number of times
   */
  maxInstallAttempts: number
}

/**
 * This class implements common logic between "rush install" and "rush update".
 */
export class InstallManager {
  private _rushConfiguration: RushConfiguration;
  private _rushGlobalFolder: RushGlobalFolder;
  private _commonNodeModulesMarker: LastInstallFlag;
  private _commonTempFolderRecycler: AsyncRecycler;

  private _options: IInstallManagerOptions;

  public constructor(
    rushConfiguration: RushConfiguration,
    rushGlobalFolder: RushGlobalFolder,
    purgeManager: PurgeManager,
    options: IInstallManagerOptions
  ) {
    this._rushConfiguration = rushConfiguration;
    this._rushGlobalFolder = rushGlobalFolder;
    this._commonTempFolderRecycler = purgeManager.commonTempFolderRecycler;
    this._options = options;

    const lastInstallState: JsonObject = {
      node: process.versions.node,
      packageManager: rushConfiguration.packageManager,
      packageManagerVersion: rushConfiguration.packageManagerToolVersion
    }

    if (lastInstallState.packageManager === 'pnpm') {
      lastInstallState.storePath = rushConfiguration.pnpmOptions.pnpmStorePath;
    }

    this._commonNodeModulesMarker = new LastInstallFlag(this._rushConfiguration.commonTempFolder, lastInstallState);
  }

  /**
   * Returns a map of all direct dependencies that only have a single semantic version specifier.
   * Returns a map: dependency name --> version specifier
   */
  public static collectImplicitlyPreferredVersions(
    rushConfiguration: RushConfiguration,
    options: {
      variant?: string | undefined
    } = {}
  ): Map<string, string> {
    // First, collect all the direct dependencies of all local projects, and their versions:
    // direct dependency name --> set of version specifiers
    const versionsForDependencies: Map<string, Set<string>> = new Map<string, Set<string>>();

    rushConfiguration.projects.forEach((project: RushConfigurationProject) => {
      InstallManager._collectVersionsForDependencies(
        rushConfiguration,
        {
          versionsForDependencies,
          dependencies: project.packageJsonEditor.dependencyList,
          cyclicDependencies: project.cyclicDependencyProjects,
          variant: options.variant
        });

      InstallManager._collectVersionsForDependencies(
        rushConfiguration,
        {
          versionsForDependencies,
          dependencies: project.packageJsonEditor.devDependencyList,
          cyclicDependencies: project.cyclicDependencyProjects,
          variant: options.variant
        });
    });

    // If any dependency has more than one version, then filter it out (since we don't know which version
    // should be preferred).  What remains will be the list of preferred dependencies.
    // dependency --> version specifier
    const implicitlyPreferred: Map<string, string> = new Map<string, string>();
    versionsForDependencies.forEach((versions: Set<string>, dep: string) => {
      if (versions.size === 1) {
        const version: string = versions.values().next().value;
        implicitlyPreferred.set(dep, version);
      }
    });
    return implicitlyPreferred;
  }

  // Helper for collectImplicitlyPreferredVersions()
  private static _updateVersionsForDependencies(versionsForDependencies: Map<string, Set<string>>,
    dependency: string, version: string): void {
    if (!versionsForDependencies.has(dependency)) {
      versionsForDependencies.set(dependency, new Set<string>());
    }
    versionsForDependencies.get(dependency)!.add(version);
  }

  // Helper for collectImplicitlyPreferredVersions()
  private static _collectVersionsForDependencies(
    rushConfiguration: RushConfiguration,
    options: {
      versionsForDependencies: Map<string, Set<string>>;
      dependencies: ReadonlyArray<PackageJsonDependency>;
      cyclicDependencies: Set<string>;
      variant: string | undefined;
    }): void {
    const {
      variant,
      dependencies,
      versionsForDependencies,
      cyclicDependencies
    } = options;

    const commonVersions: CommonVersionsConfiguration = rushConfiguration.getCommonVersions(variant);

    const allowedAlternativeVersions: Map<string, ReadonlyArray<string>>
      = commonVersions.allowedAlternativeVersions;

    for (const dependency of dependencies) {
      const alternativesForThisDependency: ReadonlyArray<string>
        = allowedAlternativeVersions.get(dependency.name) || [];

      // For each dependency, collectImplicitlyPreferredVersions() is collecting the set of all version specifiers
      // that appear across the repo.  If there is only one version specifier, then that's the "preferred" one.
      // However, there are a few cases where additional version specifiers can be safely ignored.
      let ignoreVersion: boolean = false;

      // 1. If the version specifier was listed in "allowedAlternativeVersions", then it's never a candidate.
      //    (Even if it's the only version specifier anywhere in the repo, we still ignore it, because
      //    otherwise the rule would be difficult to explain.)
      if (alternativesForThisDependency.indexOf(dependency.version) > 0) {
        ignoreVersion = true;
      } else {
        // Is it a local project?
        const localProject: RushConfigurationProject | undefined = rushConfiguration.getProjectByName(dependency.name);
        if (localProject) {
          // 2. If it's a symlinked local project, then it's not a candidate, because the package manager will
          //    never even see it.
          // However there are two ways that a local project can NOT be symlinked:
          // - if the local project doesn't satisfy the referenced semver specifier; OR
          // - if the local project was specified in "cyclicDependencyProjects" in rush.json
          if (semver.satisfies(localProject.packageJsonEditor.version, dependency.version)
            && !cyclicDependencies.has(dependency.name)) {
            ignoreVersion = true;
          }
        }

        if (!ignoreVersion) {
          InstallManager._updateVersionsForDependencies(versionsForDependencies, dependency.name, dependency.version);
        }
      }
    }
  }

  public get commonNodeModulesMarker(): LastInstallFlag {
    return this._commonNodeModulesMarker;
  }

  public async doInstall(): Promise<void> {
    const options: IInstallManagerOptions = this._options;

    // Check the policies
    PolicyValidator.validatePolicy(this._rushConfiguration, options);

    // Git hooks are only installed if the repo opts in by including files in /common/git-hooks
    const hookSource: string = path.join(this._rushConfiguration.commonFolder, 'git-hooks');
    const hookDestination: string | undefined = Git.getHooksFolder();

    if (FileSystem.exists(hookSource) && hookDestination) {
      const hookFilenames: string[] = FileSystem.readFolder(hookSource);
      if (hookFilenames.length > 0) {
        console.log(os.EOL + colors.bold('Found files in the "common/git-hooks" folder.'));

        // Clear the currently installed git hooks and install fresh copies
        FileSystem.ensureEmptyFolder(hookDestination);

        // Only copy files that look like Git hook names
        const filteredHookFilenames: string[] = hookFilenames.filter(x => /^[a-z\-]+/.test(x));
        for (const filename of filteredHookFilenames) {
          FileSystem.copyFile({
            sourcePath: path.join(hookSource, filename),
            destinationPath: path.join(hookDestination, filename)
          });
          FileSystem.changePosixModeBits(path.join(hookDestination, filename),
            PosixModeBits.UserRead | PosixModeBits.UserExecute);
        }

        console.log('Successfully installed these Git hook scripts: ' + filteredHookFilenames.join(', ') + os.EOL);
      }
    }

    const approvedPackagesChecker: ApprovedPackagesChecker = new ApprovedPackagesChecker(this._rushConfiguration);
    if (approvedPackagesChecker.approvedPackagesFilesAreOutOfDate) {
      if (this._options.allowShrinkwrapUpdates) {
        approvedPackagesChecker.rewriteConfigFiles();
        console.log(colors.yellow(
          'Approved package files have been updated. These updates should be committed to source control'
        ));
      } else {
        throw new Error(`Approved packages files are out-of date. Run "rush update" to update them.`);
      }
    }

    // Ensure that the package manager is installed
    await this.ensureLocalPackageManager();
    let shrinkwrapFile: BaseShrinkwrapFile | undefined = undefined;

    // (If it's a full update, then we ignore the shrinkwrap from Git since it will be overwritten)
    if (!options.fullUpgrade) {
      try {
        shrinkwrapFile = ShrinkwrapFileFactory.getShrinkwrapFile(
          this._rushConfiguration.packageManager,
          this._rushConfiguration.packageManagerOptions,
          this._rushConfiguration.getCommittedShrinkwrapFilename(options.variant)
        );
      } catch (ex) {
        console.log();
        console.log(`Unable to load the ${this._shrinkwrapFilePhrase}: ${ex.message}`);

        if (!options.allowShrinkwrapUpdates) {
          console.log();
          console.log(colors.red('You need to run "rush update" to fix this problem'));
          throw new AlreadyReportedError();
        }

        shrinkwrapFile = undefined;
      }
    }

    // Write a file indicating which variant is being installed.
    // This will be used by bulk scripts to determine the correct Shrinkwrap file to track.
    const currentVariantJsonFilename: string = this._rushConfiguration.currentVariantJsonFilename;
    const currentVariantJson: ICurrentVariantJson = {
      variant: options.variant || null // eslint-disable-line @rushstack/no-null
    };

    // Determine if the variant is already current by updating current-variant.json.
    // If nothing is written, the variant has not changed.
    const variantIsUpToDate: boolean = !JsonFile.save(currentVariantJson, currentVariantJsonFilename, {
      onlyIfChanged: true
    });

    if (options.variant) {
      console.log();
      console.log(colors.bold(`Using variant '${options.variant}' for installation.`));
    } else if (!variantIsUpToDate && !options.variant) {
      console.log();
      console.log(colors.bold('Using the default variant for installation.'));
    }

    const shrinkwrapIsUpToDate: boolean = this._createTempModulesAndCheckShrinkwrap({
      shrinkwrapFile,
      variant: options.variant
    }) && !options.recheckShrinkwrap;

    if (!shrinkwrapIsUpToDate) {
      if (!options.allowShrinkwrapUpdates) {
        console.log();
        console.log(colors.red(
          `The ${this._shrinkwrapFilePhrase} is out of date. You need to run "rush update".`
        ));
        throw new AlreadyReportedError();
      }
    }

    await this._installCommonModules({
      shrinkwrapIsUpToDate,
      variantIsUpToDate,
      ...options
    });

    if (!options.noLink) {
      const linkManager: BaseLinkManager = LinkManagerFactory.getLinkManager(this._rushConfiguration);
      await linkManager.createSymlinksForProjects(false);
    } else {
      console.log(
        os.EOL + colors.yellow('Since "--no-link" was specified, you will need to run "rush link" manually.')
      );
    }
  }

  /**
   * If the "(p)npm-local" symlink hasn't been set up yet, this creates it, installing the
   * specified (P)npm version in the user's home directory if needed.
   */
  public ensureLocalPackageManager(): Promise<void> {
    // Example: "C:\Users\YourName\.rush"
    const rushUserFolder: string = this._rushGlobalFolder.nodeSpecificPath;

    if (!FileSystem.exists(rushUserFolder)) {
      console.log('Creating ' + rushUserFolder);
      FileSystem.ensureFolder(rushUserFolder);
    }

    const packageManager: PackageManagerName = this._rushConfiguration.packageManager;
    const packageManagerVersion: string = this._rushConfiguration.packageManagerToolVersion;

    const packageManagerAndVersion: string = `${packageManager}-${packageManagerVersion}`;
    // Example: "C:\Users\YourName\.rush\pnpm-1.2.3"
    const packageManagerToolFolder: string = path.join(rushUserFolder, packageManagerAndVersion);

    const packageManagerMarker: LastInstallFlag = new LastInstallFlag(packageManagerToolFolder, {
      node: process.versions.node
    });

    console.log(`Trying to acquire lock for ${packageManagerAndVersion}`);
    return LockFile.acquire(rushUserFolder, packageManagerAndVersion).then((lock: LockFile) => {
      console.log(`Acquired lock for ${packageManagerAndVersion}`);

      if (!packageManagerMarker.isValid() || lock.dirtyWhenAcquired) {
        console.log(colors.bold(`Installing ${packageManager} version ${packageManagerVersion}${os.EOL}`));

        // note that this will remove the last-install flag from the directory
        Utilities.installPackageInDirectory({
          directory: packageManagerToolFolder,
          packageName: packageManager,
          version: this._rushConfiguration.packageManagerToolVersion,
          tempPackageTitle: `${packageManager}-local-install`,
          maxInstallAttempts: this._options.maxInstallAttempts,
          // This is using a local configuration to install a package in a shared global location.
          // Generally that's a bad practice, but in this case if we can successfully install
          // the package at all, we can reasonably assume it's good for all the repositories.
          // In particular, we'll assume that two different NPM registries cannot have two
          // different implementations of the same version of the same package.
          // This was needed for: https://github.com/microsoft/rushstack/issues/691
          commonRushConfigFolder: this._rushConfiguration.commonRushConfigFolder
        });

        console.log(`Successfully installed ${packageManager} version ${packageManagerVersion}`);
      } else {
        console.log(`Found ${packageManager} version ${packageManagerVersion} in ${packageManagerToolFolder}`);
      }

      packageManagerMarker.create();

      // Example: "C:\MyRepo\common\temp"
      FileSystem.ensureFolder(this._rushConfiguration.commonTempFolder);

      // Example: "C:\MyRepo\common\temp\pnpm-local"
      const localPackageManagerToolFolder: string =
        path.join(this._rushConfiguration.commonTempFolder, `${packageManager}-local`);

      console.log(os.EOL + 'Symlinking "' + localPackageManagerToolFolder + '"');
      console.log('  --> "' + packageManagerToolFolder + '"');

      // We cannot use FileSystem.exists() to test the existence of a symlink, because it will
      // return false for broken symlinks.  There is no way to test without catching an exception.
      try {
        FileSystem.deleteFolder(localPackageManagerToolFolder);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      FileSystem.createSymbolicLinkJunction({
        linkTargetPath: packageManagerToolFolder,
        newLinkPath: localPackageManagerToolFolder
      });

      lock.release();
    });
  }

  /**
   * Regenerates the common/package.json and all temp_modules projects.
   * If shrinkwrapFile is provided, this function also validates whether it contains
   * everything we need to install and returns true if so; in all other cases,
   * the return value is false.
   */
  private _createTempModulesAndCheckShrinkwrap(options: {
    shrinkwrapFile: BaseShrinkwrapFile | undefined;
    variant: string | undefined;
  }): boolean {
    const {
      shrinkwrapFile,
      variant
    } = options;

    const stopwatch: Stopwatch = Stopwatch.start();

    // Example: "C:\MyRepo\common\temp\projects"
    const tempProjectsFolder: string = path.join(this._rushConfiguration.commonTempFolder,
      RushConstants.rushTempProjectsFolderName);

    console.log(os.EOL + colors.bold('Updating temp projects in ' + tempProjectsFolder));

    Utilities.createFolderWithRetry(tempProjectsFolder);

    const shrinkwrapWarnings: string[] = [];

    // We will start with the assumption that it's valid, and then set it to false if
    // any of the checks fail
    let shrinkwrapIsUpToDate: boolean = true;

    if (!shrinkwrapFile) {
      shrinkwrapIsUpToDate = false;
    }

    // dependency name --> version specifier
    const allExplicitPreferredVersions: Map<string, string> = this._rushConfiguration.getCommonVersions(variant)
      .getAllPreferredVersions();

    if (shrinkwrapFile) {
      // Check any (explicitly) preferred dependencies first
      allExplicitPreferredVersions.forEach((version: string, dependency: string) => {
        const dependencySpecifier: DependencySpecifier = new DependencySpecifier(dependency, version);

        if (!shrinkwrapFile.hasCompatibleTopLevelDependency(dependencySpecifier)) {
          shrinkwrapWarnings.push(`"${dependency}" (${version}) required by the preferred versions from `
            + RushConstants.commonVersionsFilename);
          shrinkwrapIsUpToDate = false;
        }
      });

      if (this._findOrphanedTempProjects(shrinkwrapFile)) {
        // If there are any orphaned projects, then "npm install" would fail because the shrinkwrap
        // contains references such as "resolved": "file:projects\\project1" that refer to nonexistent
        // file paths.
        shrinkwrapIsUpToDate = false;
      }
    }

    // Also copy down the committed .npmrc file, if there is one
    // "common\config\rush\.npmrc" --> "common\temp\.npmrc"
    // Also ensure that we remove any old one that may be hanging around
    Utilities.syncNpmrc(this._rushConfiguration.commonRushConfigFolder, this._rushConfiguration.commonTempFolder);

    // also, copy the pnpmfile.js if it exists
    if (this._rushConfiguration.packageManager === 'pnpm') {
      const committedPnpmFilePath: string =
        this._rushConfiguration.getPnpmfilePath(this._options.variant);
      const tempPnpmFilePath: string
        = path.join(this._rushConfiguration.commonTempFolder, RushConstants.pnpmfileFilename);

      // ensure that we remove any old one that may be hanging around
      this._syncFile(committedPnpmFilePath, tempPnpmFilePath);
    }

    const commonPackageJson: IPackageJson = {
      dependencies: {},
      description: 'Temporary file generated by the Rush tool',
      name: 'rush-common',
      private: true,
      version: '0.0.0'
    };

    // dependency name --> version specifier
    const allPreferredVersions: Map<string, string> = new Map<string, string>();

    // Should we add implicitly preferred versions?
    let useImplicitlyPinnedVersions: boolean;
    if (this._rushConfiguration.commonVersions.implicitlyPreferredVersions !== undefined) {
      // Use the manually configured setting
      useImplicitlyPinnedVersions = this._rushConfiguration.commonVersions.implicitlyPreferredVersions;
    } else {
      // Default to true.
      useImplicitlyPinnedVersions = true;
    }

    if (useImplicitlyPinnedVersions) {
      // Add in the implicitly preferred versions.
      // These are any first-level dependencies for which we only consume a single version range
      // (e.g. every package that depends on react uses an identical specifier)
      const implicitlyPreferredVersions: Map<string, string> =
        InstallManager.collectImplicitlyPreferredVersions(this._rushConfiguration, { variant });
      MapExtensions.mergeFromMap(allPreferredVersions, implicitlyPreferredVersions);
    }

    // Add in the explicitly preferred versions.
    // Note that these take precedence over implicitly preferred versions.
    MapExtensions.mergeFromMap(allPreferredVersions, allExplicitPreferredVersions);

    // Add any preferred versions to the top of the commonPackageJson
    // do this in alphabetical order for simpler debugging
    for (const dependency of Array.from(allPreferredVersions.keys()).sort()) {
      commonPackageJson.dependencies![dependency] = allPreferredVersions.get(dependency)!;
    }

    // To make the common/package.json file more readable, sort alphabetically
    // according to rushProject.tempProjectName instead of packageName.
    const sortedRushProjects: RushConfigurationProject[] = this._rushConfiguration.projects.slice(0);
    Sort.sortBy(sortedRushProjects, x => x.tempProjectName);

    for (const rushProject of sortedRushProjects) {
      const packageJson: PackageJsonEditor = rushProject.packageJsonEditor;

      // Example: "C:\MyRepo\common\temp\projects\my-project-2.tgz"
      const tarballFile: string = this._getTarballFilePath(rushProject);

      // Example: "my-project-2"
      const unscopedTempProjectName: string = rushProject.unscopedTempProjectName;

      // Example: dependencies["@rush-temp/my-project-2"] = "file:./projects/my-project-2.tgz"
      commonPackageJson.dependencies![rushProject.tempProjectName]
        = `file:./${RushConstants.rushTempProjectsFolderName}/${rushProject.unscopedTempProjectName}.tgz`;

      const tempPackageJson: IRushTempPackageJson = {
        name: rushProject.tempProjectName,
        version: '0.0.0',
        private: true,
        dependencies: {}
      };

      // Collect pairs of (packageName, packageVersion) to be added as dependencies of the @rush-temp package.json
      const tempDependencies: Map<string, string> = new Map<string, string>();

      // These can be regular, optional, or peer dependencies (but NOT dev dependencies).
      // (A given packageName will never appear more than once in this list.)
      for (const dependency of packageJson.dependencyList) {

        // If there are any optional dependencies, copy directly into the optionalDependencies field.
        if (dependency.dependencyType === DependencyType.Optional) {
          if (!tempPackageJson.optionalDependencies) {
            tempPackageJson.optionalDependencies = {};
          }
          tempPackageJson.optionalDependencies[dependency.name] = dependency.version;
        } else {
          tempDependencies.set(dependency.name, dependency.version);
        }
      }

      for (const dependency of packageJson.devDependencyList) {
        // If there are devDependencies, we need to merge them with the regular dependencies.  If the same
        // library appears in both places, then the dev dependency wins (because presumably it's saying what you
        // want right now for development, not the range that you support for consumers).
        tempDependencies.set(dependency.name, dependency.version);
      }
      Sort.sortMapKeys(tempDependencies);

      for (const [packageName, packageVersion] of tempDependencies.entries()) {
        const dependencySpecifier: DependencySpecifier = new DependencySpecifier(packageName, packageVersion);

        // Is there a locally built Rush project that could satisfy this dependency?
        // If so, then we will symlink to the project folder rather than to common/temp/node_modules.
        // In this case, we don't want "npm install" to process this package, but we do need
        // to record this decision for "rush link" later, so we add it to a special 'rushDependencies' field.
        const localProject: RushConfigurationProject | undefined =
          this._rushConfiguration.getProjectByName(packageName);

        if (localProject) {
          // Don't locally link if it's listed in the cyclicDependencyProjects
          if (!rushProject.cyclicDependencyProjects.has(packageName)) {

            // Also, don't locally link if the SemVer doesn't match
            const localProjectVersion: string = localProject.packageJsonEditor.version;
            if (semver.satisfies(localProjectVersion, packageVersion)) {

              // We will locally link this package, so instead add it to our special "rushDependencies"
              // field in the package.json file.
              if (!tempPackageJson.rushDependencies) {
                tempPackageJson.rushDependencies = {};
              }
              tempPackageJson.rushDependencies[packageName] = packageVersion;
              continue;
            }
          }
        }

        // We will NOT locally link this package; add it as a regular dependency.
        tempPackageJson.dependencies![packageName] = packageVersion;

        let tryReusingPackageVersionsFromShrinkwrap: boolean = true;

        if (this._rushConfiguration.packageManager === 'pnpm') {
          // Shrinkwrap churn optimization doesn't make sense when --frozen-lockfile is true
          tryReusingPackageVersionsFromShrinkwrap =
            !this._rushConfiguration.experimentsConfiguration.configuration.usePnpmFrozenLockfileForRushInstall;
        }

        if (shrinkwrapFile) {
          if (!shrinkwrapFile.tryEnsureCompatibleDependency(dependencySpecifier, rushProject.tempProjectName,
            tryReusingPackageVersionsFromShrinkwrap)) {
            shrinkwrapWarnings.push(`"${packageName}" (${packageVersion}) required by`
              + ` "${rushProject.packageName}"`);
            shrinkwrapIsUpToDate = false;
          }
        }
      }

      // NPM expects the root of the tarball to have a directory called 'package'
      const npmPackageFolder: string = 'package';

      // Example: "C:\MyRepo\common\temp\projects\my-project-2"
      const tempProjectFolder: string = path.join(
        this._rushConfiguration.commonTempFolder,
        RushConstants.rushTempProjectsFolderName,
        unscopedTempProjectName);

      // Example: "C:\MyRepo\common\temp\projects\my-project-2\package.json"
      const tempPackageJsonFilename: string = path.join(tempProjectFolder, FileConstants.PackageJson);

      // we only want to overwrite the package if the existing tarball's package.json is different from tempPackageJson
      let shouldOverwrite: boolean = true;
      try {
        // if the tarball and the temp file still exist, then compare the contents
        if (FileSystem.exists(tarballFile) && FileSystem.exists(tempPackageJsonFilename)) {

          // compare the extracted package.json with the one we are about to write
          const oldBuffer: Buffer = FileSystem.readFileToBuffer(tempPackageJsonFilename);
          const newBuffer: Buffer = Buffer.from(JsonFile.stringify(tempPackageJson));

          if (Buffer.compare(oldBuffer, newBuffer) === 0) {
            shouldOverwrite = false;
          }
        }
      } catch (error) {
        // ignore the error, we will go ahead and create a new tarball
      }

      if (shouldOverwrite) {
        try {
          // ensure the folder we are about to zip exists
          Utilities.createFolderWithRetry(tempProjectFolder);

          // remove the old tarball & old temp package json, this is for any cases where new tarball creation
          // fails, and the shouldOverwrite logic is messed up because the my-project-2\package.json
          // exists and is updated, but the tarball is not accurate
          FileSystem.deleteFile(tarballFile);
          FileSystem.deleteFile(tempPackageJsonFilename);

          // write the expected package.json file into the zip staging folder
          JsonFile.save(tempPackageJson, tempPackageJsonFilename);

          const tarOptions: tar.CreateOptions = ({
            gzip: true,
            file: tarballFile,
            cwd: tempProjectFolder,
            portable: true,
            noMtime: true,
            noPax: true,
            sync: true,
            prefix: npmPackageFolder,
            filter: (path: string, stat: tar.FileStat): boolean => {
              if (!this._rushConfiguration.experimentsConfiguration.configuration
                .noChmodFieldInTarHeaderNormalization) {
                stat.mode = (stat.mode & ~0x1FF) | PosixModeBits.AllRead | PosixModeBits.UserWrite
                  | PosixModeBits.AllExecute;
              }
              return true;
            }
          } as tar.CreateOptions);

          // create the new tarball
          tar.create(tarOptions, [FileConstants.PackageJson]);

          console.log(`Updating ${tarballFile}`);
        } catch (error) {
          console.log(colors.yellow(error));
          // delete everything in case of any error
          FileSystem.deleteFile(tarballFile);
          FileSystem.deleteFile(tempPackageJsonFilename);
        }
      }
    }

    // Example: "C:\MyRepo\common\temp\package.json"
    const commonPackageJsonFilename: string = path.join(this._rushConfiguration.commonTempFolder,
      FileConstants.PackageJson);

    if (shrinkwrapFile) {
      // If we have a (possibly incomplete) shrinkwrap file, check to see if any shrinkwrap-specific
      // changes make the shrinkwrap out-of-date, and save it as the temporary file.
      if (shrinkwrapFile.shouldForceRecheck()) {
        shrinkwrapIsUpToDate = false;
      }

      shrinkwrapFile.save(this._rushConfiguration.tempShrinkwrapFilename);
      shrinkwrapFile.save(this._rushConfiguration.tempShrinkwrapPreinstallFilename);
    } else {
      // Otherwise delete the temporary file
      FileSystem.deleteFile(this._rushConfiguration.tempShrinkwrapFilename);

      if (this._rushConfiguration.packageManager === 'pnpm') {
        // Workaround for https://github.com/pnpm/pnpm/issues/1890
        //
        // When "rush update --full" is run, rush deletes common/temp/pnpm-lock.yaml so that
        // a new lockfile can be generated. But because of the above bug "pnpm install" would
        // respect "common/temp/node_modules/.pnpm-lock.yaml" and thus would not generate a
        // new lockfile. Deleting this file in addition to deleting common/temp/pnpm-lock.yaml
        // ensures that a new lockfile will be generated with "rush update --full".

        const pnpmPackageManager: PnpmPackageManager =
          (this._rushConfiguration.packageManagerWrapper as PnpmPackageManager);

        FileSystem.deleteFile(path.join(this._rushConfiguration.commonTempFolder,
          pnpmPackageManager.internalShrinkwrapRelativePath));
      }
    }

    // Don't update the file timestamp unless the content has changed, since "rush install"
    // will consider this timestamp
    JsonFile.save(commonPackageJson, commonPackageJsonFilename, { onlyIfChanged: true });

    stopwatch.stop();
    console.log(`Finished creating temporary modules (${stopwatch.toString()})`);

    if (shrinkwrapWarnings.length > 0) {
      console.log();
      console.log(colors.yellow(Utilities.wrapWords(
        `The ${this._shrinkwrapFilePhrase} is missing the following dependencies:`)));

      for (const shrinkwrapWarning of shrinkwrapWarnings) {
        console.log(colors.yellow('  ' + shrinkwrapWarning));
      }
      console.log();
    }

    return shrinkwrapIsUpToDate;
  }

  /**
   * Runs "npm/pnpm/yarn install" in the "common/temp" folder.
   */
  private _installCommonModules(options: {
    shrinkwrapIsUpToDate: boolean;
    variantIsUpToDate: boolean;
  } & IInstallManagerOptions): Promise<void> {
    const {
      shrinkwrapIsUpToDate,
      variantIsUpToDate
    } = options;

    const usePnpmFrozenLockfile: boolean = this._rushConfiguration.packageManager === 'pnpm' &&
      this._rushConfiguration.experimentsConfiguration.configuration.usePnpmFrozenLockfileForRushInstall === true;
    return Promise.resolve().then(() => {
      console.log(os.EOL + colors.bold('Checking node_modules in ' + this._rushConfiguration.commonTempFolder)
        + os.EOL);

      const commonNodeModulesFolder: string = path.join(this._rushConfiguration.commonTempFolder,
        'node_modules');

      // This marker file indicates that the last "rush install" completed successfully
      const markerFileExistedAndWasValidAtStart: boolean = this._commonNodeModulesMarker.checkValidAndReportStoreIssues();

      // If "--clean" or "--full-clean" was specified, or if the last install was interrupted,
      // then we will need to delete the node_modules folder.  Otherwise, we can do an incremental
      // install.
      const deleteNodeModules: boolean = !markerFileExistedAndWasValidAtStart;

      // Based on timestamps, can we skip this install entirely?
      if (shrinkwrapIsUpToDate && !deleteNodeModules && variantIsUpToDate) {
        const potentiallyChangedFiles: string[] = [];

        // Consider the timestamp on the node_modules folder; if someone tampered with it
        // or deleted it entirely, then we can't skip this install
        potentiallyChangedFiles.push(commonNodeModulesFolder);

        // Additionally, if they pulled an updated npm-shrinkwrap.json file from Git,
        // then we can't skip this install
        potentiallyChangedFiles.push(this._rushConfiguration.getCommittedShrinkwrapFilename(options.variant));

        // Add common-versions.json file to the potentially changed files list.
        potentiallyChangedFiles.push(this._rushConfiguration.getCommonVersionsFilePath(options.variant));

        if (this._rushConfiguration.packageManager === 'pnpm') {
          // If the repo is using pnpmfile.js, consider that also
          const pnpmFileFilename: string = this._rushConfiguration.getPnpmfilePath(options.variant);

          if (FileSystem.exists(pnpmFileFilename)) {
            potentiallyChangedFiles.push(pnpmFileFilename);
          }
        }

        // Also consider timestamps for all the temp tarballs. (createTempModulesAndCheckShrinkwrap() will
        // carefully preserve these timestamps unless something has changed.)
        // Example: "C:\MyRepo\common\temp\projects\my-project-2.tgz"
        potentiallyChangedFiles.push(...this._rushConfiguration.projects.map(x => {
          return this._getTarballFilePath(x);
        }));

        // NOTE: If commonNodeModulesMarkerFilename (or any of the potentiallyChangedFiles) does not
        // exist, then isFileTimestampCurrent() returns false.
        if (Utilities.isFileTimestampCurrent(this._commonNodeModulesMarker.path, potentiallyChangedFiles)) {
          // Nothing to do, because everything is up to date according to time stamps
          return;
        }
      }

      return this._checkIfReleaseIsPublished()
        .catch((error) => {
          // If the user is working in an environment that can't reach the registry,
          // don't bother them with errors.
          return undefined;
        }).then((publishedRelease: boolean | undefined) => {

          if (publishedRelease === false) {
            console.log(colors.yellow('Warning: This release of the Rush tool was unpublished; it may be unstable.'));
          }

          // Since we're going to be tampering with common/node_modules, delete the "rush link" flag file if it exists;
          // this ensures that a full "rush link" is required next time
          Utilities.deleteFile(this._rushConfiguration.rushLinkJsonFilename);

          // Delete the successful install file to indicate the install transaction has started
          this._commonNodeModulesMarker.clear();

          // NOTE: The PNPM store is supposed to be transactionally safe, so we don't delete it automatically.
          // The user must request that via the command line.
          if (deleteNodeModules) {
            if (this._rushConfiguration.packageManager === 'npm') {
              console.log(`Deleting the "npm-cache" folder`);
              // This is faster and more thorough than "npm cache clean"
              this._commonTempFolderRecycler.moveFolder(this._rushConfiguration.npmCacheFolder);

              console.log(`Deleting the "npm-tmp" folder`);
              this._commonTempFolderRecycler.moveFolder(this._rushConfiguration.npmTmpFolder);
            }
          }

          // Example: "C:\MyRepo\common\temp\npm-local\node_modules\.bin\npm"
          const packageManagerFilename: string = this._rushConfiguration.packageManagerToolFilename;

          let packageManagerEnv: NodeJS.ProcessEnv = process.env;

          let configurationEnvironment: IConfigurationEnvironment | undefined = undefined;

          if (this._rushConfiguration.packageManager === 'npm') {
            if (
              this._rushConfiguration.npmOptions &&
              this._rushConfiguration.npmOptions.environmentVariables
            ) {
              configurationEnvironment = this._rushConfiguration.npmOptions.environmentVariables;
            }
          } else if (this._rushConfiguration.packageManager === 'pnpm') {
            if (
              this._rushConfiguration.pnpmOptions &&
              this._rushConfiguration.pnpmOptions.environmentVariables
            ) {
              configurationEnvironment = this._rushConfiguration.pnpmOptions.environmentVariables;
            }
          } else if (this._rushConfiguration.packageManager === 'yarn') {
            if (
              this._rushConfiguration.yarnOptions &&
              this._rushConfiguration.yarnOptions.environmentVariables
            ) {
              configurationEnvironment = this._rushConfiguration.yarnOptions.environmentVariables;
            }
          }

          packageManagerEnv = this._mergeEnvironmentVariables(
            process.env,
            configurationEnvironment
          );

          // Is there an existing "node_modules" folder to consider?
          if (FileSystem.exists(commonNodeModulesFolder)) {
            // Should we delete the entire "node_modules" folder?
            if (deleteNodeModules) {
              // YES: Delete "node_modules"

              // Explain to the user why we are hosing their node_modules folder
              console.log('Deleting files from ' + commonNodeModulesFolder);

              this._commonTempFolderRecycler.moveFolder(commonNodeModulesFolder);

              Utilities.createFolderWithRetry(commonNodeModulesFolder);
            } else {
              // NO: Prepare to do an incremental install in the "node_modules" folder

              // note: it is not necessary to run "prune" with pnpm
              if (this._rushConfiguration.packageManager === 'npm') {
                console.log(`Running "${this._rushConfiguration.packageManager} prune"`
                  + ` in ${this._rushConfiguration.commonTempFolder}`);
                const args: string[] = ['prune'];
                this._pushConfigurationArgs(args, options);

                Utilities.executeCommandWithRetry(this._options.maxInstallAttempts, packageManagerFilename, args,
                  this._rushConfiguration.commonTempFolder, packageManagerEnv);

                // Delete the (installed image of) the temp projects, since "npm install" does not
                // detect changes for "file:./" references.
                // We recognize the temp projects by their names, which always start with "rush-".

                // Example: "C:\MyRepo\common\temp\node_modules\@rush-temp"
                const pathToDeleteWithoutStar: string = path.join(commonNodeModulesFolder,
                  RushConstants.rushTempNpmScope);
                console.log(`Deleting ${pathToDeleteWithoutStar}\\*`);
                // Glob can't handle Windows paths
                const normalizedpathToDeleteWithoutStar: string = Text.replaceAll(pathToDeleteWithoutStar, '\\', '/');

                // Example: "C:/MyRepo/common/temp/node_modules/@rush-temp/*"
                for (const tempModulePath of glob.sync(globEscape(normalizedpathToDeleteWithoutStar) + '/*')) {
                  // We could potentially use AsyncRecycler here, but in practice these folders tend
                  // to be very small
                  Utilities.dangerouslyDeletePath(tempModulePath);
                }
              }
            }
          }

          if (this._rushConfiguration.packageManager === 'yarn') {
            // Yarn does not correctly detect changes to a tarball, so we need to forcibly clear its cache
            const yarnRushTempCacheFolder: string = path.join(
              this._rushConfiguration.yarnCacheFolder, 'v2', 'npm-@rush-temp'
            );
            if (FileSystem.exists(yarnRushTempCacheFolder)) {
              console.log('Deleting ' + yarnRushTempCacheFolder);
              Utilities.dangerouslyDeletePath(yarnRushTempCacheFolder);
            }
          }

          // Run "npm install" in the common folder
          const installArgs: string[] = ['install'];
          this._pushConfigurationArgs(installArgs, options);

          console.log(os.EOL + colors.bold(`Running "${this._rushConfiguration.packageManager} install" in`
            + ` ${this._rushConfiguration.commonTempFolder}`) + os.EOL);

          // If any diagnostic options were specified, then show the full command-line
          if (options.debug || options.collectLogFile || options.networkConcurrency) {
            console.log(os.EOL + colors.green('Invoking package manager: ')
              + FileSystem.getRealPath(packageManagerFilename) + ' ' + installArgs.join(' ') + os.EOL);
          }

          try {
            Utilities.executeCommandWithRetry(this._options.maxInstallAttempts, packageManagerFilename,
              installArgs,
              this._rushConfiguration.commonTempFolder,
              packageManagerEnv,
              false, () => {
                if (this._rushConfiguration.packageManager === 'pnpm') {
                  console.log(colors.yellow(`Deleting the "node_modules" folder`));
                  this._commonTempFolderRecycler.moveFolder(commonNodeModulesFolder);

                  // Leave the pnpm-store as is for the retry. This ensures that packages that have already
                  // been downloaded need not be downloaded again, thereby potentially increasing the chances
                  // of a subsequent successful install.

                  Utilities.createFolderWithRetry(commonNodeModulesFolder);
                }
              });
          } catch (error) {
            // All the install attempts failed.

            if (
              this._rushConfiguration.packageManager === 'pnpm' &&
              this._rushConfiguration.pnpmOptions.pnpmStore === 'local'
            ) {
              if (this._rushConfiguration.isCI) {
                // If the installation has failed even after the retries, then pnpm store may
                // have got into a corrupted, irrecoverable state. Delete the store so that a
                // future install can create the store afresh on CI machines.
                console.log(colors.yellow(`Deleting the "pnpm-store" folder`));
                this._commonTempFolderRecycler.moveFolder(this._rushConfiguration.pnpmOptions.pnpmStorePath);
              }
            }

            throw error;
          }

          if (this._rushConfiguration.packageManager === 'npm') {

            console.log(os.EOL + colors.bold('Running "npm shrinkwrap"...'));
            const npmArgs: string[] = ['shrinkwrap'];
            this._pushConfigurationArgs(npmArgs, options);
            Utilities.executeCommand(this._rushConfiguration.packageManagerToolFilename,
              npmArgs, this._rushConfiguration.commonTempFolder);
            console.log('"npm shrinkwrap" completed' + os.EOL);

            this._fixupNpm5Regression();
          }

          if (options.allowShrinkwrapUpdates && (usePnpmFrozenLockfile || !shrinkwrapIsUpToDate)) {
            // Shrinkwrap files may need to be post processed after install, so load and save it
            const tempShrinkwrapFile: BaseShrinkwrapFile | undefined = ShrinkwrapFileFactory.getShrinkwrapFile(
              this._rushConfiguration.packageManager,
              this._rushConfiguration.packageManagerOptions,
              this._rushConfiguration.tempShrinkwrapFilename);
            if (tempShrinkwrapFile) {
              tempShrinkwrapFile.save(this._rushConfiguration.tempShrinkwrapFilename);
            }

            // Copy (or delete) common\temp\pnpm-lock.yaml --> common\config\rush\pnpm-lock.yaml
            this._syncFile(this._rushConfiguration.tempShrinkwrapFilename,
              this._rushConfiguration.getCommittedShrinkwrapFilename(options.variant));
          } else {
            // TODO: Validate whether the package manager updated it in a nontrivial way
          }

          // Finally, create the marker file to indicate a successful install
          this._commonNodeModulesMarker.create();

          console.log('');
        });
    });
  }

  private _mergeEnvironmentVariables(
    baseEnv: NodeJS.ProcessEnv,
    environmentVariables?: IConfigurationEnvironment
  ): NodeJS.ProcessEnv {
    const packageManagerEnv: NodeJS.ProcessEnv = baseEnv;

    if (environmentVariables) {
      // eslint-disable-next-line guard-for-in
      for (const envVar in environmentVariables) {
        let setEnvironmentVariable: boolean = true;
        console.log(`\nProcessing definition for environment variable: ${envVar}`);

        if (baseEnv.hasOwnProperty(envVar)) {
          setEnvironmentVariable = false;
          console.log(`Environment variable already defined:`);
          console.log(`  Name: ${envVar}`);
          console.log(`  Existing value: ${baseEnv[envVar]}`);
          console.log(`  Value set in rush.json: ${environmentVariables[envVar].value}`);

          if (environmentVariables[envVar].override) {
            setEnvironmentVariable = true;
            console.log(`Overriding the environment variable with the value set in rush.json.`);
          }
          else {
            console.log(colors.yellow(`WARNING: Not overriding the value of the environment variable.`));
          }
        }

        if (setEnvironmentVariable) {
          if (this._options.debug) {
            console.log(`Setting environment variable for package manager.`);
            console.log(`  Name: ${envVar}`);
            console.log(`  Value: ${environmentVariables[envVar].value}`);
          }
          packageManagerEnv[envVar] = environmentVariables[envVar].value;
        }
      }
    }

    return packageManagerEnv;
  }

  private _checkIfReleaseIsPublished(): Promise<boolean> {
    return Promise.resolve().then(() => {
      const lastCheckFile: string = path.join(this._rushGlobalFolder.nodeSpecificPath,
        'rush-' + Rush.version, 'last-check.flag');

      if (FileSystem.exists(lastCheckFile)) {
        let cachedResult: boolean | 'error' | undefined = undefined;
        try {
          // NOTE: mtimeMs is not supported yet in Node.js 6.x
          const nowMs: number = new Date().getTime();
          const ageMs: number = nowMs - FileSystem.getStatistics(lastCheckFile).mtime.getTime();
          const HOUR: number = 60 * 60 * 1000;

          // Is the cache too old?
          if (ageMs < 24 * HOUR) {
            // No, read the cached result
            cachedResult = JsonFile.load(lastCheckFile);
          }
        } catch (e) {
          // Unable to parse file
        }
        if (cachedResult === 'error') {
          return Promise.reject(new Error('Unable to contact server'));
        }
        if (cachedResult === true || cachedResult === false) {
          return cachedResult;
        }
      }

      // Before we start the network operation, record a failed state.  If the process exits for some reason,
      // this will record the error.  It will also update the timestamp to prevent other Rush instances
      // from attempting to update the file.
      JsonFile.save('error', lastCheckFile, { ensureFolderExists: true });

      // For this check we use the official registry, not the private registry
      return this._queryIfReleaseIsPublished('https://registry.npmjs.org:443')
        .then((publishedRelease: boolean) => {
          // Cache the result
          JsonFile.save(publishedRelease, lastCheckFile, { ensureFolderExists: true });
          return publishedRelease;
        })
        .catch((error: Error) => {
          JsonFile.save('error', lastCheckFile, { ensureFolderExists: true });
          return Promise.reject(error);
        });
    });
  }

  private _queryIfReleaseIsPublished(registryUrl: string): Promise<boolean> {
    let queryUrl: string = registryUrl;
    if (queryUrl[-1] !== '/') {
      queryUrl += '/';
    }
    // Note that the "@" symbol does not normally get URL-encoded
    queryUrl += RushConstants.rushPackageName.replace('/', '%2F');

    const userAgent: string = `pnpm/? npm/? node/${process.version} ${os.platform()} ${os.arch()}`;

    const headers: fetch.Headers = new fetch.Headers();
    headers.append('user-agent', userAgent);
    headers.append('accept', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*');

    let agent: http.Agent | undefined = undefined;
    if (process.env.HTTP_PROXY) {
      agent = new HttpsProxyAgent(process.env.HTTP_PROXY);
    }

    return fetch.default(queryUrl, {
      headers: headers,
      agent: agent
    })
      .then((response: fetch.Response) => {
        if (!response.ok) {
          return Promise.reject(new Error('Failed to query'));
        }
        return response
          .json()
          .then((data) => {
            let url: string;
            try {
              if (!data.versions[Rush.version]) {
                // Version was not published
                return false;
              }
              url = data.versions[Rush.version].dist.tarball;
              if (!url) {
                return Promise.reject(new Error(`URL not found`));
              }
            } catch (e) {
              return Promise.reject(new Error('Error parsing response'));
            }

            // Make sure the tarball wasn't deleted from the CDN
            headers.set('accept', '*/*');
            return fetch.default(url, {
              headers: headers,
              agent: agent
            })
              .then<boolean>((response2: fetch.Response) => {
                if (!response2.ok) {
                  if (response2.status === 404) {
                    return false;
                  } else {
                    return Promise.reject(new Error('Failed to fetch'));
                  }
                }
                return true;
              });
          });
      });
  }

  /**
   * Used when invoking the NPM tool.  Appends the common configuration options
   * to the command-line.
   */
  private _pushConfigurationArgs(args: string[], options: IInstallManagerOptions): void {
    if (this._rushConfiguration.packageManager === 'npm') {
      if (semver.lt(this._rushConfiguration.packageManagerToolVersion, '5.0.0')) {
        // NOTE:
        //
        // When using an npm version older than v5.0.0, we do NOT install optional dependencies for
        // Rush, because npm does not generate the shrinkwrap file consistently across platforms.
        //
        // Consider the "fsevents" package. This is a Mac specific package
        // which is an optional second-order dependency. Optional dependencies work by attempting to install
        // the package, but removes the package if the install failed.
        // This means that someone running generate on a Mac WILL have fsevents included in their shrinkwrap.
        // When someone using Windows attempts to install from the shrinkwrap, the install will fail.
        //
        // If someone generates the shrinkwrap using Windows, then fsevents will NOT be listed in the shrinkwrap.
        // When someone using Mac attempts to install from the shrinkwrap, they will NOT have the
        // optional dependency installed.
        //
        // This issue has been fixed as of npm v5.0.0: https://github.com/npm/npm/releases/tag/v5.0.0
        //
        // For more context, see https://github.com/microsoft/rushstack/issues/761#issuecomment-428689600
        args.push('--no-optional');
      }
      args.push('--cache', this._rushConfiguration.npmCacheFolder);
      args.push('--tmp', this._rushConfiguration.npmTmpFolder);

      if (options.collectLogFile) {
        args.push('--verbose');
      }
    } else if (this._rushConfiguration.packageManager === 'pnpm') {
      // Only explicitly define the store path if `pnpmStore` is using the default, or has been set to
      // 'local'.  If `pnpmStore` = 'global', then allow PNPM to use the system's default
      // path.  In all cases, this will be overridden by RUSH_PNPM_STORE_PATH
      if (
        this._rushConfiguration.pnpmOptions.pnpmStore === 'local' ||
        EnvironmentConfiguration.pnpmStorePathOverride
      ) {
        args.push('--store', this._rushConfiguration.pnpmOptions.pnpmStorePath);
      }

      // we are using the --no-lock flag for now, which unfortunately prints a warning, but should be OK
      // since rush already has its own install lock file which will invalidate the cache for us.
      // we theoretically could use the lock file, but we would need to clean the store if the
      // lockfile existed, otherwise PNPM would hang indefinitely. it is simpler to rely on Rush's
      // last install flag, which encapsulates the entire installation
      args.push('--no-lock');

      if (this._rushConfiguration.experimentsConfiguration.configuration.usePnpmFrozenLockfileForRushInstall &&
        !this._options.allowShrinkwrapUpdates) {
        if (semver.gte(this._rushConfiguration.packageManagerToolVersion, '3.0.0')) {
          args.push('--frozen-lockfile');
        } else {
          args.push('--frozen-shrinkwrap');
        }
      } else {
        // Ensure that Rush's tarball dependencies get synchronized properly with the pnpm-lock.yaml file.
        // See this GitHub issue: https://github.com/pnpm/pnpm/issues/1342
        if (semver.gte(this._rushConfiguration.packageManagerToolVersion, '3.0.0')) {
          args.push('--no-prefer-frozen-lockfile');
        } else {
          args.push('--no-prefer-frozen-shrinkwrap');
        }
      }

      if (options.collectLogFile) {
        args.push('--reporter', 'ndjson');
      }

      if (options.networkConcurrency) {
        args.push('--network-concurrency', options.networkConcurrency.toString());
      }

      if (this._rushConfiguration.pnpmOptions.strictPeerDependencies) {
        args.push('--strict-peer-dependencies');
      }

      if ((this._rushConfiguration.packageManagerWrapper as PnpmPackageManager).supportsResolutionStrategy) {
        args.push('--resolution-strategy', this._rushConfiguration.pnpmOptions.resolutionStrategy);
      }
    } else if (this._rushConfiguration.packageManager === 'yarn') {
      args.push('--link-folder', 'yarn-link');
      args.push('--cache-folder', this._rushConfiguration.yarnCacheFolder);

      // Without this option, Yarn will sometimes stop and ask for user input on STDIN
      // (e.g. "Which command would you like to run?").
      args.push('--non-interactive');

      if (options.networkConcurrency) {
        args.push('--network-concurrency', options.networkConcurrency.toString());
      }

      if (this._rushConfiguration.yarnOptions.ignoreEngines) {
        args.push('--ignore-engines');
      }
    }
  }

  /**
   * Copies the file "sourcePath" to "destinationPath", overwriting the target file location.
   * If the source file does not exist, then the target file is deleted.
   */
  private _syncFile(sourcePath: string, destinationPath: string): void {
    if (FileSystem.exists(sourcePath)) {
      console.log('Updating ' + destinationPath);
      FileSystem.copyFile({ sourcePath, destinationPath });
    } else {
      if (FileSystem.exists(destinationPath)) {
        console.log('Deleting ' + destinationPath);
        FileSystem.deleteFile(destinationPath);
      }
    }
  }

  /**
   * Gets the path to the tarball
   * Example: "C:\MyRepo\common\temp\projects\my-project-2.tgz"
   */
  private _getTarballFilePath(project: RushConfigurationProject): string {
    return path.join(
      this._rushConfiguration.commonTempFolder,
      RushConstants.rushTempProjectsFolderName,
      `${project.unscopedTempProjectName}.tgz`);
  }

  /**
   * This is a workaround for a bug introduced in NPM 5 (and still unfixed as of NPM 5.5.1):
   * https://github.com/npm/npm/issues/19006
   *
   * The regression is that "npm install" sets the package.json "version" field for the
   * @rush-temp projects to a value like "file:projects/example.tgz", when it should be "0.0.0".
   * This causes "rush link" to fail later, when read-package-tree tries to parse the bad version.
   * The error looks like this:
   *
   * ERROR: Failed to parse package.json for foo: Invalid version: "file:projects/example.tgz"
   *
   * Our workaround is to rewrite the package.json files for each of the @rush-temp projects
   * in the node_modules folder, after "npm install" completes.
   */
  private _fixupNpm5Regression(): void {
    const pathToDeleteWithoutStar: string = path.join(this._rushConfiguration.commonTempFolder,
      'node_modules', RushConstants.rushTempNpmScope);
    // Glob can't handle Windows paths
    const normalizedPathToDeleteWithoutStar: string = Text.replaceAll(pathToDeleteWithoutStar, '\\', '/');

    let anyChanges: boolean = false;

    // Example: "C:/MyRepo/common/temp/node_modules/@rush-temp/*/package.json"
    for (const packageJsonPath of glob.sync(globEscape(normalizedPathToDeleteWithoutStar) + '/*/package.json')) {
      // Example: "C:/MyRepo/common/temp/node_modules/@rush-temp/example/package.json"
      const packageJsonObject: IRushTempPackageJson = JsonFile.load(packageJsonPath);

      // The temp projects always use "0.0.0" as their version
      packageJsonObject.version = '0.0.0';

      if (JsonFile.save(packageJsonObject, packageJsonPath, { onlyIfChanged: true })) {
        anyChanges = true;
      }
    }

    if (anyChanges) {
      console.log(os.EOL + colors.yellow(Utilities.wrapWords(`Applied workaround for NPM 5 bug`)) + os.EOL);
    }
  }

  /**
   * Checks for temp projects that exist in the shrinkwrap file, but don't exist
   * in rush.json.  This might occur, e.g. if a project was recently deleted or renamed.
   *
   * @returns true if orphans were found, or false if everything is okay
   */
  private _findOrphanedTempProjects(shrinkwrapFile: BaseShrinkwrapFile): boolean {

    // We can recognize temp projects because they are under the "@rush-temp" NPM scope.
    for (const tempProjectName of shrinkwrapFile.getTempProjectNames()) {
      if (!this._rushConfiguration.findProjectByTempName(tempProjectName)) {
        console.log(os.EOL + colors.yellow(Utilities.wrapWords(
          `Your ${this._shrinkwrapFilePhrase} references a project "${tempProjectName}" which no longer exists.`))
          + os.EOL);
        return true;  // found one
      }
    }

    return false;  // none found
  }

  private get _shrinkwrapFilePhrase(): string {
    return this._rushConfiguration.shrinkwrapFilePhrase;
  }
}
