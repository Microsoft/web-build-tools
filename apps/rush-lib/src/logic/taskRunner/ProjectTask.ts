// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as child_process from 'child_process';
import * as path from 'path';
import * as process from 'process';
import { JsonFile, Text, FileSystem } from '@microsoft/node-core-library';
import { ITaskWriter } from '@microsoft/stream-collator';
import { IPackageDeps } from '@microsoft/package-deps-hash';

import { RushConfiguration } from '../../api/RushConfiguration';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { RushConstants } from '../../logic/RushConstants';
import { Utilities } from '../../utilities/Utilities';
import { TaskStatus } from './TaskStatus';
import { TaskError } from './TaskError';
import { ITaskDefinition } from '../taskRunner/ITask';
import {
  PackageChangeAnalyzer
} from '../PackageChangeAnalyzer';

interface IPackageDependencies extends IPackageDeps {
  arguments: string;
}

export interface IProjectTaskOptions {
  rushProject: RushConfigurationProject;
  rushConfiguration: RushConfiguration;
  commandToRun: string;
  customParameterValues: string[];
  isIncrementalBuildAllowed: boolean;
  ignoreMissingScript: boolean;
  packageChangeAnalyzer: PackageChangeAnalyzer;
}

/**
 * A TaskRunner task which cleans and builds a project
 */
export class ProjectTask implements ITaskDefinition {
  public get name(): string {
    return this._rushProject.packageName;
  }

  public isIncrementalBuildAllowed: boolean;
  public hadEmptyScript: boolean = false;

  private _hasWarningOrError: boolean;
  private _rushProject: RushConfigurationProject;
  private _rushConfiguration: RushConfiguration;
  private _commandToRun: string;
  private _customParameterValues: string[];
  private _ignoreMissingScript: boolean;
  private _packageChangeAnalyzer: PackageChangeAnalyzer;

  constructor(options: IProjectTaskOptions) {
    this._rushProject = options.rushProject;
    this._rushConfiguration = options.rushConfiguration;
    this._commandToRun = options.commandToRun;
    this._customParameterValues = options.customParameterValues;
    this.isIncrementalBuildAllowed = options.isIncrementalBuildAllowed;
    this._ignoreMissingScript = options.ignoreMissingScript;
    this._packageChangeAnalyzer = options.packageChangeAnalyzer;
  }

  public execute(writer: ITaskWriter): Promise<TaskStatus> {
    try {
      const taskCommand: string = this._getScriptToRun();
      const preCommand: string = this._getPreScriptToRun();
      const postCommand: string = this._getPostScriptToRun();
      if (!taskCommand) {
        this.hadEmptyScript = true;
      }
      const deps: IPackageDependencies | undefined = this._getPackageDependencies(taskCommand, writer);
      return this._executeTask(preCommand, writer, deps)
        .then(() => this._executeTask(taskCommand, writer, deps))
        .then(() => this._executeTask(postCommand, writer, deps));
    } catch (error) {
      return Promise.reject(new TaskError('executing', error.message));
    }
  }

  private _getPackageDependencies(taskCommand: string, writer: ITaskWriter): IPackageDependencies | undefined {
    let deps: IPackageDependencies | undefined = undefined;
    this._rushConfiguration = this._rushConfiguration;
    try {
      deps = {
        files: this._packageChangeAnalyzer.getPackageDepsHash(this._rushProject.packageName)!.files,
        arguments: taskCommand
      };
    } catch (error) {
      writer.writeLine('Unable to calculate incremental build state. ' +
        'Instead running full rebuild. ' + error.toString());
    }

    return deps;
  }

