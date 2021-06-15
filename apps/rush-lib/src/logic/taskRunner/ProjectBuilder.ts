// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as child_process from 'child_process';
import * as path from 'path';
import {
  JsonFile,
  Text,
  FileSystem,
  JsonObject,
  NewlineKind,
  InternalError
} from '@rushstack/node-core-library';
import {
  TerminalChunkKind,
  TextRewriterTransform,
  StderrLineTransform,
  SplitterTransform,
  DiscardStdoutTransform,
  Terminal,
  ITerminal
} from '@rushstack/terminal';
import { CollatedTerminal } from '@rushstack/stream-collator';

import { RushConfiguration } from '../../api/RushConfiguration';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { Utilities } from '../../utilities/Utilities';
import { TaskStatus } from './TaskStatus';
import { TaskError } from './TaskError';
import { PackageChangeAnalyzer } from '../PackageChangeAnalyzer';
import { BaseBuilder, IBuilderContext } from './BaseBuilder';
import { ProjectLogWritable } from './ProjectLogWritable';
import { ProjectBuildCache } from '../buildCache/ProjectBuildCache';
import { BuildCacheConfiguration } from '../../api/BuildCacheConfiguration';
import { ICacheOptionsForCommand, RushProjectConfiguration } from '../../api/RushProjectConfiguration';
import { CollatedTerminalProvider } from '../../utilities/CollatedTerminalProvider';
import { CommandLineConfiguration } from '../../api/CommandLineConfiguration';
import { RushConstants } from '../RushConstants';

export interface IProjectBuildDeps {
  files: { [filePath: string]: string };
  arguments: string;
}

export interface IProjectBuilderOptions {
  rushProject: RushConfigurationProject;
  rushConfiguration: RushConfiguration;
  buildCacheConfiguration: BuildCacheConfiguration | undefined;
  commandToRun: string;
  commandName: string;
  isIncrementalBuildAllowed: boolean;
  packageChangeAnalyzer: PackageChangeAnalyzer;
  packageDepsFilename: string;
}

function _areShallowEqual(object1: JsonObject, object2: JsonObject): boolean {
  for (const n in object1) {
    if (!(n in object2) || object1[n] !== object2[n]) {
      return false;
    }
  }
  for (const n in object2) {
    if (!(n in object1)) {
      return false;
    }
  }
  return true;
}

const UNINITIALIZED: 'UNINITIALIZED' = 'UNINITIALIZED';
type UNINITIALIZED = 'UNINITIALIZED';

/**
 * A `BaseBuilder` subclass that builds a Rush project and updates its package-deps-hash
 * incremental state.
 */
export class ProjectBuilder extends BaseBuilder {
  public get name(): string {
    return ProjectBuilder.getTaskName(this._rushProject);
  }

  public readonly isIncrementalBuildAllowed: boolean;
  public hadEmptyScript: boolean = false;

  private readonly _rushProject: RushConfigurationProject;
  private readonly _rushConfiguration: RushConfiguration;
  private readonly _buildCacheConfiguration: BuildCacheConfiguration | undefined;
  private readonly _commandName: string;
  private readonly _commandToRun: string;
  private readonly _packageChangeAnalyzer: PackageChangeAnalyzer;
  private readonly _packageDepsFilename: string;

  /**
   * UNINITIALIZED === we haven't tried to initialize yet
   * undefined === we didn't create one because the feature is not enabled
   */
  private _projectBuildCache: ProjectBuildCache | undefined | UNINITIALIZED = UNINITIALIZED;

  public constructor(options: IProjectBuilderOptions) {
    super();
    this._rushProject = options.rushProject;
    this._rushConfiguration = options.rushConfiguration;
    this._buildCacheConfiguration = options.buildCacheConfiguration;
    this._commandName = options.commandName;
    this._commandToRun = options.commandToRun;
    this.isIncrementalBuildAllowed = options.isIncrementalBuildAllowed;
    this._packageChangeAnalyzer = options.packageChangeAnalyzer;
    this._packageDepsFilename = options.packageDepsFilename;
  }

  /**
   * A helper method to determine the task name of a ProjectBuilder. Used when the task
   * name is required before a task is created.
   */
  public static getTaskName(rushProject: RushConfigurationProject): string {
    return rushProject.packageName;
  }

  public async executeAsync(context: IBuilderContext): Promise<TaskStatus> {
    try {
      if (!this._commandToRun) {
        this.hadEmptyScript = true;
      }
      return await this._executeTaskAsync(context);
    } catch (error) {
      throw new TaskError('executing', error.message);
    }
  }

  public async tryWriteCacheEntryAsync(
    terminal: ITerminal,
    trackedFilePaths: string[] | undefined,
    repoCommandLineConfiguration: CommandLineConfiguration | undefined
  ): Promise<boolean | undefined> {
    const projectBuildCache: ProjectBuildCache | undefined = await this._getProjectBuildCacheAsync(
      terminal,
      trackedFilePaths,
      repoCommandLineConfiguration
    );
    return projectBuildCache?.trySetCacheEntryAsync(terminal);
  }

