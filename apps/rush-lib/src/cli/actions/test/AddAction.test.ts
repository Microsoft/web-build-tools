// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import '../../test/mockRushCommandLineParser';

import * as path from 'path';

import { PackageJsonUpdater } from '../../../logic/PackageJsonUpdater';
import { RushCommandLineParser } from '../../RushCommandLineParser';

describe('AddAction', () => {
  describe(`basic "rush add" tests`, () => {
    let doRushAddMock: jest.SpyInstance;
    let oldExitCode: number | undefined;
    let oldArgs: string[];

    beforeEach(() => {
      doRushAddMock = jest
        .spyOn(PackageJsonUpdater.prototype, 'doRushAdd')
        .mockImplementation(() => Promise.resolve());
      jest.spyOn(process, 'exit').mockImplementation();
      oldExitCode = process.exitCode;
      oldArgs = process.argv;
    });

    afterEach(() => {
      jest.clearAllMocks();
      process.exitCode = oldExitCode;
      process.argv = oldArgs;
    });

    describe(`'add' action`, () => {
      it(`adds a dependency to just one repo in the workspace`, async () => {
        const startPath: string = path.resolve(__dirname, 'addRepo');
        const aPath: string = path.resolve(__dirname, 'addRepo', 'a');

        // Create a Rush CLI instance. This instance is heavy-weight and relies on setting process.exit
        // to exit and clear the Rush file lock. So running multiple `it` or `describe` test blocks over the same test
        // repo will fail due to contention over the same lock which is kept until the test runner process
        // ends.
        const parser: RushCommandLineParser = new RushCommandLineParser({ cwd: startPath });

        // Switching to the "a" package of addRepo
        jest.spyOn(process, 'cwd').mockReturnValue(aPath);

        // Mock the command
        process.argv = ['pretend-this-is-node.exe', 'pretend-this-is-rush', 'add', '-p', 'assert'];

        await expect(parser.execute()).resolves.toEqual(true);
        expect(doRushAddMock).toHaveBeenCalledTimes(1);
        expect(doRushAddMock.mock.calls[0][0].projects).toHaveLength(1);
        expect(doRushAddMock.mock.calls[0][0].projects[0].packageName).toEqual('a');
        expect(doRushAddMock.mock.calls[0][0].packageNames).toContain('assert');
      });
    });

    describe(`'add' action with --all`, () => {
      it(`adds a dependency to all repos in the workspace`, async () => {
        const startPath: string = path.resolve(__dirname, 'addRepo');
        const aPath: string = path.resolve(__dirname, 'addRepo', 'a');

        // Create a Rush CLI instance. This instance is heavy-weight and relies on setting process.exit
        // to exit and clear the Rush file lock. So running multiple `it` or `describe` test blocks over the same test
        // repo will fail due to contention over the same lock which is kept until the test runner process
        // ends.
        const parser: RushCommandLineParser = new RushCommandLineParser({ cwd: startPath });

        // Switching to the "a" package of addRepo
        jest.spyOn(process, 'cwd').mockReturnValue(aPath);

        // Mock the command
        process.argv = ['pretend-this-is-node.exe', 'pretend-this-is-rush', 'add', '-p', 'assert', '--all'];

        await expect(parser.execute()).resolves.toEqual(true);
        expect(doRushAddMock).toHaveBeenCalledTimes(1);
        expect(doRushAddMock.mock.calls[0][0].projects).toHaveLength(2);
        expect(doRushAddMock.mock.calls[0][0].projects[0].packageName).toEqual('a');
        expect(doRushAddMock.mock.calls[0][0].projects[1].packageName).toEqual('b');
        expect(doRushAddMock.mock.calls[0][0].packageNames).toContain('assert');
      });
    });
  });
});