  private _executeTask(
    taskCommand: string,
    writer: ITaskWriter,
    currentPackageDeps: IPackageDependencies | undefined
  ): Promise<TaskStatus> {
    if (taskCommand === '') {
      return Promise.resolve(TaskStatus.Skipped);
    }
    try {
      this._hasWarningOrError = false;
      const projectFolder: string = this._rushProject.projectFolder;
      let lastPackageDeps: IPackageDependencies | undefined = undefined;

      writer.writeLine(`>>> ${this.name}`);

      const currentDepsPath: string = path.join(this._rushProject.projectFolder, RushConstants.packageDepsFilename);
      if (FileSystem.exists(currentDepsPath)) {
        try {
          lastPackageDeps = JsonFile.load(currentDepsPath) as IPackageDependencies;
        } catch (e) {
          // Warn and ignore - treat failing to load the file as the project being not built.
          writer.writeLine(
            `Warning: error parsing ${RushConstants.packageDepsFilename}: ${e}. Ignoring and ` +
            'treating the project as non-built.'
          );
        }
      }

      const isPackageUnchanged: boolean = (
        !!(
          lastPackageDeps &&
          currentPackageDeps &&
          (currentPackageDeps.arguments === lastPackageDeps.arguments &&
          _areShallowEqual(currentPackageDeps.files, lastPackageDeps.files, writer))
        )
      );

      if (isPackageUnchanged && this.isIncrementalBuildAllowed) {
        return Promise.resolve(TaskStatus.Skipped);
      } else {
        // If the deps file exists, remove it before starting a build.
        FileSystem.deleteFile(currentDepsPath);

        if (!taskCommand) {
          writer.writeLine(`The task command ${this._commandToRun} was registered in the package.json but is blank,`
            + ` so no action will be taken.`);

          // Write deps on success.
          if (currentPackageDeps) {
            JsonFile.save(currentPackageDeps, currentDepsPath);
          }

          return Promise.resolve(TaskStatus.Success);
        }

        // Run the task

        const normalizedTaskCommand: string = process.platform === 'win32'
          ? convertSlashesForWindows(taskCommand)
          : taskCommand;

        writer.writeLine(normalizedTaskCommand);
        const task: child_process.ChildProcess = Utilities.executeLifecycleCommandAsync(
          normalizedTaskCommand,
          {
            rushConfiguration: this._rushConfiguration,
            workingDirectory: projectFolder,
            initCwd: this._rushConfiguration.commonTempFolder,
            handleOutput: true,
            environmentPathOptions: {
              includeProjectBin: true
            }
          }
        );

        // Hook into events, in order to get live streaming of build log
        if (task.stdout !== null) {
          task.stdout.on('data', (data: string) => {
            writer.write(data);
          });
        }
        if (task.stderr !== null) {
          task.stderr.on('data', (data: string) => {
            writer.writeError(data);
            this._hasWarningOrError = true;
          });
        }

        return new Promise((resolve: (status: TaskStatus) => void, reject: (error: TaskError) => void) => {
          task.on('close', (code: number) => {
            this._writeLogsToDisk(writer);

            if (code !== 0) {
              reject(new TaskError('error', `Returned error code: ${code}`));
            } else if (this._hasWarningOrError) {
              resolve(TaskStatus.SuccessWithWarning);
            } else {
              // Write deps on success.
              if (currentPackageDeps) {
                JsonFile.save(currentPackageDeps, currentDepsPath);
              }
              resolve(TaskStatus.Success);
            }
          });
        });
      }
    } catch (error) {
      console.log(error);

      this._writeLogsToDisk(writer);
      return Promise.reject(new TaskError('error', error.toString()));
    }
  }

  private _getPreScriptToRun(): string {
    if (this._commandToRun.match(/^(pre|post).*/)) {
      return '';
    }
    const preCommandScript: string | undefined = this._getScriptCommand(
      `pre${this._commandToRun}`
    );
    return preCommandScript === undefined ? '' :
      `${preCommandScript} ${this._customParameterValues.join(' ')}`;
  }

  private _getPostScriptToRun(): string {
    if (this._commandToRun.match(/^(pre|post).*/)) {
      return '';
    }
    const postCommandScript: string | undefined = this._getScriptCommand(
      `post${this._commandToRun}`
    );
    return postCommandScript === undefined ? '' :
      `${postCommandScript} ${this._customParameterValues.join(' ')}`;
  }

