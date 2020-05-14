// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as tty from 'tty';
import * as path from 'path';
import * as wordwrap from 'wordwrap';
import {
  JsonFile,
  IPackageJson,
  FileSystem,
  FileConstants
} from '@rushstack/node-core-library';
import { RushConfiguration } from '../api/RushConfiguration';
import { Stream } from 'stream';

export interface IEnvironment {
  // NOTE: the process.env doesn't actually support "undefined" as a value.
  // If you try to assign it, it will be converted to the text string "undefined".
  // But this typing is needed for reading values from the dictionary, and for
  // subsets that get combined.
  [environmentVariableName: string]: string | undefined;
}

/**
 * Options for Utilities.installPackageInDirectory().
 */
export interface IInstallPackageInDirectoryOptions {
  directory: string;
  packageName: string;
  version: string;
  tempPackageTitle: string;
  maxInstallAttempts: number;
  commonRushConfigFolder: string | undefined;
  suppressOutput?: boolean;
}

export interface ILifecycleCommandOptions {
  /**
   * The rush configuration, if the command is running in a rush repo.
   */
  rushConfiguration: RushConfiguration | undefined;

  /**
   * Working directory for running the command
   */
  workingDirectory: string;

  /**
   * The folder containing a local .npmrc, which will be used for the INIT_CWD environment variable
   */
  initCwd: string;

  /**
   * If true, suppress the process's output, but if there is a nonzero exit code then print stderr
   */
  handleOutput: boolean;

  /**
   * Options for what should be added to the PATH variable
   */
  environmentPathOptions: IEnvironmentPathOptions;
}

export interface IEnvironmentPathOptions {
  /**
   * If true, include <project root>/node_modules/.bin in the PATH. If both this and
   * {@link IEnvironmentPathOptions.includeRepoBin} are set, this path will take precedence.
   */
  includeProjectBin?: boolean;

  /**
   * If true, include <repo root>/common/temp/node_modules/.bin in the PATH.
   */
  includeRepoBin?: boolean;
}

interface ICreateEnvironmentForRushCommandPathOptions extends IEnvironmentPathOptions {
  projectRoot: string | undefined;
  commonTempFolder: string | undefined;
}

interface ICreateEnvironmentForRushCommandOptions {
  /**
   * The INIT_CWD environment variable
   */
  initCwd?: string;

  /**
   * an existing environment to copy instead of process.env
   */
  initialEnvironment?: IEnvironment;

  /**
   * Options for what should be added to the PATH variable
   */
  pathOptions?: ICreateEnvironmentForRushCommandPathOptions;
}

export class Utilities {
  /**
   * Get the user's home directory. On windows this looks something like "C:\users\username\" and on UNIX
   * this looks something like "/usr/username/"
   */
  public static getHomeDirectory(): string {
    const unresolvedUserFolder: string | undefined = process.env[
      (process.platform === 'win32') ? 'USERPROFILE' : 'HOME'
    ];
    const dirError: string = 'Unable to determine the current user\'s home directory';
    if (unresolvedUserFolder === undefined) {
      throw new Error(dirError);
    }
    const homeFolder: string = path.resolve(unresolvedUserFolder);
    if (!FileSystem.exists(homeFolder)) {
      throw new Error(dirError);
    }

    return homeFolder;
  }

  /**
   * Node.js equivalent of performance.now().
   */
  public static getTimeInMs(): number {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1000 + nanoseconds / 1000000;
  }

  /**
   * Returns the values from a Set<T>
   */
  public static getSetAsArray<T>(set: Set<T>): T[] {
    // When ES6 is supported, we can use Array.from() instead.
    const result: T[] = [];
    set.forEach((value: T) => {
      result.push(value);
    });
    return result;
  }

