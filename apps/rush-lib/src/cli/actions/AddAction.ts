// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as os from 'os';
import * as semver from 'semver';

import {
  CommandLineFlagParameter,
  CommandLineStringParameter
} from '@microsoft/ts-command-line';

import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { PackageJsonUpdater, SemVerStyle } from '../../logic/PackageJsonUpdater';
import { PackageName } from '@microsoft/node-core-library';

export class AddAction extends BaseRushAction {
  private _exactFlag: CommandLineFlagParameter;
  private _caretFlag: CommandLineFlagParameter;
  private _devDependencyFlag: CommandLineFlagParameter;
  private _makeConsistentFlag: CommandLineFlagParameter;
  private _skipUpdateFlag: CommandLineFlagParameter;
  private _packageName: CommandLineStringParameter;
  private _versionSpecifier: CommandLineStringParameter;

  constructor(parser: RushCommandLineParser) {
    const documentation: string[] = [
      'Adds a specified package as a dependency of the current project (as determined by the current working directory)'
      + ' and then runs "rush update". If no version is specified, a version will be automatically detected (typically'
      + ' either the latest version or a version that won\'t break the "ensureConsistentVersions" policy). If a version'
      + ' range is specified, the latest version in the range will be used. The version will be automatically prepended'
      + ' with a tilde, unless the "--exact" or "--caret" flags are used. The "--make-consistent" flag can be used to'
      + ' update all packages with the dependency.'
    ];
    super({
      actionName: 'add',
      summary: 'Adds a dependency to the package.json and runs rush upgrade.',
      documentation: documentation.join(os.EOL),
      safeForSimultaneousRushProcesses: false,
      parser
    });
  }

  public onDefineParameters(): void {
    this._packageName = this.defineStringParameter({
      parameterLongName: '--package',
      parameterShortName: '-p',
      required: true,
      argumentName: 'PACKAGE_NAME',
      description: '(Required) The name of the package which should be added as a dependency.'
        + ' Also, the version specifier can be appended after an "@" sign (similar to NPM\'s semantics).'
    });
    this._exactFlag = this.defineFlagParameter({
      parameterLongName: '--exact',
      description: 'If specified, the SemVer specifier added to the'
        + ' package.json will be an exact version (e.g. without tilde or caret).'
    });
    this._caretFlag = this.defineFlagParameter({
      parameterLongName: '--caret',
      description: 'If specified, the SemVer specifier added to the'
        + ' package.json will be a prepended with a "caret" specifier ("^").'
    });
    this._devDependencyFlag = this.defineFlagParameter({
      parameterLongName: '--dev',
      description: 'If specified, the package will be added to the "devDependencies" section of'
        + ' the package.json'
    });
    this._makeConsistentFlag = this.defineFlagParameter({
      parameterLongName: '--make-consistent',
      parameterShortName: '-m',
      description: 'If specified, other packages with this dependency will have their package.json'
        + ' files updated to use the same version of the dependency.'
    });
    this._skipUpdateFlag = this.defineFlagParameter({
      parameterLongName: '--skip-update',
      parameterShortName: '-s',
      description: 'If specified, the "rush update" command will not be run after updating the'
        + ' package.json files.'
    });
  }

  public run(): Promise<void> {
    const project: RushConfigurationProject | undefined
      = this.rushConfiguration.getProjectForPath(process.cwd());

    if (!project) {
      return Promise.reject(new Error('The "rush add" command must be invoked under a project'
        + ' folder that is registered in rush.json.'));
    }

    if (this._caretFlag.value && this._exactFlag.value) {
      return Promise.reject(new Error('Only one of "--caret" and "--exact" should be specified'));
    }

    const packageName: string = this._packageName.value!;
    if (!PackageName.isValidName(packageName)) {
      return Promise.reject(new Error(`The package name "${packageName}" is not valid.`));
    }

    const version: string | undefined = this._versionSpecifier.value;
    if (version && !semver.validRange(version) && !semver.valid(version)) {
      return Promise.reject(new Error(`The SemVer specifier "${version}" is not valid.`));
    }

    return new PackageJsonUpdater(this.rushConfiguration).doRushAdd({
      currentProject: project,
      packageName: packageName,
      initialVersion: version,
      devDependency: this._devDependencyFlag.value,
      updateOtherPackages: this._makeConsistentFlag.value,
      skipUpdate: this._skipUpdateFlag.value,
      debugInstall: this.parser.isDebug,
      rangeStyle: this._caretFlag.value ? SemVerStyle.Caret
        : (this._exactFlag.value ? SemVerStyle.Exact : SemVerStyle.Tilde)
    });
  }
}
