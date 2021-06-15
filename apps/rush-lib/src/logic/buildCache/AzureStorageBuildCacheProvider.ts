// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ITerminal } from '@rushstack/terminal';
import {
  BlobClient,
  BlobServiceClient,
  BlockBlobClient,
  ContainerClient,
  ContainerSASPermissions,
  generateBlobSASQueryParameters,
  SASQueryParameters,
  ServiceGetUserDelegationKeyResponse
} from '@azure/storage-blob';
import { DeviceCodeCredential, DeviceCodeInfo } from '@azure/identity';

import { EnvironmentConfiguration, EnvironmentVariableNames } from '../../api/EnvironmentConfiguration';
import { CredentialCache, ICredentialCacheEntry } from '../CredentialCache';
import { RushConstants } from '../RushConstants';
import { Utilities } from '../../utilities/Utilities';
import { CloudBuildCacheProviderBase } from './CloudBuildCacheProviderBase';

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
// TODO: This is a temporary workaround; it should be reverted when we upgrade to "@azure/identity" version 2.x
// import { AzureAuthorityHosts } from '@azure/identity';
export enum AzureAuthorityHosts {
  AzureChina = 'https://login.chinacloudapi.cn',
  AzureGermany = 'https://login.microsoftonline.de',
  AzureGovernment = 'https://login.microsoftonline.us',
  AzurePublicCloud = 'https://login.microsoftonline.com'
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

export type AzureEnvironmentNames = keyof typeof AzureAuthorityHosts;

export interface IAzureStorageBuildCacheProviderOptions {
  storageContainerName: string;
  storageAccountName: string;
  azureEnvironment?: AzureEnvironmentNames;
  blobPrefix?: string;
  isCacheWriteAllowed: boolean;
}

const SAS_TTL_MILLISECONDS: number = 7 * 24 * 60 * 60 * 1000; // Seven days

export class AzureStorageBuildCacheProvider extends CloudBuildCacheProviderBase {
  private readonly _storageAccountName: string;
  private readonly _storageContainerName: string;
  private readonly _azureEnvironment: AzureEnvironmentNames;
  private readonly _blobPrefix: string | undefined;
  private readonly _environmentCredential: string | undefined;
  private readonly _isCacheWriteAllowedByConfiguration: boolean;
  private __credentialCacheId: string | undefined;

  public get isCacheWriteAllowed(): boolean {
    return EnvironmentConfiguration.buildCacheWriteAllowed ?? this._isCacheWriteAllowedByConfiguration;
  }

  private _containerClient: ContainerClient | undefined;

  public constructor(options: IAzureStorageBuildCacheProviderOptions) {
    super();
    this._storageAccountName = options.storageAccountName;
    this._storageContainerName = options.storageContainerName;
    this._azureEnvironment = options.azureEnvironment || 'AzurePublicCloud';
    this._blobPrefix = options.blobPrefix;
    this._environmentCredential = EnvironmentConfiguration.buildCacheCredential;
    this._isCacheWriteAllowedByConfiguration = options.isCacheWriteAllowed;

    if (!(this._azureEnvironment in AzureAuthorityHosts)) {
      throw new Error(
        `The specified Azure Environment ("${this._azureEnvironment}") is invalid. If it is specified, it must ` +
          `be one of: ${Object.keys(AzureAuthorityHosts).join(', ')}`
      );
    }
  }

  private get _credentialCacheId(): string {
    if (!this.__credentialCacheId) {
      const cacheIdParts: string[] = [
        'azure-blob-storage',
        this._azureEnvironment,
        this._storageAccountName,
        this._storageContainerName
      ];

      if (this._isCacheWriteAllowedByConfiguration) {
        cacheIdParts.push('cacheWriteAllowed');
      }

      this.__credentialCacheId = cacheIdParts.join('|');
    }

    return this.__credentialCacheId;
  }

  private get _storageAccountUrl(): string {
    return `https://${this._storageAccountName}.blob.core.windows.net/`;
  }

