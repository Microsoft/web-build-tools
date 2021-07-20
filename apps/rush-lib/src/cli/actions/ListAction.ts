// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Import } from '@rushstack/node-core-library';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';

const cliTable: typeof import('cli-table') = Import.lazy('cli-table', require);

export interface IJsonEntry {
  name: string;
  version: string;
  path: string;
  fullPath: string;
}

export interface IJsonOutput {
  projects: IJsonEntry[];
}

export class ListAction extends BaseRushAction {
  private _version!: CommandLineFlagParameter;
  private _path!: CommandLineFlagParameter;
  private _fullPath!: CommandLineFlagParameter;
  private _jsonFlag!: CommandLineFlagParameter;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'list',
      summary: 'List package information for all projects in the repo',
      documentation:
        'List package names, and optionally version (--version) and ' +
        'path (--path) or full path (--full-path), for projects in the ' +
        'current rush config.',
      parser,
      suppressStartupBanner: true
    });
  }

  protected onDefineParameters(): void {
    this._version = this.defineFlagParameter({
      parameterLongName: '--version',
      parameterShortName: '-v',
      description:
        'If this flag is specified, the project version will be ' +
        'displayed in a column along with the package name.'
    });

    this._path = this.defineFlagParameter({
      parameterLongName: '--path',
      parameterShortName: '-p',
      description:
        'If this flag is specified, the project path will be ' +
        'displayed in a column along with the package name.'
    });

    this._fullPath = this.defineFlagParameter({
      parameterLongName: '--full-path',
      parameterShortName: '-f',
      description:
        'If this flag is specified, the project full path will ' +
        'be displayed in a column along with the package name.'
    });

    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If this flag is specified, output will be in JSON format.'
    });
  }

  protected async runAsync(): Promise<void> {
    const allPackages: Map<string, RushConfigurationProject> = this.rushConfiguration.projectsByName;
    if (this._jsonFlag.value) {
      this._printJson(allPackages);
    } else if (this._version.value || this._path.value || this._fullPath.value) {
      this._printListTable(allPackages);
    } else {
      this._printList(allPackages);
    }
  }

  private _printJson(allPackages: Map<string, RushConfigurationProject>): void {
    const projects: IJsonEntry[] = [];
    allPackages.forEach((config: RushConfigurationProject, name: string) => {
      const project: IJsonEntry = {
        name: name,
        version: config.packageJson.version,
        path: config.projectRelativeFolder,
        fullPath: config.projectFolder
      };
      projects.push(project);
    });

    const output: IJsonOutput = {
      projects
    };
    console.log(JSON.stringify(output, undefined, 2));
  }

  private _printList(allPackages: Map<string, RushConfigurationProject>): void {
    allPackages.forEach((config: RushConfigurationProject, name: string) => {
      console.log(name);
    });
  }

  private _printListTable(allPackages: Map<string, RushConfigurationProject>): void {
    const tableHeader: string[] = ['Project'];
    if (this._version.value) {
      tableHeader.push('Version');
    }
    if (this._path.value) {
      tableHeader.push('Path');
    }
    if (this._fullPath.value) {
      tableHeader.push('Full Path');
    }

    // eslint-disable-next-line @typescript-eslint/typedef
    const table = new cliTable({
      head: tableHeader
    });

    allPackages.forEach((config: RushConfigurationProject, name: string) => {
      const packageRow: string[] = [name];
      if (this._version.value) {
        packageRow.push(config.packageJson.version);
      }
      if (this._path.value) {
        packageRow.push(config.projectRelativeFolder);
      }
      if (this._fullPath.value) {
        packageRow.push(config.projectFolder);
      }
      table.push(packageRow);
    });
    console.log(table.toString());
  }
}
