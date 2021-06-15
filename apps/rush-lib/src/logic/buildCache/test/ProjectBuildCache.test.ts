// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBufferTerminalProvider, Terminal, ITerminal } from '@rushstack/terminal';

import { BuildCacheConfiguration } from '../../../api/BuildCacheConfiguration';
import { RushProjectConfiguration } from '../../../api/RushProjectConfiguration';
import { PackageChangeAnalyzer } from '../../../logic/PackageChangeAnalyzer';
import { IGenerateCacheEntryIdOptions } from '../CacheEntryId';
import { FileSystemBuildCacheProvider } from '../FileSystemBuildCacheProvider';

import { ProjectBuildCache } from '../ProjectBuildCache';

interface ITestOptions {
  enabled: boolean;
  writeAllowed: boolean;
  trackedProjectFiles: string[] | undefined;
}

describe('ProjectBuildCache', () => {
  async function prepareSubject(options: Partial<ITestOptions>): Promise<ProjectBuildCache | undefined> {
    const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());
    const packageChangeAnalyzer = {
      getProjectStateHash: () => {
        return 'state_hash';
      }
    } as unknown as PackageChangeAnalyzer;

    const subject: ProjectBuildCache | undefined = await ProjectBuildCache.tryGetProjectBuildCache({
      buildCacheConfiguration: {
        buildCacheEnabled: options.hasOwnProperty('enabled') ? options.enabled : true,
        getCacheEntryId: (options: IGenerateCacheEntryIdOptions) =>
          `${options.projectName}/${options.projectStateHash}`,
        localCacheProvider: undefined as unknown as FileSystemBuildCacheProvider,
        cloudCacheProvider: {
          isCacheWriteAllowed: options.hasOwnProperty('writeAllowed') ? options.writeAllowed : false
        }
      } as unknown as BuildCacheConfiguration,
      projectConfiguration: {
        projectOutputFolderNames: ['dist'],
        project: {
          packageName: 'acme-wizard',
          projectRelativeFolder: 'apps/acme-wizard',
          dependencyProjects: []
        }
      } as unknown as RushProjectConfiguration,
      command: 'build',
      trackedProjectFiles: options.hasOwnProperty('trackedProjectFiles') ? options.trackedProjectFiles : [],
      packageChangeAnalyzer,
      terminal
    });

    return subject;
  }

  describe('tryGetProjectBuildCache', () => {
    it('returns a ProjectBuildCache with a calculated cacheId value', async () => {
      const subject: ProjectBuildCache = (await prepareSubject({}))!;
      expect(subject['_cacheId']).toMatchInlineSnapshot(
        `"acme-wizard/e229f8765b7d450a8a84f711a81c21e37935d661"`
      );
    });

    it('returns undefined if the tracked file list is undefined', async () => {
      expect(
        await prepareSubject({
          trackedProjectFiles: undefined
        })
      ).toBe(undefined);
    });
  });
});
