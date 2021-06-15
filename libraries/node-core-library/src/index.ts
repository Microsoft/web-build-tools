// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * Core libraries that every NodeJS toolchain project should use.
 *
 * @packageDocumentation
 */

export { AlreadyReportedError } from './AlreadyReportedError';
export { Async, IAsyncParallelismOptions } from './Async';
export { Brand } from './PrimitiveTypes';
export { FileConstants, FolderConstants } from './Constants';
export { Enum } from './Enum';
export { EnvironmentMap, IEnvironmentEntry } from './EnvironmentMap';
export {
  ExecutableStdioStreamMapping,
  ExecutableStdioMapping,
  IExecutableResolveOptions,
  IExecutableSpawnSyncOptions,
  IExecutableSpawnOptions,
  Executable
} from './Executable';
export {
  INodePackageJson,
  IPackageJson,
  IPackageJsonDependencyTable,
  IPackageJsonScriptTable
} from './IPackageJson';
export {
  Import,
  IImportResolveOptions,
  IImportResolveModuleOptions,
  IImportResolvePackageOptions
} from './Import';
export { InternalError } from './InternalError';
export { JsonObject, JsonFile, JsonNull, IJsonFileSaveOptions, IJsonFileStringifyOptions } from './JsonFile';
export {
  JsonSchema,
  IJsonSchemaErrorInfo,
  IJsonSchemaValidateOptions,
  IJsonSchemaFromFileOptions
} from './JsonSchema';
export { LockFile } from './LockFile';
export { MapExtensions } from './MapExtensions';
export { PosixModeBits } from './PosixModeBits';
export { ProtectableMap, IProtectableMapParameters } from './ProtectableMap';
export { IPackageJsonLookupParameters, PackageJsonLookup } from './PackageJsonLookup';
export {
  PackageName,
  PackageNameParser,
  IPackageNameParserOptions,
  IParsedPackageName,
  IParsedPackageNameOrError
} from './PackageName';
export { Path, IPathFormatConciselyOptions } from './Path';
export { Encoding, Text, NewlineKind } from './Text';
export { Sort } from './Sort';
export {
  AlreadyExistsBehavior,
  FileSystem,
  FileSystemCopyFilesAsyncFilter,
  FileSystemCopyFilesFilter,
  FileSystemStats,
  IFileSystemCopyFileBaseOptions,
  IFileSystemCopyFileOptions,
  IFileSystemCopyFilesAsyncOptions,
  IFileSystemCopyFilesOptions,
  IFileSystemCreateLinkOptions,
  IFileSystemDeleteFileOptions,
  IFileSystemMoveOptions,
  IFileSystemReadFileOptions,
  IFileSystemReadFolderOptions,
  IFileSystemUpdateTimeParameters,
  IFileSystemWriteFileOptions
} from './FileSystem';
export { FileWriter, IFileWriterFlags } from './FileWriter';
export { LegacyAdapters, LegacyCallback } from './LegacyAdapters';
export { StringBuilder, IStringBuilder } from './StringBuilder';
export { TypeUuid } from './TypeUuid';