  private async _executeTaskAsync(context: IBuilderContext): Promise<TaskStatus> {
    // TERMINAL PIPELINE:
    //
    //                             +--> quietModeTransform? --> collatedWriter
    //                             |
    // normalizeNewlineTransform --1--> stderrLineTransform --2--> removeColorsTransform --> projectLogWritable
    //                                                        |
    //                                                        +--> stdioSummarizer
    const projectLogWritable: ProjectLogWritable = new ProjectLogWritable(
      this._rushProject,
      context.collatedWriter.terminal
    );

    try {
      const removeColorsTransform: TextRewriterTransform = new TextRewriterTransform({
        destination: projectLogWritable,
        removeColors: true,
        normalizeNewlines: NewlineKind.OsDefault
      });

      const splitterTransform2: SplitterTransform = new SplitterTransform({
        destinations: [removeColorsTransform, context.stdioSummarizer]
      });

      const stderrLineTransform: StderrLineTransform = new StderrLineTransform({
        destination: splitterTransform2,
        newlineKind: NewlineKind.Lf // for StdioSummarizer
      });

      const quietModeTransform: DiscardStdoutTransform = new DiscardStdoutTransform({
        destination: context.collatedWriter
      });

      const splitterTransform1: SplitterTransform = new SplitterTransform({
        destinations: [context.quietMode ? quietModeTransform : context.collatedWriter, stderrLineTransform]
      });

      const normalizeNewlineTransform: TextRewriterTransform = new TextRewriterTransform({
        destination: splitterTransform1,
        normalizeNewlines: NewlineKind.Lf,
        ensureNewlineAtEnd: true
      });

      const collatedTerminal: CollatedTerminal = new CollatedTerminal(normalizeNewlineTransform);
      const terminalProvider: CollatedTerminalProvider = new CollatedTerminalProvider(collatedTerminal);
      const terminal: ITerminal = new Terminal(terminalProvider);

      let hasWarningOrError: boolean = false;
      const projectFolder: string = this._rushProject.projectFolder;
      let lastProjectBuildDeps: IProjectBuildDeps | undefined = undefined;

      const currentDepsPath: string = path.join(
        this._rushProject.projectRushTempFolder,
        this._packageDepsFilename
      );

      if (FileSystem.exists(currentDepsPath)) {
        try {
          lastProjectBuildDeps = JsonFile.load(currentDepsPath);
        } catch (e) {
          // Warn and ignore - treat failing to load the file as the project being not built.
          terminal.writeWarningLine(
            `Warning: error parsing ${this._packageDepsFilename}: ${e}. Ignoring and ` +
              `treating the command "${this._commandToRun}" as not run.`
          );
        }
      }

      let projectBuildDeps: IProjectBuildDeps | undefined;
      let trackedFiles: string[] | undefined;
      try {
        const fileHashes: Map<string, string> | undefined = await this._packageChangeAnalyzer.getPackageDeps(
          this._rushProject.packageName,
          terminal
        );

        if (fileHashes) {
          const files: { [filePath: string]: string } = {};
          trackedFiles = [];
          for (const [filePath, fileHash] of fileHashes) {
            files[filePath] = fileHash;
            trackedFiles.push(filePath);
          }

          projectBuildDeps = {
            files,
            arguments: this._commandToRun
          };
        } else {
          terminal.writeLine(
            'Unable to calculate incremental build state. Instead running full rebuild. Ensure Git is present.'
          );
        }
      } catch (error) {
        terminal.writeLine(
          'Error calculating incremental build state. Instead running full rebuild. ' + error.toString()
        );
      }

      const isPackageUnchanged: boolean = !!(
        lastProjectBuildDeps &&
        projectBuildDeps &&
        projectBuildDeps.arguments === lastProjectBuildDeps.arguments &&
        _areShallowEqual(projectBuildDeps.files, lastProjectBuildDeps.files)
      );

      const projectBuildCache: ProjectBuildCache | undefined = await this._getProjectBuildCacheAsync(
        terminal,
        trackedFiles,
        context.repoCommandLineConfiguration
      );
      const restoreFromCacheSuccess: boolean | undefined = await projectBuildCache?.tryRestoreFromCacheAsync(
        terminal
      );

      if (restoreFromCacheSuccess) {
        return TaskStatus.FromCache;
      } else if (isPackageUnchanged && this.isIncrementalBuildAllowed) {
        return TaskStatus.Skipped;
      } else {
        // If the deps file exists, remove it before starting a build.
        FileSystem.deleteFile(currentDepsPath);

        // TODO: Remove legacyDepsPath with the next major release of Rush
        const legacyDepsPath: string = path.join(this._rushProject.projectFolder, 'package-deps.json');
        // Delete the legacy package-deps.json
        FileSystem.deleteFile(legacyDepsPath);

        if (!this._commandToRun) {
          // Write deps on success.
          if (projectBuildDeps) {
            JsonFile.save(projectBuildDeps, currentDepsPath, {
              ensureFolderExists: true
            });
          }

          return TaskStatus.Success;
        }

        // Run the task
        terminal.writeLine('Invoking: ' + this._commandToRun);

        const task: child_process.ChildProcess = Utilities.executeLifecycleCommandAsync(this._commandToRun, {
          rushConfiguration: this._rushConfiguration,
          workingDirectory: projectFolder,
          initCwd: this._rushConfiguration.commonTempFolder,
          handleOutput: true,
          environmentPathOptions: {
            includeProjectBin: true
          }
        });

        // Hook into events, in order to get live streaming of build log
        if (task.stdout !== null) {
          task.stdout.on('data', (data: Buffer) => {
            const text: string = data.toString();
            collatedTerminal.writeChunk({ text, kind: TerminalChunkKind.Stdout });
          });
        }
        if (task.stderr !== null) {
          task.stderr.on('data', (data: Buffer) => {
            const text: string = data.toString();
            collatedTerminal.writeChunk({ text, kind: TerminalChunkKind.Stderr });
            hasWarningOrError = true;
          });
        }

        let status: TaskStatus = await new Promise(
          (resolve: (status: TaskStatus) => void, reject: (error: TaskError) => void) => {
            task.on('close', (code: number) => {
              try {
                if (code !== 0) {
                  reject(new TaskError('error', `Returned error code: ${code}`));
                } else if (hasWarningOrError) {
                  resolve(TaskStatus.SuccessWithWarning);
                } else {
                  resolve(TaskStatus.Success);
                }
              } catch (error) {
                reject(error);
              }
            });
          }
        );

        if (status === TaskStatus.Success && projectBuildDeps) {
          // Write deps on success.
          const writeProjectStatePromise: Promise<boolean> = JsonFile.saveAsync(
            projectBuildDeps,
            currentDepsPath,
            {
              ensureFolderExists: true
            }
          );

          const setCacheEntryPromise: Promise<boolean | undefined> = this.tryWriteCacheEntryAsync(
            terminal,
            trackedFiles,
            context.repoCommandLineConfiguration
          );

          const [, cacheWriteSuccess] = await Promise.all([writeProjectStatePromise, setCacheEntryPromise]);

          if (terminalProvider.hasErrors) {
            status = TaskStatus.Failure;
          } else if (cacheWriteSuccess === false) {
            status = TaskStatus.SuccessWithWarning;
          }
        }

        normalizeNewlineTransform.close();

        // If the pipeline is wired up correctly, then closing normalizeNewlineTransform should
        // have closed projectLogWritable.
        if (projectLogWritable.isOpen) {
          throw new InternalError('The output file handle was not closed');
        }

        return status;
      }
    } finally {
      projectLogWritable.close();
    }
  }

