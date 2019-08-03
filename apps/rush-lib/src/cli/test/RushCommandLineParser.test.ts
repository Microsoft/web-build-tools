// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// Mock child_process so we can verify tasks are (or are not) invoked as we expect
jest.mock('child_process');

/**
 * Mock RushCommandLineParser itself to prevent `process.exit` to be called on failure
 */
jest.mock('../RushCommandLineParser', () => {
  // tslint:disable-next-line: no-any
  const actualModule: any = jest.requireActual('../RushCommandLineParser');
  if (actualModule.RushCommandLineParser) {
    // Stub out the troublesome method that calls `process.exit`
    actualModule.RushCommandLineParser.prototype._reportErrorAndSetExitCode = mockReportErrorAndSetExitCode;
  }
  return actualModule;

  function mockReportErrorAndSetExitCode(error: Error): void {
    // Just rethrow the error so the unit tests can catch it
    throw error;
  }
});

import { resolve } from 'path';
import { ChildProcessModuleMock, ISpawnMockConfig } from 'child_process';
import { FileSystem } from '@microsoft/node-core-library';
import { Interleaver } from '@microsoft/stream-collator';
import { RushCommandLineParser } from '../RushCommandLineParser';

/**
 * Interface definition for a test instance for the RushCommandLineParser.
 */
interface IParserTestInstance {
  parser: RushCommandLineParser;
  spawnMock: jest.Mock;
}

/**
 * Helper to set up a test instance for RushCommandLineParser.
 */
function getCommandLineParserInstance(repoName: string, taskName: string): IParserTestInstance {
  // Point to the test repo folder
  const startPath: string = resolve(__dirname, repoName);

  // The `build` task is hard-coded to be incremental. So delete the `package-deps.json` files in
  // the test repo to guarantee the test actually runs.
  FileSystem.deleteFile(resolve(__dirname, `${repoName}/a/package-deps.json`));
  FileSystem.deleteFile(resolve(__dirname, `${repoName}/b/package-deps.json`));

  // Create a Rush CLI instance. This instance is heavy-weight and relies on setting process.exit
  // to exit and clear the Rush file lock. So running multiple `it` or `describe` test blocks over the same test
  // repo will fail due to contention over the same lock which is kept until the test runner process
  // ends.
  const parser: RushCommandLineParser = new RushCommandLineParser({ cwd: startPath });

  // Mock the command
  process.argv = ['pretend-this-is-node.exe', 'pretend-this-is-rush', taskName];
  const spawnMock: jest.Mock = setSpawnMock();

  return {
    parser,
    spawnMock
  };
}

/**
 * Configure the `child_process` `spawn` mock for these tests. This relies on the mock implementation
 * in `__mocks__/child_process.js`.
 */
function setSpawnMock(options?: ISpawnMockConfig): jest.Mock {
  const cpMocked: ChildProcessModuleMock = require('child_process');
  cpMocked.__setSpawnMockConfig(options);

  const spawnMock: jest.Mock = cpMocked.spawn;
  spawnMock.mockName('spawn');
  return spawnMock;
}

// Ordinals into the `mock.calls` array referencing each of the arguments to `spawn`
const SPAWN_ARG_ARGS: number = 1;
const SPAWN_ARG_OPTIONS: number = 2;

