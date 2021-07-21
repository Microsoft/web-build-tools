// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Import, Sort } from '@rushstack/node-core-library';
import { BaseRushAction } from './BaseRushAction';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { SelectionParameterSet } from '../SelectionParameterSet';

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
  private _selectionParameters!: SelectionParameterSet;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'list',
      summary: 'List package information for all projects in the repo',
      documentation:
        'List package names, and optionally version (--version) and ' +
        'path (--path) or full path (--full-path), for projects in the ' +
        'current rush config.',
      parser
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
      description:
        'If this flag is specified, the project full path will ' +
        'be displayed in a column along with the package name.'
    });

    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If this flag is specified, output will be in JSON format.'
    });

    this._selectionParameters = new SelectionParameterSet(this.rushConfiguration, this);
  }

  protected async runAsync(): Promise<void> {
    const selection: Set<RushConfigurationProject> = this._selectionParameters.getSelectedProjects();
    Sort.sortSetBy(selection, (x) => x.packageName);

    if (this._jsonFlag.value) {
      this._printJson(selection);
    } else if (this._version.value || this._path.value || this._fullPath.value) {
      this._printListTable(selection);
    } else {
      this._printList(selection);
    }
  }

  private _printJson(selection: Set<RushConfigurationProject>): void {
    const projects: IJsonEntry[] = Array.from(selection, (config: RushConfigurationProject): IJsonEntry => {
      return {
        name: config.packageName,
        version: config.packageJson.version,
        path: config.projectRelativeFolder,
        fullPath: config.projectFolder
      };
    });

    const output: IJsonOutput = {
      projects
    };
    console.log(JSON.stringify(output, undefined, 2));
  }

  private _printList(selection: Set<RushConfigurationProject>): void {
    for (const project of selection) {
      console.log(project.packageName);
    }
  }

  private _printListTable(selection: Set<RushConfigurationProject>): void {
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

    for (const project of selection) {
      const packageRow: string[] = [project.packageName];
      if (this._version.value) {
        packageRow.push(project.packageJson.version);
      }
      if (this._path.value) {
        packageRow.push(project.projectRelativeFolder);
      }
      if (this._fullPath.value) {
        packageRow.push(project.projectFolder);
      }
      table.push(packageRow);
    }
    console.log(table.toString());
  }
}