  private async _getProjectBuildCacheAsync(
    terminal: ITerminal,
    trackedProjectFiles: string[] | undefined,
    commandLineConfiguration: CommandLineConfiguration | undefined
  ): Promise<ProjectBuildCache | undefined> {
    if (this._projectBuildCache === UNINITIALIZED) {
      this._projectBuildCache = undefined;

      if (this._buildCacheConfiguration && this._buildCacheConfiguration.buildCacheEnabled) {
        const projectConfiguration: RushProjectConfiguration | undefined =
          await RushProjectConfiguration.tryLoadForProjectAsync(
            this._rushProject,
            commandLineConfiguration,
            terminal
          );
        if (projectConfiguration) {
          if (projectConfiguration.cacheOptions?.disableBuildCache) {
            terminal.writeVerboseLine('Caching has been disabled for this project.');
          } else {
            const commandOptions: ICacheOptionsForCommand | undefined =
              projectConfiguration.cacheOptions.optionsForCommandsByName.get(this._commandName);
            if (commandOptions?.disableBuildCache) {
              terminal.writeVerboseLine(
                `Caching has been disabled for this project's "${this._commandName}" command.`
              );
            } else {
              this._projectBuildCache = await ProjectBuildCache.tryGetProjectBuildCache({
                projectConfiguration,
                buildCacheConfiguration: this._buildCacheConfiguration,
                terminal,
                command: this._commandToRun,
                trackedProjectFiles: trackedProjectFiles,
                packageChangeAnalyzer: this._packageChangeAnalyzer
              });
            }
          }
        } else {
          terminal.writeVerboseLine(
            `Project does not have a ${RushConstants.rushProjectConfigFilename} configuration file, ` +
              'or one provided by a rig, so it does not support caching.'
          );
        }
      }
    }

    return this._projectBuildCache;
  }
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
