// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBufferTerminalProvider, Terminal, ITerminal } from '@rushstack/terminal';
import { EnvironmentConfiguration } from '../../../api/EnvironmentConfiguration';
import { RushUserConfiguration } from '../../../api/RushUserConfiguration';
import { CredentialCache } from '../../CredentialCache';
import { AzureEnvironmentNames, AzureStorageBuildCacheProvider } from '../AzureStorageBuildCacheProvider';

describe('AzureStorageBuildCacheProvider', () => {
  beforeEach(() => {
    jest.spyOn(EnvironmentConfiguration, 'buildCacheCredential', 'get').mockReturnValue(undefined);
    jest.spyOn(EnvironmentConfiguration, 'buildCacheEnabled', 'get').mockReturnValue(undefined);
    jest.spyOn(EnvironmentConfiguration, 'buildCacheWriteAllowed', 'get').mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('uses a correct list of Azure authority hosts', async () => {
    await expect(
      () =>
        new AzureStorageBuildCacheProvider({
          storageAccountName: 'storage-account',
          storageContainerName: 'container-name',
          azureEnvironment: 'INCORRECT_AZURE_ENVIRONMENT' as AzureEnvironmentNames,
          isCacheWriteAllowed: false
        })
    ).toThrowErrorMatchingSnapshot();
  });

  describe('isCacheWriteAllowed', () => {
    function prepareSubject(
      optionValue: boolean,
      envVarValue: boolean | undefined
    ): AzureStorageBuildCacheProvider {
      jest.spyOn(EnvironmentConfiguration, 'buildCacheWriteAllowed', 'get').mockReturnValue(envVarValue);
      return new AzureStorageBuildCacheProvider({
        storageAccountName: 'storage-account',
        storageContainerName: 'container-name',
        isCacheWriteAllowed: optionValue
      });
    }

    it('is false if isCacheWriteAllowed is false', () => {
      const subject: AzureStorageBuildCacheProvider = prepareSubject(false, undefined);
      expect(subject.isCacheWriteAllowed).toBe(false);
    });

    it('is true if isCacheWriteAllowed is true', () => {
      const subject: AzureStorageBuildCacheProvider = prepareSubject(true, undefined);
      expect(subject.isCacheWriteAllowed).toBe(true);
    });

    it('is false if isCacheWriteAllowed is true but the env var is false', () => {
      const subject: AzureStorageBuildCacheProvider = prepareSubject(true, false);
      expect(subject.isCacheWriteAllowed).toBe(false);
    });

    it('is true if the env var is true', () => {
      const subject: AzureStorageBuildCacheProvider = prepareSubject(false, true);
      expect(subject.isCacheWriteAllowed).toBe(true);
    });
  });

  async function testCredentialCache(isCacheWriteAllowed: boolean): Promise<void> {
    const cacheProvider: AzureStorageBuildCacheProvider = new AzureStorageBuildCacheProvider({
      storageAccountName: 'storage-account',
      storageContainerName: 'container-name',
      isCacheWriteAllowed
    });

    // Mock the user folder to the current folder so a real .rush-user folder doesn't interfere with the test
    jest.spyOn(RushUserConfiguration, 'getRushUserFolderPath').mockReturnValue(__dirname);
    let setCacheEntryArgs: unknown[] = [];
    const credentialsCacheSetCacheEntrySpy: jest.SpyInstance = jest
      .spyOn(CredentialCache.prototype, 'setCacheEntry')
      .mockImplementation((...args) => {
        setCacheEntryArgs = args;
      });
    const credentialsCacheSaveSpy: jest.SpyInstance = jest
      .spyOn(CredentialCache.prototype, 'saveIfModifiedAsync')
      .mockImplementation(() => Promise.resolve());

    const terminal: ITerminal = new Terminal(new StringBufferTerminalProvider());
    await cacheProvider.updateCachedCredentialAsync(terminal, 'credential');

    expect(credentialsCacheSetCacheEntrySpy).toHaveBeenCalledTimes(1);
    expect(setCacheEntryArgs).toMatchSnapshot();
    expect(credentialsCacheSaveSpy).toHaveBeenCalledTimes(1);
  }

  it('Has an expected cached credential name (write not allowed)', async () => {
    await testCredentialCache(false);
  });

  it('Has an expected cached credential name (write allowed)', async () => {
    await testCredentialCache(true);
  });
});