describe('RushCommandLineParser', () => {
  describe('execute', () => {
    afterEach(() => {
      // Reset Interleaver so we can re-register a task with the same name for the tests.
      //
      // Interleaver retains a static list of writer loggers which must have unique names. The names are the
      // names of the packages. Our unit tests use test repos with generic 'a', 'b' package names, so anything after
      // the first test that runs an instance of RushCommandLineParser throws an exception complaining of duplicate
      // writer names.
      Interleaver.reset();

      jest.clearAllMocks();
    });

    describe('in basic repo', () => {
      describe(`'build' action`, () => {
        it(`executes the package's 'build' script`, () => {
          const repoName: string = 'basicAndRunBuildActionRepo';
          const instance: IParserTestInstance = getCommandLineParserInstance(repoName, 'build');

          expect.assertions(8);
          return expect(instance.parser.execute()).resolves.toEqual(true)
            .then(() => {
              // There should be 1 build per package
              const packageCount: number = instance.spawnMock.mock.calls.length;
              expect(packageCount).toEqual(2);

              // Use regex for task name in case spaces were prepended or appended to spawned command
              const expectedBuildTaskRegexp: RegExp = /fake_build_task_but_works_with_mock/;

              // tslint:disable-next-line: no-any
              const firstSpawn: any[] = instance.spawnMock.mock.calls[0];
              expect(firstSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(firstSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(firstSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/a`));

              // tslint:disable-next-line: no-any
              const secondSpawn: any[] = instance.spawnMock.mock.calls[1];
              expect(secondSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(secondSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(secondSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/b`));
            });
        });
      });

      describe(`'(pre|post)build' action`, () => {
        it(`executes the package's pre and post scripts`, () => {
          const repoName: string = 'basicAndRunPrePostBuildActionRepo';
          const instance: IParserTestInstance = getCommandLineParserInstance(repoName, 'build');

          expect.assertions(8);
          return expect(instance.parser.execute()).resolves.toEqual(true)
            .then(() => {
              // There should be 1 build per package
              const packageCount: number = instance.spawnMock.mock.calls.length;
              expect(packageCount).toEqual(2);

              // Use regex for task name in case spaces were prepended or appended to spawned command
              const expectedPreBuildTaskRegexp: RegExp = /fake_prebuild_task_but_works_with_mock/;
              const expectedBuildTaskRegexp: RegExp = /fake_build_task_but_works_with_mock/;
              // const expectedPostBuildTaskRegexp: RegExp = /fake_postbuild_task_but_works_with_mock/;

              // tslint:disable-next-line: no-any
              const preBuildSpawnA: any[] = instance.spawnMock.mock.calls[0];
              expect(preBuildSpawnA[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                // Project a has prebuild
                expect.stringMatching(expectedPreBuildTaskRegexp)
              ]));
              expect(preBuildSpawnA[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(preBuildSpawnA[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/a`));

              // tslint:disable-next-line: no-any
              const buildSpawnB: any[] = instance.spawnMock.mock.calls[1];
              expect(buildSpawnB[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                // Project b has build (no prebuild)
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(buildSpawnB[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(buildSpawnB[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/b`));

              // ToDo: Find a way to mock subsequent calls once prebuild completes.
            });
        });
      });

      describe(`'rebuild' action`, () => {
        it(`executes the package's 'build' script`, () => {
          const repoName: string = 'basicAndRunRebuildActionRepo';
          const instance: IParserTestInstance = getCommandLineParserInstance(repoName, 'rebuild');

          expect.assertions(8);
          return expect(instance.parser.execute()).resolves.toEqual(true)
            .then(() => {
              // There should be 1 build per package
              const packageCount: number = instance.spawnMock.mock.calls.length;
              expect(packageCount).toEqual(2);

              // Use regex for task name in case spaces were prepended or appended to spawned command
              const expectedBuildTaskRegexp: RegExp = /fake_build_task_but_works_with_mock/;

              // tslint:disable-next-line: no-any
              const firstSpawn: any[] = instance.spawnMock.mock.calls[0];
              expect(firstSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(firstSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(firstSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/a`));

              // tslint:disable-next-line: no-any
              const secondSpawn: any[] = instance.spawnMock.mock.calls[1];
              expect(secondSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(secondSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(secondSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/b`));
            });
        });
      });
    });

    describe(`in repo with 'rebuild' command overridden`, () => {
      describe(`'build' action`, () => {
        it(`executes the package's 'build' script`, () => {
          const repoName: string = 'overrideRebuildAndRunBuildActionRepo';
          const instance: IParserTestInstance = getCommandLineParserInstance(repoName, 'build');

          expect.assertions(8);
          return expect(instance.parser.execute()).resolves.toEqual(true)
            .then(() => {
              // There should be 1 build per package
              const packageCount: number = instance.spawnMock.mock.calls.length;
              expect(packageCount).toEqual(2);

              // Use regex for task name in case spaces were prepended or appended to spawned command
              const expectedBuildTaskRegexp: RegExp = /fake_build_task_but_works_with_mock/;

              // tslint:disable-next-line: no-any
              const firstSpawn: any[] = instance.spawnMock.mock.calls[0];
              expect(firstSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(firstSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(firstSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/a`));

              // tslint:disable-next-line: no-any
              const secondSpawn: any[] = instance.spawnMock.mock.calls[1];
              expect(secondSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(secondSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(secondSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/b`));
            });
        });
      });

      describe(`'rebuild' action`, () => {
        it(`executes the package's 'rebuild' (not 'build') script`, () => {
          const repoName: string = 'overrideRebuildAndRunRebuildActionRepo';
          const instance: IParserTestInstance = getCommandLineParserInstance(repoName, 'rebuild');

          expect.assertions(8);
          return expect(instance.parser.execute()).resolves.toEqual(true)
            .then(() => {
              // There should be 1 build per package
              const packageCount: number = instance.spawnMock.mock.calls.length;
              expect(packageCount).toEqual(2);

              // Use regex for task name in case spaces were prepended or appended to spawned command
              const expectedBuildTaskRegexp: RegExp = /fake_REbuild_task_but_works_with_mock/;

              // tslint:disable-next-line: no-any
              const firstSpawn: any[] = instance.spawnMock.mock.calls[0];
              expect(firstSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(firstSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(firstSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/a`));

              // tslint:disable-next-line: no-any
              const secondSpawn: any[] = instance.spawnMock.mock.calls[1];
              expect(secondSpawn[SPAWN_ARG_ARGS]).toEqual(expect.arrayContaining([
                expect.stringMatching(expectedBuildTaskRegexp)
              ]));
              expect(secondSpawn[SPAWN_ARG_OPTIONS]).toEqual(expect.any(Object));
              expect(secondSpawn[SPAWN_ARG_OPTIONS].cwd).toEqual(resolve(__dirname, `${repoName}/b`));
            });
        });
      });
    });

    describe(`in repo with 'build' command overridden as a global command`, () => {
      it(`throws an error when starting Rush`, () => {
        const repoName: string = 'overrideBuildAsGlobalCommandRepo';

        expect.assertions(1);
        return expect(() => {
          getCommandLineParserInstance(repoName, 'doesnt-matter');
        }).toThrowError('This command can only be designated as a command kind "bulk"');
      });
    });

    describe(`in repo with 'rebuild' command overridden as a global command`, () => {
      it(`throws an error when starting Rush`, () => {
        const repoName: string = 'overrideRebuildAsGlobalCommandRepo';

        expect.assertions(1);
        return expect(() => {
          getCommandLineParserInstance(repoName, 'doesnt-matter');
        }).toThrowError('This command can only be designated as a command kind "bulk"');
      });
    });

    describe(`in repo with 'build' command overridden with 'safeForSimultaneousRushProcesses=true'`, () => {
      it(`throws an error when starting Rush`, () => {
        const repoName: string = 'overrideBuildWithSimultaneousProcessesRepo';

        expect.assertions(1);
        return expect(() => {
          getCommandLineParserInstance(repoName, 'doesnt-matter');
        }).toThrowError('"safeForSimultaneousRushProcesses=true". This configuration is not supported');
      });
    });

    describe(`in repo with 'rebuild' command overridden with 'safeForSimultaneousRushProcesses=true'`, () => {
      it(`throws an error when starting Rush`, () => {
        const repoName: string = 'overrideRebuildWithSimultaneousProcessesRepo';

        expect.assertions(1);
        return expect(() => {
          getCommandLineParserInstance(repoName, 'doesnt-matter');
        }).toThrowError('"safeForSimultaneousRushProcesses=true". This configuration is not supported');
      });
    });
  });
});