  public async tryGetCacheEntryBufferByIdAsync(
    terminal: ITerminal,
    cacheId: string
  ): Promise<Buffer | undefined> {
    const blobClient: BlobClient = await this._getBlobClientForCacheIdAsync(cacheId);
    try {
      const blobExists: boolean = await blobClient.exists();
      if (blobExists) {
        return await blobClient.downloadToBuffer();
      } else {
        return undefined;
      }
    } catch (e) {
      const errorMessage: string =
        'Error getting cache entry from Azure Storage: ' +
        [e.name, e.message, e.response?.status, e.response?.parsedHeaders?.errorCode]
          .filter((piece: string | undefined) => piece)
          .join(' ');

      if (e.response?.parsedHeaders?.errorCode === 'PublicAccessNotPermitted') {
        // This error means we tried to read the cache with no credentials, but credentials are required.
        // We'll assume that the configuration of the cache is correct and the user has to take action.
        terminal.writeWarningLine(
          `${errorMessage}\n\n` +
            `You need to configure Azure Storage SAS credentials to access the build cache.\n` +
            `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}", \n` +
            `or provide a SAS in the ` +
            `${EnvironmentVariableNames.RUSH_BUILD_CACHE_CREDENTIAL} environment variable.`
        );
      } else if (e.response?.parsedHeaders?.errorCode === 'AuthenticationFailed') {
        // This error means the user's credentials are incorrect, but not expired normally. They might have
        // gotten corrupted somehow, or revoked manually in Azure Portal.
        terminal.writeWarningLine(
          `${errorMessage}\n\n` +
            `Your Azure Storage SAS credentials are not valid.\n` +
            `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}", \n` +
            `or provide a SAS in the ` +
            `${EnvironmentVariableNames.RUSH_BUILD_CACHE_CREDENTIAL} environment variable.`
        );
      } else if (e.response?.parsedHeaders?.errorCode === 'AuthorizationPermissionMismatch') {
        // This error is not solvable by the user, so we'll assume it is a configuration error, and revert
        // to providing likely next steps on configuration. (Hopefully this error is rare for a regular
        // developer, more likely this error will appear while someone is configuring the cache for the
        // first time.)
        terminal.writeWarningLine(
          `${errorMessage}\n\n` +
            `Your Azure Storage SAS credentials are valid, but do not have permission to read the build cache.\n` +
            `Make sure you have added the role 'Storage Blob Data Reader' to the appropriate user(s) or group(s)\n` +
            `on your storage account in the Azure Portal.`
        );
      } else {
        // We don't know what went wrong, hopefully we'll print something useful.
        terminal.writeWarningLine(errorMessage);
      }
      return undefined;
    }
  }

