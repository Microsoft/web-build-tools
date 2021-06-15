// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBufferTerminalProvider, ITerminal, Terminal } from '@rushstack/terminal';

import { PackageChangeAnalyzer } from '../PackageChangeAnalyzer';
import { RushConfiguration } from '../../api/RushConfiguration';
import { EnvironmentConfiguration } from '../../api/EnvironmentConfiguration';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { RushProjectConfiguration } from '../../api/RushProjectConfiguration';

describe('PackageChangeAnalyzer', () => {
  beforeEach(() => {
    jest.spyOn(EnvironmentConfiguration, 'gitBinaryPath', 'get').mockReturnValue(undefined);
    jest.spyOn(RushProjectConfiguration, 'tryLoadForProjectAsync').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createTestSubject(
    projects: RushConfigurationProject[],
    files: Map<string, string>
  ): PackageChangeAnalyzer {
    const rushConfiguration: RushConfiguration = {
      commonRushConfigFolder: '',
      projects,
      rushJsonFolder: '',
      getCommittedShrinkwrapFilename(): string {
        return 'common/config/rush/pnpm-lock.yaml';
      },
      findProjectForPosixRelativePath(path: string): object | undefined {
        return projects.find((project) => path.startsWith(project.projectRelativeFolder));
      }
    } as RushConfiguration;

    const subject: PackageChangeAnalyzer = new PackageChangeAnalyzer(rushConfiguration);

    subject['_getRepoDeps'] = jest.fn(() => {
      return files;
    });

    return subject;
  }

  describe('getPackageDeps', () => {
    it('returns the files for the specified project', async () => {
      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject,
        {
          packageName: 'banana',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/banana'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([
        ['apps/apple/core.js', 'a101'],
        ['apps/banana/peel.js', 'b201']
      ]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([['apps/apple/core.js', 'a101']])
      );
      expect(await subject.getPackageDeps('banana', terminal)).toEqual(
        new Map([['apps/banana/peel.js', 'b201']])
      );
    });

    it('ignores files specified by project configuration files, relative to project folder', async () => {
      // rush-project.json configuration for 'apple'
      jest.spyOn(RushProjectConfiguration, 'tryLoadForProjectAsync').mockResolvedValueOnce({
        incrementalBuildIgnoredGlobs: ['assets/*.png', '*.js.map']
      } as RushProjectConfiguration);
      // rush-project.json configuration for 'banana' does not exist
      jest.spyOn(RushProjectConfiguration, 'tryLoadForProjectAsync').mockResolvedValueOnce(undefined);

      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject,
        {
          packageName: 'banana',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/banana'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([
        ['apps/apple/core.js', 'a101'],
        ['apps/apple/core.js.map', 'a102'],
        ['apps/apple/assets/one.jpg', 'a103'],
        ['apps/apple/assets/two.png', 'a104'],
        ['apps/banana/peel.js', 'b201'],
        ['apps/banana/peel.js.map', 'b202']
      ]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([
          ['apps/apple/core.js', 'a101'],
          ['apps/apple/assets/one.jpg', 'a103']
        ])
      );
      expect(await subject.getPackageDeps('banana', terminal)).toEqual(
        new Map([
          ['apps/banana/peel.js', 'b201'],
          ['apps/banana/peel.js.map', 'b202']
        ])
      );
    });

    it('interprets ignored globs as a dot-ignore file (not as individually handled globs)', async () => {
      // rush-project.json configuration for 'apple'
      jest.spyOn(RushProjectConfiguration, 'tryLoadForProjectAsync').mockResolvedValue({
        incrementalBuildIgnoredGlobs: ['*.png', 'assets/*.psd', '!assets/important/**']
      } as RushProjectConfiguration);

      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([
        ['apps/apple/one.png', 'a101'],
        ['apps/apple/assets/two.psd', 'a102'],
        ['apps/apple/assets/three.png', 'a103'],
        ['apps/apple/assets/important/four.png', 'a104'],
        ['apps/apple/assets/important/five.psd', 'a105'],
        ['apps/apple/src/index.ts', 'a106']
      ]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      // In a dot-ignore file, the later rule '!assets/important/**' should override the previous
      // rule of '*.png'. This unit test verifies that this behavior doesn't change later if
      // we modify the implementation.
      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([
          ['apps/apple/assets/important/four.png', 'a104'],
          ['apps/apple/assets/important/five.psd', 'a105'],
          ['apps/apple/src/index.ts', 'a106']
        ])
      );
    });

    it('includes the committed shrinkwrap file as a dep for all projects', async () => {
      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject,
        {
          packageName: 'banana',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/banana'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([
        ['apps/apple/core.js', 'a101'],
        ['apps/banana/peel.js', 'b201'],
        ['common/config/rush/pnpm-lock.yaml', 'ffff'],
        ['tools/random-file.js', 'e00e']
      ]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([
          ['apps/apple/core.js', 'a101'],
          ['common/config/rush/pnpm-lock.yaml', 'ffff']
        ])
      );
      expect(await subject.getPackageDeps('banana', terminal)).toEqual(
        new Map([
          ['apps/banana/peel.js', 'b201'],
          ['common/config/rush/pnpm-lock.yaml', 'ffff']
        ])
      );
    });

    it('returns undefined if the specified project does not exist', async () => {
      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([['apps/apple/core.js', 'a101']]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      expect(await subject.getPackageDeps('carrot', terminal)).toBeUndefined();
    });

    it('lazy-loads project data and caches it for future calls', async () => {
      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([['apps/apple/core.js', 'a101']]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      // Because other unit tests rely on the fact that a freshly instantiated
      // PackageChangeAnalyzer is inert until someone actually requests project data,
      // this test makes that expectation explicit.

      expect(subject['_data']).toBeNull();
      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([['apps/apple/core.js', 'a101']])
      );
      expect(subject['_data']).toBeDefined();
      expect(await subject.getPackageDeps('apple', terminal)).toEqual(
        new Map([['apps/apple/core.js', 'a101']])
      );
      expect(subject['_getRepoDeps']).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProjectStateHash', () => {
    it('returns a fixed hash snapshot for a set of project deps', async () => {
      const projects: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const files: Map<string, string> = new Map([
        ['apps/apple/core.js', 'a101'],
        ['apps/apple/juice.js', 'e333'],
        ['apps/apple/slices.js', 'a102']
      ]);
      const subject: PackageChangeAnalyzer = createTestSubject(projects, files);
      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());

      expect(await subject.getProjectStateHash('apple', terminal)).toMatchInlineSnapshot(
        `"265536e325cdfac3fa806a51873d927a712fc6c9"`
      );
    });

    it('returns the same hash regardless of dep order', async () => {
      const projectsA: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const filesA: Map<string, string> = new Map([
        ['apps/apple/core.js', 'a101'],
        ['apps/apple/juice.js', 'e333'],
        ['apps/apple/slices.js', 'a102']
      ]);
      const subjectA: PackageChangeAnalyzer = createTestSubject(projectsA, filesA);

      const projectsB: RushConfigurationProject[] = [
        {
          packageName: 'apple',
          projectFolder: 'apps/apple',
          projectRelativeFolder: 'apps/apple'
        } as RushConfigurationProject
      ];
      const filesB: Map<string, string> = new Map([
        ['apps/apple/slices.js', 'a102'],
        ['apps/apple/core.js', 'a101'],
        ['apps/apple/juice.js', 'e333']
      ]);
      const subjectB: PackageChangeAnalyzer = createTestSubject(projectsB, filesB);

      const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());
      expect(await subjectA.getProjectStateHash('apple', terminal)).toEqual(
        await subjectB.getProjectStateHash('apple', terminal)
      );
    });
  });
});
