// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { Executable, FileSystem, FileWriter } from '@rushstack/node-core-library';
import { ITerminal } from '@rushstack/terminal';
import { ChildProcess } from 'child_process';
import * as events from 'events';

import { RushConfigurationProject } from '../api/RushConfigurationProject';

export interface ITarOptionsBase {
  logFilePath: string;
}

export interface IUntarOptions extends ITarOptionsBase {
  archivePath: string;
  outputFolderPath: string;
}

export interface ICreateArchiveOptions extends ITarOptionsBase {
  archivePath: string;
  paths: string[];
  project: RushConfigurationProject;
}

export class TarExecutable {
  private _tarExecutablePath: string;

  private constructor(tarExecutablePath: string) {
    this._tarExecutablePath = tarExecutablePath;
  }

  public static tryInitialize(terminal: ITerminal): TarExecutable | undefined {
    terminal.writeVerboseLine('Trying to find "tar" binary');
    const tarExecutablePath: string | undefined = Executable.tryResolve('tar');
    if (!tarExecutablePath) {
      terminal.writeVerboseLine('"tar" was not found on the PATH');
      return undefined;
    }

    return new TarExecutable(tarExecutablePath);
  }

  /**
   * @returns
   * The "tar" exit code
   */
  public async tryUntarAsync(options: IUntarOptions): Promise<number> {
    return await this._spawnTarWithLoggingAsync(
      // These parameters are chosen for compatibility with the very primitive bsdtar 3.3.2 shipped with Windows 10.
      [
        // [Windows bsdtar 3.3.2] Extract: tar -x [options] [<patterns>]
        '-x',
        // [Windows bsdtar 3.3.2] -m    Don't restore modification times
        '-m',
        // [Windows bsdtar 3.3.2] -f <filename>  Location of archive (default \\.\tape0)
        '-f',
        options.archivePath
      ],
      options.outputFolderPath,
      options.logFilePath
    );
  }

  /**
   * @returns
   * The "tar" exit code
   */
  public async tryCreateArchiveFromProjectPathsAsync(options: ICreateArchiveOptions): Promise<number> {
    const { project, archivePath, paths, logFilePath } = options;
    const pathsListFilePath: string = `${project.projectRushTempFolder}/tarPaths_${Date.now()}`;
    await FileSystem.writeFileAsync(pathsListFilePath, paths.join('\n'));

    // On Windows, tar.exe will report a "Failed to clean up compressor" error if the target folder
    // does not exist (GitHub #2622)
    await FileSystem.ensureFolderAsync(path.dirname(archivePath));

    const projectFolderPath: string = project.projectFolder;
    const tarExitCode: number = await this._spawnTarWithLoggingAsync(
      // These parameters are chosen for compatibility with the very primitive bsdtar 3.3.2 shipped with Windows 10.
      [
        // [Windows bsdtar 3.3.2] -c Create
        '-c',
        // [Windows bsdtar 3.3.2] -f <filename>  Location of archive (default \\.\tape0)
        '-f',
        archivePath,
        // [Windows bsdtar 3.3.2] -z, -j, -J, --lzma  Compress archive with gzip/bzip2/xz/lzma
        '-z',
        // [Windows bsdtar 3.3.2] -C <dir>  Change to <dir> before processing remaining files
        '-C',
        projectFolderPath,
        // [GNU tar 1.33] -T, --files-from=FILE      get names to extract or create from FILE
        //
        // Windows bsdtar does not document this parameter, but seems to accept it.
        '--files-from',
        pathsListFilePath
      ],
      projectFolderPath,
      logFilePath
    );
    await FileSystem.deleteFileAsync(pathsListFilePath);

    return tarExitCode;
  }

  private async _spawnTarWithLoggingAsync(
    args: string[],
    currentWorkingDirectory: string,
    logFilePath: string
  ): Promise<number> {
    // Runs "tar" with the specified args and logs its output to the specified location.
    // The log file looks like this:
    //
    // Windows:
    // Start time: Mon Apr 19 2021 13:06:40 GMT-0700 (Pacific Daylight Time)
    // Invoking "C:\WINDOWS\system32\tar.exe -x -f E:\rush-cache\d18105f7f83eb610b468be4e2421681f4a52e44d"
    //
    // ======= BEGIN PROCESS OUTPUT =======
    // [stdout] <tar stdout output>
    // [stderr] <tar stderr output>
    // ======== END PROCESS OUTPUT ========
    //
    // Exited with code "0"
    //
    // Linux:
    // Start time: Mon Apr 19 2021 13:06:40 GMT-0700 (Pacific Daylight Time)
    // Invoking "/bin/tar -x -f /home/username/rush-cache/d18105f7f83eb610b468be4e2421681f4a52e44d"
    //
    // ======= BEGIN PROCESS OUTPUT =======
    // [stdout] <tar stdout output>
    // [stderr] <tar stderr output>
    // ======== END PROCESS OUTPUT ========
    //
    // Exited with code "0"

    await FileSystem.ensureFolderAsync(path.dirname(logFilePath));
    const fileWriter: FileWriter = FileWriter.open(logFilePath);
    fileWriter.write(
      [
        `Start time: ${new Date().toString()}`,
        `Invoking "${this._tarExecutablePath} ${args.join(' ')}"`,
        '',
        '======= BEGIN PROCESS OUTPUT =======',
        ''
      ].join('\n')
    );

    const childProcess: ChildProcess = Executable.spawn(this._tarExecutablePath, args, {
      currentWorkingDirectory: currentWorkingDirectory
    });

    childProcess.stdout.on('data', (chunk) => fileWriter.write(`[stdout] ${chunk}`));
    childProcess.stderr.on('data', (chunk) => fileWriter.write(`[stderr] ${chunk}`));

    const [tarExitCode] = await events.once(childProcess, 'exit');

    fileWriter.write(
      ['======== END PROCESS OUTPUT ========', '', `Exited with code "${tarExitCode}"`].join('\n')
    );
    fileWriter.close();

    return tarExitCode;
  }
}