  private _getScriptToRun(): string {
    const script: string | undefined = this._getScriptCommand(this._commandToRun);

    if (script === undefined && !this._ignoreMissingScript) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`The project [${this._rushProject.packageName}] does not define a '${this._commandToRun}' command in the 'scripts' section of its package.json`);
    }

    if (!script) {
      return '';
    }

    // TODO: Properly escape these strings
    return `${script} ${this._customParameterValues.join(' ')}`;
  }

  private _getScriptCommand(script: string): string | undefined {
    // tslint:disable-next-line:no-string-literal
    if (!this._rushProject.packageJson.scripts) {
      return undefined;
    }

    const rawCommand: string = this._rushProject.packageJson.scripts[script];

    // tslint:disable-next-line:no-null-keyword
    if (rawCommand === undefined || rawCommand === null) {
      return undefined;
    }

    return rawCommand;
  }

  // @todo #179371: add log files to list of things that get gulp cleaned
  private _writeLogsToDisk(writer: ITaskWriter): void {
    try {
      const logFilename: string = path.basename(this._rushProject.projectFolder);

      const stdout: string = writer.getStdOutput().replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '');
      if (stdout) {
        FileSystem.writeFile(path.join(this._rushProject.projectFolder, logFilename + '.build.log'), stdout);
      }

      const stderr: string = writer.getStdError().replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '');
      if (stderr) {
        FileSystem.writeFile(path.join(this._rushProject.projectFolder, logFilename + '.build.error.log'), stderr);
      }
    } catch (e) {
      console.log(`Error writing logs to disk: ${e}`);
    }
  }
}

function _areShallowEqual(object1: Object, object2: Object, writer: ITaskWriter): boolean {
  for (const n in object1) {
    if (!(n in object2) || object1[n] !== object2[n]) {
      writer.writeLine(`Found mismatch: "${n}": "${object1[n]}" !== "${object2[n]}"`);
      return false;
    }
  }
  for (const n in object2) {
    if (!(n in object1)) {
      writer.writeLine(`Found new prop in obj2: "${n}" value="${object2[n]}"`);
      return false;
    }
  }
  return true;
}

/**
 * When running a command from the "scripts" block in package.json, if the command
 * contains Unix-style path slashes and the OS is Windows, the package managers will
 * convert slashes to backslashes.  This is a complicated undertaking.  For example, they
 * need to convert "node_modules/bin/this && ./scripts/that --name keep/this"
 * to "node_modules\bin\this && .\scripts\that --name keep/this", and they don't want to
 * convert ANY of the slashes in "cmd.exe /c echo a/b".  NPM and PNPM use npm-lifecycle for this,
 * but it unfortunately has a dependency on the entire node-gyp kitchen sink.  Yarn has a
 * simplified implementation in fix-cmd-win-slashes.js, but it's not exposed as a library.
 *
 * Fundamentally NPM's whole feature seems misguided:  They start by inviting people to write
 * shell scripts that will be executed by wildly different shell languages (e.g. cmd.exe and Bash).
 * It's very tricky for a developer to guess what's safe to do without testing every OS.
 * Even simple path separators are not portable, so NPM added heuristics to figure out which
 * slashes are part of a path or not, and convert them.  These workarounds end up having tons
 * of special cases.  They probably could have implemented their own entire minimal cross-platform
 * shell language with less code and less confusion than npm-lifecycle's approach.
 *
 * We've deprecated shell operators inside package.json.  Instead, we advise people to move their
 * scripts into conventional script files, and put only a file path in package.json.  So, for
 * Rush's workaround here, we really only care about supporting the small set of cases seen in the
 * unit tests.  For anything that doesn't fit those patterns, we leave the string untouched
 * (i.e. err on the side of not breaking anything).  We could revisit this later if someone
 * complains about it, but so far nobody has.  :-)
 */
export function convertSlashesForWindows(command: string): string {
  // The first group will match everything up to the first space, "&", "|", "<", ">", or quote.
  // The second group matches the remainder.
  const commandRegExp: RegExp = /^([^\s&|<>"]+)(.*)$/;

  const match: RegExpMatchArray | null = commandRegExp.exec(command);
  if (match) {
    // Example input: "bin/blarg --path ./config/blah.json && a/b"
    // commandPart="bin/blarg"
    // remainder=" --path ./config/blah.json && a/b"
    const commandPart: string = match[1];
    const remainder: string = match[2];

    // If the command part already contains a backslash, then leave it alone
    if (commandPart.indexOf('\\') < 0) {
      // Replace all the slashes with backslashes, e.g. to produce:
      // "bin\blarg --path ./config/blah.json && a/b"
      //
      // NOTE: we don't attempt to process the path parameter or stuff after "&&"
      return Text.replaceAll(commandPart, '/', '\\') + remainder;
    }
  }

  // Don't change anything
  return command;
}