  public async trySetCacheEntryBufferAsync(
    terminal: ITerminal,
    cacheId: string,
    entryStream: Buffer
  ): Promise<boolean> {
    if (!this.isCacheWriteAllowed) {
      terminal.writeErrorLine(
        'Writing to Azure Blob Storage cache is not allowed in the current configuration.'
      );
      return false;
    }

    const blobClient: BlobClient = await this._getBlobClientForCacheIdAsync(cacheId);
    const blockBlobClient: BlockBlobClient = blobClient.getBlockBlobClient();
    let blobAlreadyExists: boolean = false;

    try {
      blobAlreadyExists = await blockBlobClient.exists();
    } catch (e) {
      // If RUSH_BUILD_CACHE_CREDENTIAL is set but is corrupted or has been rotated
      // in Azure Portal, or the user's own cached credentials have been corrupted or
      // invalidated, we'll print the error and continue (this way we don't fail the
      // actual rush build).
      const errorMessage: string =
        'Error checking if cache entry exists in Azure Storage: ' +
        [e.name, e.message, e.response?.status, e.response?.parsedHeaders?.errorCode]
          .filter((piece: string | undefined) => piece)
          .join(' ');

      terminal.writeWarningLine(errorMessage);
    }

    if (blobAlreadyExists) {
      terminal.writeVerboseLine('Build cache entry blob already exists.');
      return true;
    } else {
      try {
        await blockBlobClient.upload(entryStream, entryStream.length);
        return true;
      } catch (e) {
        if (e.statusCode === 409 /* conflict */) {
          // If something else has written to the blob at the same time,
          // it's probably a concurrent process that is attempting to write
          // the same cache entry. That is an effective success.
          terminal.writeVerboseLine(
            'Azure Storage returned status 409 (conflict). The cache entry has ' +
              `probably already been set by another builder. Code: "${e.code}".`
          );
          return true;
        } else {
          terminal.writeWarningLine(`Error uploading cache entry to Azure Storage: ${e}`);
          return false;
        }
      }
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
    const sasQueryParameters: SASQueryParameters = await this._getSasQueryParametersAsync(terminal);
    const sasString: string = sasQueryParameters.toString();

    await CredentialCache.usingAsync(
      {
        supportEditing: true
      },
      async (credentialsCache: CredentialCache) => {
        credentialsCache.setCacheEntry(this._credentialCacheId, sasString, sasQueryParameters.expiresOn);
        await credentialsCache.saveIfModifiedAsync();
      }
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

  private async _getBlobClientForCacheIdAsync(cacheId: string): Promise<BlobClient> {
    const client: ContainerClient = await this._getContainerClientAsync();
    const blobName: string = this._blobPrefix ? `${this._blobPrefix}/${cacheId}` : cacheId;
    return client.getBlobClient(blobName);
  }

  private async _getContainerClientAsync(): Promise<ContainerClient> {
    if (!this._containerClient) {
      let sasString: string | undefined = this._environmentCredential;
      if (!sasString) {
        let cacheEntry: ICredentialCacheEntry | undefined;
        await CredentialCache.usingAsync(
          {
            supportEditing: false
          },
          (credentialsCache: CredentialCache) => {
            cacheEntry = credentialsCache.tryGetCacheEntry(this._credentialCacheId);
          }
        );

        const expirationTime: number | undefined = cacheEntry?.expires?.getTime();
        if (expirationTime && expirationTime < Date.now()) {
          throw new Error(
            'Cached Azure Storage credentials have expired. ' +
              `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}".`
          );
        } else {
          sasString = cacheEntry?.credential;
        }
      }

      let blobServiceClient: BlobServiceClient;
      if (sasString) {
        const connectionString: string = this._getConnectionString(sasString);
        blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      } else if (!this._isCacheWriteAllowedByConfiguration) {
        // If cache write isn't allowed and we don't have a credential, assume the blob supports anonymous read
        blobServiceClient = new BlobServiceClient(this._storageAccountUrl);
      } else {
        throw new Error(
          "An Azure Storage SAS credential hasn't been provided, or has expired. " +
            `Update the credentials by running "rush ${RushConstants.updateCloudCredentialsCommandName}", ` +
            `or provide a SAS in the ` +
            `${EnvironmentVariableNames.RUSH_BUILD_CACHE_CREDENTIAL} environment variable`
        );
      }

      this._containerClient = blobServiceClient.getContainerClient(this._storageContainerName);
    }

    return this._containerClient;
  }

  private async _getSasQueryParametersAsync(terminal: ITerminal): Promise<SASQueryParameters> {
    const authorityHost: string | undefined = AzureAuthorityHosts[this._azureEnvironment];
    if (!authorityHost) {
      throw new Error(`Unexpected Azure environment: ${this._azureEnvironment}`);
    }

    const DeveloperSignOnClientId: string = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';
    const deviceCodeCredential: DeviceCodeCredential = new DeviceCodeCredential(
      'organizations',
      DeveloperSignOnClientId,
      (deviceCodeInfo: DeviceCodeInfo) => {
        Utilities.printMessageInBox(deviceCodeInfo.message, terminal);
      },
      { authorityHost: authorityHost }
    );
    const blobServiceClient: BlobServiceClient = new BlobServiceClient(
      this._storageAccountUrl,
      deviceCodeCredential
    );

    const startsOn: Date = new Date();
    const expires: Date = new Date(Date.now() + SAS_TTL_MILLISECONDS);
    const key: ServiceGetUserDelegationKeyResponse = await blobServiceClient.getUserDelegationKey(
      startsOn,
      expires
    );

    const containerSasPermissions: ContainerSASPermissions = new ContainerSASPermissions();
    containerSasPermissions.read = true;
    containerSasPermissions.write = this._isCacheWriteAllowedByConfiguration;

    const queryParameters: SASQueryParameters = generateBlobSASQueryParameters(
      {
        startsOn: startsOn,
        expiresOn: expires,
        permissions: containerSasPermissions,
        containerName: this._storageContainerName
      },
      key,
      this._storageAccountName
    );

    return queryParameters;
  }

  private _getConnectionString(sasString: string | undefined): string {
    const blobEndpoint: string = `BlobEndpoint=${this._storageAccountUrl}`;
    if (sasString) {
      const connectionString: string = `${blobEndpoint};SharedAccessSignature=${sasString}`;
      return connectionString;
    } else {
      return blobEndpoint;
    }
  }
}
