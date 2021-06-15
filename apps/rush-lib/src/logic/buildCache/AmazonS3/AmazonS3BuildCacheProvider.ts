// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminal } from '@rushstack/terminal';

import { EnvironmentConfiguration, EnvironmentVariableNames } from '../../../api/EnvironmentConfiguration';
import { CloudBuildCacheProviderBase } from '../CloudBuildCacheProviderBase';
import { CredentialCache, ICredentialCacheEntry } from '../../CredentialCache';
import { RushConstants } from '../../RushConstants';
import { AmazonS3Client, IAmazonS3Credentials } from './AmazonS3Client';

export interface IAmazonS3BuildCacheProviderOptions {
  s3Bucket: string;
  s3Region: string;
  s3Prefix?: string;
  isCacheWriteAllowed: boolean;
}

export class AmazonS3BuildCacheProvider extends CloudBuildCacheProviderBase {
  private readonly _options: IAmazonS3BuildCacheProviderOptions;
  private readonly _s3Prefix: string | undefined;
  private readonly _environmentCredential: string | undefined;
  private readonly _isCacheWriteAllowedByConfiguration: boolean;
  private __credentialCacheId: string | undefined;

  public get isCacheWriteAllowed(): boolean {
    return EnvironmentConfiguration.buildCacheWriteAllowed ?? this._isCacheWriteAllowedByConfiguration;
  }

  private __s3Client: AmazonS3Client | undefined;

  public constructor(options: IAmazonS3BuildCacheProviderOptions) {
    super();
    this._options = options;
    this._s3Prefix = options.s3Prefix;
    this._environmentCredential = EnvironmentConfiguration.buildCacheCredential;
    this._isCacheWriteAllowedByConfiguration = options.isCacheWriteAllowed;
  }

  private get _credentialCacheId(): string {
    if (!this.__credentialCacheId) {
      const cacheIdParts: string[] = ['aws-s3', this._options.s3Region, this._options.s3Bucket];

      if (this._isCacheWriteAllowedByConfiguration) {
        cacheIdParts.push('cacheWriteAllowed');
      }

      this.__credentialCacheId = cacheIdParts.join('|');
    }

    return this.__credentialCacheId;
  }

  private async _getS3ClientAsync(): Promise<AmazonS3Client> {
    if (!this.__s3Client) {
      let credentials: IAmazonS3Credentials | undefined = AmazonS3Client.tryDeserializeCredentials(
        this._environmentCredential
      );
      if (!credentials) {
        let cacheEntry: ICredentialCacheEntry | undefined;
        await CredentialCache.usingAsync(
          {
            supportEditing: false
          },
          (credentialsCache: CredentialCache) => {
            cacheEntry = credentialsCache.tryGetCacheEntry(this._credentialCacheId);
          }
        );

        if (cacheEntry) {
          const expirationTime: number | undefined = cacheEntry.expires?.getTime();
          if (expirationTime && expirationTime < Date.now()) {
            throw new Error(
              'Cached Amazon S3 credentials have expired. ' +
                `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}".`
            );
          } else {
            credentials = AmazonS3Client.tryDeserializeCredentials(cacheEntry?.credential);
          }
        } else if (this._isCacheWriteAllowedByConfiguration) {
          throw new Error(
            "An Amazon S3 credential hasn't been provided, or has expired. " +
              `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}", ` +
              `or provide an <AccessKeyId>:<SecretAccessKey> pair in the ` +
              `${EnvironmentVariableNames.RUSH_BUILD_CACHE_CREDENTIAL} environment variable`
          );
        }
      }

      this.__s3Client = new AmazonS3Client(credentials, this._options);
    }

    return this.__s3Client;
  }

  public async tryGetCacheEntryBufferByIdAsync(
    terminal: ITerminal,
    cacheId: string
  ): Promise<Buffer | undefined> {
    try {
      const client: AmazonS3Client = await this._getS3ClientAsync();
      return await client.getObjectAsync(this._s3Prefix ? `${this._s3Prefix}/${cacheId}` : cacheId);
    } catch (e) {
      terminal.writeWarningLine(`Error getting cache entry from S3: ${e}`);
      return undefined;
    }
  }

  public async trySetCacheEntryBufferAsync(
    terminal: ITerminal,
    cacheId: string,
    objectBuffer: Buffer
  ): Promise<boolean> {
    if (!this.isCacheWriteAllowed) {
      terminal.writeErrorLine('Writing to S3 cache is not allowed in the current configuration.');
      return false;
    }

    try {
      const client: AmazonS3Client = await this._getS3ClientAsync();
      await client.uploadObjectAsync(this._s3Prefix ? `${this._s3Prefix}/${cacheId}` : cacheId, objectBuffer);
      return true;
    } catch (e) {
      terminal.writeWarningLine(`Error uploading cache entry to S3: ${e}`);
      return false;
    }
  }

  public async updateCachedCredentialAsync(terminal: ITerminal, credential: string): Promise<void> {
    await CredentialCache.usingAsync(
      {
        supportEditing: true
      },
      async (credentialsCache: CredentialCache) => {
        credentialsCache.setCacheEntry(this._credentialCacheId, credential);
        await credentialsCache.saveIfModifiedAsync();
      }
    );
  }

  public async updateCachedCredentialInteractiveAsync(terminal: ITerminal): Promise<void> {
    throw new Error(
      'The interactive cloud credentials flow is not supported for Amazon S3.\n' +
        'Install and authenticate with aws-cli, or provide your credentials to rush using the --credential flag instead.'
    );
  }

  public async deleteCachedCredentialsAsync(terminal: ITerminal): Promise<void> {
    await CredentialCache.usingAsync(
      {
        supportEditing: true
      },
      async (credentialsCache: CredentialCache) => {
        credentialsCache.deleteCacheEntry(this._credentialCacheId);
        await credentialsCache.saveIfModifiedAsync();
      }
    );
  }
}
