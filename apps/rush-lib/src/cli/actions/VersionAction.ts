// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as semver from 'semver';
import { IPackageJson, FileConstants, Import, Enum } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, CommandLineStringParameter } from '@rushstack/ts-command-line';

import { BumpType, LockStepVersionPolicy } from '../../api/VersionPolicy';
import { VersionPolicyConfiguration } from '../../api/VersionPolicyConfiguration';
import { RushConfiguration } from '../../api/RushConfiguration';
import { VersionMismatchFinder } from '../../logic/versionMismatch/VersionMismatchFinder';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { PolicyValidator } from '../../logic/policy/PolicyValidator';
import { BaseRushAction } from './BaseRushAction';
import { PublishGit } from '../../logic/PublishGit';
import { Git } from '../../logic/Git';

import type * as VersionManagerTypes from '../../logic/VersionManager';
const versionManagerModule: typeof VersionManagerTypes = Import.lazy('../../logic/VersionManager', require);

export const DEFAULT_PACKAGE_UPDATE_MESSAGE: string = 'Bump versions [skip ci]';
export const DEFAULT_CHANGELOG_UPDATE_MESSAGE: string = 'Update changelogs [skip ci]';

export class VersionAction extends BaseRushAction {
  private _ensureVersionPolicy!: CommandLineFlagParameter;
  private _overrideVersion!: CommandLineStringParameter;
  private _bumpVersion!: CommandLineFlagParameter;
  private _versionPolicy!: CommandLineStringParameter;
  private _bypassPolicy!: CommandLineFlagParameter;
  private _targetBranch!: CommandLineStringParameter;
  private _overwriteBump!: CommandLineStringParameter;
  private _prereleaseIdentifier!: CommandLineStringParameter;
  private _ignoreGitHooksParameter!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'version',
      summary: 'Manage package versions in the repo.',
      documentation: 'use this "rush version" command to ensure version policies and bump versions.',
      parser
    });
  }

  protected onDefineParameters(): void {
    this._targetBranch = this.defineStringParameter({
      parameterLongName: '--target-branch',
      parameterShortName: '-b',
      argumentName: 'BRANCH',
      description: 'If this flag is specified, changes will be committed and merged into the target branch.'
    });
    this._ensureVersionPolicy = this.defineFlagParameter({
      parameterLongName: '--ensure-version-policy',
      description: 'Updates package versions if needed to satisfy version policies.'
    });
    this._overrideVersion = this.defineStringParameter({
      parameterLongName: '--override-version',
      argumentName: 'NEW_VERSION',
      description:
        'Override the version in the specified --version-policy. ' +
        'This setting only works for lock-step version policy and when --ensure-version-policy is specified.'
    });
    this._bumpVersion = this.defineFlagParameter({
      parameterLongName: '--bump',
      description: 'Bumps package version based on version policies.'
    });
    this._bypassPolicy = this.defineFlagParameter({
      parameterLongName: '--bypass-policy',
      description: 'Overrides "gitPolicy" enforcement (use honorably!)'
    });
    this._versionPolicy = this.defineStringParameter({
      parameterLongName: '--version-policy',
      argumentName: 'POLICY',
      description: 'The name of the version policy'
    });
    this._overwriteBump = this.defineStringParameter({
      parameterLongName: '--override-bump',
      argumentName: 'BUMPTYPE',
      description:
        'Overrides the bump type in the version-policy.json for the specified version policy. ' +
        'Valid BUMPTYPE values include: prerelease, patch, preminor, minor, major. ' +
        'This setting only works for lock-step version policy in bump action.'
    });
    this._prereleaseIdentifier = this.defineStringParameter({
      parameterLongName: '--override-prerelease-id',
      argumentName: 'ID',
      description:
        'Overrides the prerelease identifier in the version value of version-policy.json ' +
        'for the specified version policy. ' +
        'This setting only works for lock-step version policy. ' +
        'This setting increases to new prerelease id when "--bump" is provided but only replaces the ' +
        'prerelease name when "--ensure-version-policy" is provided.'
    });
    this._ignoreGitHooksParameter = this.defineFlagParameter({
      parameterLongName: '--ignore-git-hooks',
      description: `Skips execution of all git hooks. Make sure you know what you are skipping.`
    });
  }

  protected async runAsync(): Promise<void> {
    PolicyValidator.validatePolicy(this.rushConfiguration, { bypassPolicy: this._bypassPolicy.value });
    const git: Git = new Git(this.rushConfiguration);
    const userEmail: string = git.getGitEmail();

    this._validateInput();
    const versionManager: VersionManagerTypes.VersionManager = new versionManagerModule.VersionManager(
      this.rushConfiguration,
      userEmail,
      this.rushConfiguration.versionPolicyConfiguration
    );

    if (this._ensureVersionPolicy.value) {
      this._overwritePolicyVersionIfNeeded();
      const tempBranch: string = 'version/ensure-' + new Date().getTime();
      versionManager.ensure(
        this._versionPolicy.value,
        true,
        !!this._overrideVersion.value || !!this._prereleaseIdentifier.value
      );

      const updatedPackages: Map<string, IPackageJson> = versionManager.updatedProjects;
      if (updatedPackages.size > 0) {
        console.log(`${updatedPackages.size} packages are getting updated.`);
        this._gitProcess(tempBranch, this._targetBranch.value);
      }
    } else if (this._bumpVersion.value) {
      const tempBranch: string = 'version/bump-' + new Date().getTime();
      await versionManager.bumpAsync(
        this._versionPolicy.value,
        this._overwriteBump.value ? Enum.getValueByKey(BumpType, this._overwriteBump.value) : undefined,
        this._prereleaseIdentifier.value,
        true
      );
      this._gitProcess(tempBranch, this._targetBranch.value);
    }
  }

  private _overwritePolicyVersionIfNeeded(): void {
    if (!this._overrideVersion.value && !this._prereleaseIdentifier.value) {
      // No need to overwrite policy version
      return;
    }
    if (this._overrideVersion.value && this._prereleaseIdentifier.value) {
      throw new Error(
        `The parameters "--override-version" and "--override-prerelease-id" cannot be used together.`
      );
    }

    if (this._versionPolicy.value) {
      const versionConfig: VersionPolicyConfiguration = this.rushConfiguration.versionPolicyConfiguration;
      const policy: LockStepVersionPolicy = versionConfig.getVersionPolicy(
        this._versionPolicy.value
      ) as LockStepVersionPolicy;
      if (!policy || !policy.isLockstepped) {
        throw new Error(`The lockstep version policy "${policy.policyName}" is not found.`);
      }
      let newVersion: string | undefined = undefined;
      if (this._overrideVersion.value) {
        newVersion = this._overrideVersion.value;
      } else if (this._prereleaseIdentifier.value) {
        const newPolicyVersion: semver.SemVer = new semver.SemVer(policy.version);
        if (newPolicyVersion.prerelease.length) {
          // Update 1.5.0-alpha.10 to 1.5.0-beta.10
          // For example, if we are parsing "1.5.0-alpha.10" then the newPolicyVersion.prerelease array
          // would contain [ "alpha", 10 ], so we would replace "alpha" with "beta"
          newPolicyVersion.prerelease = [
            this._prereleaseIdentifier.value,
            ...newPolicyVersion.prerelease.slice(1)
          ];
        } else {
          // Update 1.5.0 to 1.5.0-beta
          // Since there is no length, we can just set to a new array
          newPolicyVersion.prerelease = [this._prereleaseIdentifier.value];
        }
        newVersion = newPolicyVersion.format();
      }

      if (newVersion) {
        console.log(`Update version policy ${policy.policyName} from ${policy.version} to ${newVersion}`);
        versionConfig.update(this._versionPolicy.value, newVersion);
      }
    } else {
      throw new Error(
        'Missing --version-policy parameter to specify which version policy should be overwritten.'
      );
    }
  }

  private _validateInput(): void {
    if (this._bumpVersion.value && this._ensureVersionPolicy.value) {
      throw new Error('Please choose --bump or --ensure-version-policy but not together.');
    }

    if (this._overwriteBump.value && !Enum.tryGetValueByKey(BumpType, this._overwriteBump.value)) {
      throw new Error(
        'The value of override-bump is not valid.  ' +
          'Valid values include prerelease, patch, preminor, minor, and major'
      );
    }
  }

  private _validateResult(): void {
    // Load the config from file to avoid using inconsistent in-memory data.
    const rushConfig: RushConfiguration = RushConfiguration.loadFromConfigurationFile(
      this.rushConfiguration.rushJsonFile
    );

    const mismatchFinder: VersionMismatchFinder = VersionMismatchFinder.getMismatches(rushConfig);
    if (mismatchFinder.numberOfMismatches) {
      throw new Error(
        'Unable to finish version bump because inconsistencies were encountered. ' +
          'Run "rush check" to find more details.'
      );
    }
  }

  private _gitProcess(tempBranch: string, targetBranch: string | undefined): void {
    // Validate the result before commit.
    this._validateResult();

    const git: Git = new Git(this.rushConfiguration);
    const publishGit: PublishGit = new PublishGit(git, targetBranch);

    // Make changes in temp branch.
    publishGit.checkout(tempBranch, true);

    const uncommittedChanges: ReadonlyArray<string> = git.getUncommittedChanges();

    // Stage, commit, and push the changes to remote temp branch.
    // Need to commit the change log updates in its own commit
    const changeLogUpdated: boolean = uncommittedChanges.some((changePath) => {
      return changePath.indexOf('CHANGELOG.json') > 0;
    });

    if (changeLogUpdated) {
      publishGit.addChanges('.', this.rushConfiguration.changesFolder);
      publishGit.addChanges(':/**/CHANGELOG.json');
      publishGit.addChanges(':/**/CHANGELOG.md');
      publishGit.commit(
        this.rushConfiguration.gitChangeLogUpdateCommitMessage || DEFAULT_CHANGELOG_UPDATE_MESSAGE,
        !this._ignoreGitHooksParameter.value
      );
    }

    // Commit the package.json and change files updates.
    const packageJsonUpdated: boolean = uncommittedChanges.some((changePath) => {
      return changePath.indexOf(FileConstants.PackageJson) > 0;
    });

    if (packageJsonUpdated) {
      publishGit.addChanges(this.rushConfiguration.versionPolicyConfigurationFilePath);
      publishGit.addChanges(':/**/package.json');
      publishGit.commit(
        this.rushConfiguration.gitVersionBumpCommitMessage || DEFAULT_PACKAGE_UPDATE_MESSAGE,
        !this._ignoreGitHooksParameter.value
      );
    }

    if (changeLogUpdated || packageJsonUpdated) {
      publishGit.push(tempBranch, !this._ignoreGitHooksParameter.value);

      // Now merge to target branch.
      publishGit.fetch();
      publishGit.checkout(targetBranch);
      publishGit.pull(!this._ignoreGitHooksParameter.value);
      publishGit.merge(tempBranch, !this._ignoreGitHooksParameter.value);
      publishGit.push(targetBranch, !this._ignoreGitHooksParameter.value);
      publishGit.deleteBranch(tempBranch, true, !this._ignoreGitHooksParameter.value);
    } else {
      // skip commits
      publishGit.fetch();
      publishGit.checkout(targetBranch);
      publishGit.deleteBranch(tempBranch, false, !this._ignoreGitHooksParameter.value);
    }
  }
}