  /**
   * Retries a function until a timeout is reached. The function is expected to throw if it failed and
   *  should be retried.
   */
  public static retryUntilTimeout<TResult>(
    fn: () => TResult,
    maxWaitTimeMs: number,
    getTimeoutError: (innerError: Error) => Error,
    fnName: string
  ): TResult {
    const startTime: number = Utilities.getTimeInMs();
    let looped: boolean = false;

    let result: TResult;
    for (; ;) {
      try {
        result = fn();
        break;
      } catch (e) {
        looped = true;
        const currentTime: number = Utilities.getTimeInMs();
        if (currentTime - startTime > maxWaitTimeMs) {
          throw getTimeoutError(e);
        }
      }
    }

    if (looped) {
      const currentTime: number = Utilities.getTimeInMs();
      const totalSeconds: string = ((currentTime - startTime) / 1000.0).toFixed(2);
      // This logging statement isn't meaningful to the end-user. `fnName` should be updated
      // to something like `operationDescription`
      console.log(`${fnName}() stalled for ${totalSeconds} seconds`);
    }

    return result;
  }

  /**
   * Creates the specified folder by calling FileSystem.ensureFolder(), but using a
   * retry loop to recover from temporary locks that may be held by other processes.
   * If the folder already exists, no error occurs.
   */
  public static createFolderWithRetry(folderName: string): void {
    // Note: If a file exists with the same name, then we fall through and report
    // an error.
    if (Utilities.directoryExists(folderName)) {
      return;
    }

    // We need to do a simple "FileSystem.ensureFolder(localModulesFolder)" here,
    // however if the folder we deleted above happened to contain any files,
    // then there seems to be some OS process (virus scanner?) that holds
    // a lock on the folder for a split second, which causes mkdirSync to
    // fail.  To workaround that, retry for up to 7 seconds before giving up.
    const maxWaitTimeMs: number = 7 * 1000;

    return Utilities.retryUntilTimeout(
      () => FileSystem.ensureFolder(folderName),
      maxWaitTimeMs,
      (e) => new Error(
        `Error: ${e}${os.EOL}Often this is caused by a file lock ` +
        'from a process such as your text editor, command prompt, ' +
        'or a filesystem watcher.'
      ),
      'createFolderWithRetry'
    );
  }

  /**
   * Determines if the path points to a file and that it exists.
   */
  public static fileExists(filePath: string): boolean {
    let exists: boolean = false;

    try {
      const lstat: fs.Stats = FileSystem.getLinkStatistics(filePath);
      exists = lstat.isFile();
    } catch (e) { /* no-op */ }

    return exists;
  }

  /**
   * Determines if a path points to a directory and that it exists.
   */
  public static directoryExists(directoryPath: string): boolean {
    let exists: boolean = false;

    try {
      const lstat: fs.Stats = FileSystem.getLinkStatistics(directoryPath);
      exists = lstat.isDirectory();
    } catch (e) { /* no-op */ }

    return exists;
  }

  /**
   * BE VERY CAREFUL CALLING THIS FUNCTION!
   * If you specify the wrong folderPath (e.g. "/"), it could potentially delete your entire
   * hard disk.
   */
  public static dangerouslyDeletePath(folderPath: string): void {
    try {
      FileSystem.deleteFolder(folderPath);
    } catch (e) {
      throw new Error(
        `${e.message}${os.EOL}Often this is caused by a file lock from a process ` +
        'such as your text editor, command prompt, or a filesystem watcher'
      );
    }
  }

  /**
   * Attempts to delete a file. If it does not exist, or the path is not a file, it no-ops.
   */
  public static deleteFile(filePath: string): void {
    if (Utilities.fileExists(filePath)) {
      console.log(`Deleting: ${filePath}`);
      FileSystem.deleteFile(filePath);
    }
  }

