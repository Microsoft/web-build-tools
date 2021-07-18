// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * A library for writing scripts that interact with the {@link https://rushjs.io/ | Rush} tool.
 * @packageDocumentation
 */

export { ApprovedPackagesPolicy } from './api/ApprovedPackagesPolicy';

export {
  RushConfiguration,
  ITryFindRushJsonLocationOptions,
  IPackageManagerOptionsJsonBase,
  IConfigurationEnvironment,
  IConfigurationEnvironmentVariable,
  INpmOptionsJson as _INpmOptionsJson,
  IPnpmOptionsJson as _IPnpmOptionsJson,
  IYarnOptionsJson as _IYarnOptionsJson,
  PnpmStoreOptions,
  PackageManagerOptionsConfigurationBase,
  PnpmOptionsConfiguration,
  NpmOptionsConfiguration,
  YarnOptionsConfiguration
} from './api/RushConfiguration';

export { PackageManagerName, PackageManager } from './api/packageManager/PackageManager';

export { EnvironmentVariableNames } from './api/EnvironmentConfiguration';

export { IRushConfigurationProjectJson, RushConfigurationProject } from './api/RushConfigurationProject';

export { RushGlobalFolder as _RushGlobalFolder } from './api/RushGlobalFolder';

export { ApprovedPackagesItem, ApprovedPackagesConfiguration } from './api/ApprovedPackagesConfiguration';

export { CommonVersionsConfiguration } from './api/CommonVersionsConfiguration';

export { PackageJsonEditor, PackageJsonDependency, DependencyType } from './api/PackageJsonEditor';

export { RepoStateFile } from './logic/RepoStateFile';

export { EventHooks, Event } from './api/EventHooks';

export { ChangeManager } from './api/ChangeManager';

export { LastInstallFlag as _LastInstallFlag } from './api/LastInstallFlag';

export {
  VersionPolicyDefinitionName,
  BumpType,
  LockStepVersionPolicy,
  IndividualVersionPolicy,
  VersionPolicy
} from './api/VersionPolicy';

export { VersionPolicyConfiguration } from './api/VersionPolicyConfiguration';

export { ILaunchOptions, Rush } from './api/Rush';

export { ExperimentsConfiguration, IExperimentsJson } from './api/ExperimentsConfiguration';

export { ProjectChangeAnalyzer, IGetChangedProjectsOptions } from './logic/ProjectChangeAnalyzer';