  /*
   * Returns true if outputFilename has a more recent last modified timestamp
   * than all of the inputFilenames, which would imply that we don't need to rebuild it.
   * Returns false if any of the files does not exist.
   * NOTE: The filenames can also be paths for directories, in which case the directory
   * timestamp is compared.
   */
  public static isFileTimestampCurrent(outputFilename: string, inputFilenames: string[]): boolean {
    if (!FileSystem.exists(outputFilename)) {
      return false;
    }
    const outputStats: fs.Stats = FileSystem.getStatistics(outputFilename);

    for (const inputFilename of inputFilenames) {
      if (!FileSystem.exists(inputFilename)) {
        return false;
      }

      const inputStats: fs.Stats = FileSystem.getStatistics(inputFilename);
      if (outputStats.mtime < inputStats.mtime) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the width of the console, measured in columns
   */
  public static getConsoleWidth(): number {
    const stdout: tty.WriteStream = process.stdout as tty.WriteStream;
    if (stdout && stdout.columns) {
      return stdout.columns;
    }

    return 80;
  }

  /**
   * Applies word wrapping.  If maxLineLength is unspecified, then it defaults to the console
   * width.
   */
  public static wrapWords(text: string, maxLineLength?: number, indent?: number): string {
    if (!indent) {
      indent = 0;
    }
    if (!maxLineLength) {
      maxLineLength = Utilities.getConsoleWidth();
    }

    const wrap: (textToWrap: string) => string = wordwrap(indent, maxLineLength, { mode: 'soft' });
    return wrap(text);
  }

  /**
   * Executes the command with the specified command-line parameters, and waits for it to complete.
   * The current directory will be set to the specified workingDirectory.
   */
  public static executeCommand(command: string, args: string[], workingDirectory: string,
    environment?: IEnvironment, suppressOutput: boolean = false,
    keepEnvironment: boolean = false
  ): void {

    Utilities._executeCommandInternal(command, args, workingDirectory,
      suppressOutput ? undefined : [0, 1, 2],
      environment,
      keepEnvironment
    );
  }

  /**
   * Executes the command with the specified command-line parameters, and waits for it to complete.
   * The current directory will be set to the specified workingDirectory.
   */
  public static executeCommandAndCaptureOutput(command: string, args: string[], workingDirectory: string,
    environment?: IEnvironment,
    keepEnvironment: boolean = false
  ): string {

    const result: child_process.SpawnSyncReturns<Buffer> = Utilities._executeCommandInternal(
      command,
      args,
      workingDirectory,
      ['pipe', 'pipe', 'pipe'],
      environment,
      keepEnvironment
    );

    return result.stdout.toString();
  }

  /**
   * Attempts to run Utilities.executeCommand() up to maxAttempts times before giving up.
   */
  public static executeCommandWithRetry(maxAttempts: number, command: string, args: string[],
    workingDirectory: string, environment?: IEnvironment, suppressOutput: boolean = false,
    retryCallback?: () => void): void {

    if (maxAttempts < 1) {
      throw new Error('The maxAttempts parameter cannot be less than 1');
    }

    let attemptNumber: number = 1;

    for (; ;) {
      try {
        Utilities.executeCommand(command, args, workingDirectory, environment, suppressOutput);
      } catch (error) {
        console.log(os.EOL + 'The command failed:');
        console.log(` ${command} ` + args.join(' '));
        console.log(`ERROR: ${error.toString()}`);

        if (attemptNumber < maxAttempts) {
          ++attemptNumber;
          console.log(`Trying again (attempt #${attemptNumber})...` + os.EOL);
          if (retryCallback) {
            retryCallback();
          }

          continue;
        } else {
          console.error(`Giving up after ${attemptNumber} attempts` + os.EOL);
          throw error;
        }
      }

      break;
    }
  }

  /**
   * Executes the command using cmd if running on windows, or using sh if running on a non-windows OS.
   * @param command - the command to run on shell
   * @param options - options for how the command should be run
   */
  public static executeLifecycleCommand(
    command: string,
    options: ILifecycleCommandOptions
  ): number {
    const result: child_process.SpawnSyncReturns<Buffer> = Utilities._executeLifecycleCommandInternal(
      command,
      child_process.spawnSync,
      options
    );

    if (options.handleOutput) {
      Utilities._processResult(result);
    }

    if (result.status !== null) {
      return result.status;
    } else {
      throw result.error || new Error('An unknown error occurred.');
    }
  }

  /**
   * Executes the command using cmd if running on windows, or using sh if running on a non-windows OS.
   * @param command - the command to run on shell
   * @param options - options for how the command should be run
   */
  public static executeLifecycleCommandAsync(
    command: string,
    options: ILifecycleCommandOptions
  ): child_process.ChildProcess {
    return Utilities._executeLifecycleCommandInternal(
      command,
      child_process.spawn,
      options
    );
  }

  /**
   * For strings passed to a shell command, this adds appropriate escaping
   * to avoid misinterpretation of spaces or special characters.
   *
   * Example: 'hello there' --> '"hello there"'
   */
  public static escapeShellParameter(parameter: string): string {
    return `"${parameter}"`;
  }

  /**
   * Installs a package by name and version in the specified directory.
   */
  public static installPackageInDirectory(options: IInstallPackageInDirectoryOptions): void {
    const directory: string = path.resolve(options.directory);
    if (FileSystem.exists(directory)) {
      console.log('Deleting old files from ' + directory);
    }

    FileSystem.ensureEmptyFolder(directory);

    const npmPackageJson: IPackageJson = {
      dependencies: {
        [options.packageName]: options.version
      },
      description: 'Temporary file generated by the Rush tool',
      name: options.tempPackageTitle,
      private: true,
      version: '0.0.0'
    };
    JsonFile.save(npmPackageJson, path.join(directory, FileConstants.PackageJson));

    if (options.commonRushConfigFolder) {
      Utilities.syncNpmrc(options.commonRushConfigFolder, directory);
    }

    console.log(os.EOL + 'Running "npm install" in ' + directory);

    // NOTE: Here we use whatever version of NPM we happen to find in the PATH
    Utilities.executeCommandWithRetry(
      options.maxInstallAttempts,
      'npm',
      ['install'],
      directory,
      Utilities._createEnvironmentForRushCommand({}),
      options.suppressOutput
    );
  }

  public static withFinally<T>(options: { promise: Promise<T>, finally: () => void }): Promise<T> {
    return options.promise.then<T>((result: T) => {
      try {
        options.finally();
      } catch (error) {
        return Promise.reject(error);
      }
      return result;
    }).catch<T>((error: Error) => {
      try {
        options.finally();
      } catch (innerError) {
        return Promise.reject(innerError);
      }
      return Promise.reject(error);
    });
  }

  /**
   * As a workaround, copyAndTrimNpmrcFile() copies the .npmrc file to the target folder, and also trims
   * unusable lines from the .npmrc file.
   *
   * Why are we trimming the .npmrc lines?  NPM allows environment variables to be specified in
   * the .npmrc file to provide different authentication tokens for different registry.
   * However, if the environment variable is undefined, it expands to an empty string, which
   * produces a valid-looking mapping with an invalid URL that causes an error.  Instead,
   * we'd prefer to skip that line and continue looking in other places such as the user's
   * home directory.
   *
   * IMPORTANT: THIS CODE SHOULD BE KEPT UP TO DATE WITH _copyNpmrcFile() FROM scripts/install-run.ts
   */
  public static copyAndTrimNpmrcFile(sourceNpmrcPath: string, targetNpmrcPath: string): void {
    console.log(`Copying ${sourceNpmrcPath} --> ${targetNpmrcPath}`); // Verbose
    let npmrcFileLines: string[] = FileSystem.readFile(sourceNpmrcPath).split('\n');
    npmrcFileLines = npmrcFileLines.map((line) => (line || '').trim());
    const resultLines: string[] = [];
    // Trim out lines that reference environment variables that aren't defined
    for (const line of npmrcFileLines) {
      // This finds environment variable tokens that look like "${VAR_NAME}"
      const regex: RegExp = /\$\{([^\}]+)\}/g;
      const environmentVariables: string[] | null = line.match(regex);
      let lineShouldBeTrimmed: boolean = false;
      if (environmentVariables) {
        for (const token of environmentVariables) {
          // Remove the leading "${" and the trailing "}" from the token
          const environmentVariableName: string = token.substring(2, token.length - 1);
          if (!process.env[environmentVariableName]) {
            lineShouldBeTrimmed = true;
            break;
          }
        }
      }

      if (lineShouldBeTrimmed) {
        // Example output:
        // "; MISSING ENVIRONMENT VARIABLE: //my-registry.com/npm/:_authToken=${MY_AUTH_TOKEN}"
        resultLines.push('; MISSING ENVIRONMENT VARIABLE: ' + line);
      } else {
        resultLines.push(line);
      }
    }

    FileSystem.writeFile(targetNpmrcPath, resultLines.join(os.EOL));
  }

  /**
   * syncNpmrc() copies the .npmrc file to the target folder, and also trims unusable lines from the .npmrc file.
   * If the source .npmrc file not exist, then syncNpmrc() will delete an .npmrc that is found in the target folder.
   *
   * IMPORTANT: THIS CODE SHOULD BE KEPT UP TO DATE WITH _syncNpmrc() FROM scripts/install-run.ts
   */
  public static syncNpmrc(sourceNpmrcFolder: string, targetNpmrcFolder: string, useNpmrcPublish?: boolean): void {
    const sourceNpmrcPath: string = path.join(sourceNpmrcFolder, !useNpmrcPublish ? '.npmrc' : '.npmrc-publish');
    const targetNpmrcPath: string = path.join(targetNpmrcFolder, '.npmrc');
    try {
      if (FileSystem.exists(sourceNpmrcPath)) {
        Utilities.copyAndTrimNpmrcFile(sourceNpmrcPath, targetNpmrcPath);
      } else if (FileSystem.exists(targetNpmrcPath)) {
        // If the source .npmrc doesn't exist and there is one in the target, delete the one in the target
        console.log(`Deleting ${targetNpmrcPath}`); // Verbose
        FileSystem.deleteFile(targetNpmrcPath);
      }
    } catch (e) {
      throw new Error(`Error syncing .npmrc file: ${e}`);
    }
  }

  public static getRushConfigNotFoundError(): Error {
    return new Error('Unable to find rush.json configuration file');
  }

  public static getPackageDepsFilenameForCommand(command: string): string {
    return `package-deps_${command}.json`;
  }

  private static _executeLifecycleCommandInternal<TCommandResult>(
    command: string,
    spawnFunction: (command: string, args: string[], spawnOptions: child_process.SpawnOptions) => TCommandResult,
    options: ILifecycleCommandOptions
  ): TCommandResult {
    let shellCommand: string = process.env.comspec || 'cmd';
    let commandFlags: string = '/d /s /c';
    let useShell: boolean = true;
    if (process.platform !== 'win32') {
      shellCommand = 'sh';
      commandFlags = '-c';
      useShell = false;
    }

    const environment: IEnvironment = Utilities._createEnvironmentForRushCommand(
      {
        initCwd: options.initCwd,
        pathOptions: {
          ...options.environmentPathOptions,
          projectRoot: options.workingDirectory,
          commonTempFolder: options.rushConfiguration ? options.rushConfiguration.commonTempFolder : undefined
        }
      }
    );

    return spawnFunction(
      shellCommand,
      [commandFlags, command],
      {
        cwd: options.workingDirectory,
        shell: useShell,
        env: environment,
        stdio: options.handleOutput ? ['pipe', 'pipe', 'pipe'] : [0, 1, 2]
      }
    );
  }

  /**
   * Returns a process.env environment suitable for executing lifecycle scripts.
   * @param initialEnvironment - an existing environment to copy instead of process.env
   */
  private static _createEnvironmentForRushCommand(options: ICreateEnvironmentForRushCommandOptions): IEnvironment {
    if (options.initialEnvironment === undefined) {
      options.initialEnvironment = process.env;
    }

    const environment: IEnvironment = {};
    for (const key of Object.getOwnPropertyNames(options.initialEnvironment)) {
      const normalizedKey: string = os.platform() === 'win32' ? key.toUpperCase() : key;

      // If Rush itself was invoked inside a lifecycle script, this may be set and would interfere
      // with Rush's installations.  If we actually want it, we will set it explicitly below.
      if (normalizedKey === 'INIT_CWD') {
        continue;
      }

      // When NPM invokes a lifecycle event, it copies its entire configuration into environment
      // variables.  Rush is supposed to be a deterministic controlled environment, so don't bring
      // this along.
      //
      // NOTE: Longer term we should clean out the entire environment and use rush.json to bring
      // back specific environment variables that the repo maintainer has determined to be safe.
      if (normalizedKey.match(/^NPM_CONFIG_/)) {
        continue;
      }

      // Use the uppercased environment variable name on Windows because environment variable names
      // are case-insensitive on Windows
      environment[normalizedKey] = options.initialEnvironment[key];
    }

    // When NPM invokes a lifecycle script, it sets an environment variable INIT_CWD that remembers
    // the directory that NPM started in.  This allows naive scripts to change their current working directory
    // and invoke NPM operations, while still be able to find a local .npmrc file.  Although Rush recommends
    // for toolchain scripts to be professionally written (versus brittle stuff like
    // "cd ./lib && npm run tsc && cd .."), we support INIT_CWD for compatibility.
    //
    // More about this feature: https://github.com/npm/npm/pull/12356
    if (options.initCwd) {
      environment['INIT_CWD'] = options.initCwd; // eslint-disable-line dot-notation
    }

    if (options.pathOptions) {
      if (options.pathOptions.includeRepoBin && options.pathOptions.commonTempFolder) {
        environment.PATH = Utilities._prependNodeModulesBinToPath(
          environment.PATH,
          options.pathOptions.commonTempFolder
        );
      }

      if (options.pathOptions.includeProjectBin && options.pathOptions.projectRoot) {
        environment.PATH = Utilities._prependNodeModulesBinToPath(
          environment.PATH,
          options.pathOptions.projectRoot
        );
      }
    }

    return environment;
  }

  /**
   * Prepend the node_modules/.bin folder under the specified folder to the specified PATH variable. For example,
   * if `rootDirectory` is "/foobar" and `existingPath` is "/bin", this function will return
   * "/foobar/node_modules/.bin:/bin"
   */
  private static _prependNodeModulesBinToPath(existingPath: string | undefined, rootDirectory: string): string {
    const binPath: string = path.resolve(rootDirectory, 'node_modules', '.bin');
    if (existingPath) {
      return `${binPath}${path.delimiter}${existingPath}`;
    } else {
      return binPath;
    }
  }

  /**
   * Executes the command with the specified command-line parameters, and waits for it to complete.
   * The current directory will be set to the specified workingDirectory.
   */
  private static _executeCommandInternal(
    command: string, args: string[], workingDirectory: string,
    stdio: 'pipe' | 'ignore' | 'inherit' | (number | 'pipe' | 'ignore' | 'inherit' | 'ipc' | Stream | null | undefined)[] | undefined,
    environment?: IEnvironment,
    keepEnvironment: boolean = false
  ): child_process.SpawnSyncReturns<Buffer> {
    const options: child_process.SpawnSyncOptions = {
      cwd: workingDirectory,
      shell: true,
      stdio: stdio,
      env: keepEnvironment
        ? environment
        : Utilities._createEnvironmentForRushCommand({ initialEnvironment: environment })
    };

    // This is needed since we specify shell=true below.
    // NOTE: On Windows if we escape "NPM", the spawnSync() function runs something like this:
    //   [ 'C:\\Windows\\system32\\cmd.exe', '/s', '/c', '""NPM" "install""' ]
    //
    // Due to a bug with Windows cmd.exe, the npm.cmd batch file's "%~dp0" variable will
    // return the current working directory instead of the batch file's directory.
    // The workaround is to not escape, npm, i.e. do this instead:
    //   [ 'C:\\Windows\\system32\\cmd.exe', '/s', '/c', '"npm "install""' ]
    //
    // We will come up with a better solution for this when we promote executeCommand()
    // into node-core-library, but for now this hack will unblock people:

    // Only escape the command if it actually contains spaces:
    const escapedCommand: string = command.indexOf(' ') < 0
      ? command
      : Utilities.escapeShellParameter(command);

    const escapedArgs: string[] = args.map((x) => Utilities.escapeShellParameter(x));

    let result: child_process.SpawnSyncReturns<Buffer> = child_process.spawnSync(escapedCommand,
      escapedArgs, options);

    if (result.error && (result.error as any).errno === 'ENOENT') { // eslint-disable-line @typescript-eslint/no-explicit-any
      // This is a workaround for GitHub issue #25330
      // https://github.com/nodejs/node-v0.x-archive/issues/25330
      result = child_process.spawnSync(command + '.cmd', args, options);
    }

    Utilities._processResult(result);
    return result;
  }

  private static _processResult(result: child_process.SpawnSyncReturns<Buffer>): void {
    if (result.error) {
      result.error.message += os.EOL + (result.stderr ? result.stderr.toString() + os.EOL : '');
      throw result.error;
    }

    if (result.status) {
      throw new Error('The command failed with exit code ' + result.status + os.EOL +
        (result.stderr ? result.stderr.toString() : ''));
    }
  }
}
