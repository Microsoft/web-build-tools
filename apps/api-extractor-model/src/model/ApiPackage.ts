// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { DeclarationReference } from '@microsoft/tsdoc/lib/beta/DeclarationReference';
import * as tsdoc from '@microsoft/tsdoc';
import { ApiItem, ApiItemKind, IApiItemJson } from '../items/ApiItem';
import { ApiItemContainerMixin, IApiItemContainerMixinOptions } from '../mixins/ApiItemContainerMixin';
import { JsonFile, IJsonFileSaveOptions, PackageJsonLookup, IPackageJson } from '@microsoft/node-core-library';
import { ApiDocumentedItem, IApiDocumentedItemOptions } from '../items/ApiDocumentedItem';
import { ApiEntryPoint } from './ApiEntryPoint';
import { IApiNameMixinOptions, ApiNameMixin } from '../mixins/ApiNameMixin';
import { DeserializerContext, ApiJsonSchemaVersion } from './DeserializerContext';

/**
 * Constructor options for {@link ApiPackage}.
 * @public
 */
export interface IApiPackageOptions extends
  IApiItemContainerMixinOptions,
  IApiNameMixinOptions,
  IApiDocumentedItemOptions {
}

export interface IApiPackageMetadataJson {
  /**
   * The NPM package name for the tool that wrote the *.api.json file.
   * For informational purposes only.
   */
  toolPackage: string;

  /**
   * The NPM package version for the tool that wrote the *.api.json file.
   * For informational purposes only.
   */
  toolVersion: string;

  /**
   * The schema version for the .api.json file format.  Used for determining whether the file format is
   * supported, and for backwards compatibility.
   */
  schemaVersion: ApiJsonSchemaVersion;

  /**
   * To support forwards compatibility, the `oldestForwardsCompatibleVersion` field tracks the oldest schema version
   * whose corresponding deserializer could safely load this file.
   *
   * @remarks
   * Normally api-extractor-model should refuse to load a schema version that is newer than the latest version
   * that its deserializer understands.  However, sometimes a schema change may merely introduce some new fields
   * without modifying or removing any existing fields.  In this case, an older api-extractor-model library can
   * safely deserialize the newer version (by ignoring the extra fields that it doesn't recognize).  The newer
   * serializer can use this field to communicate that.
   *
   * If present, the `oldestForwardsCompatibleVersion` must be less than or equal to
   * `IApiPackageMetadataJson.schemaVersion`.
   */
  oldestForwardsCompatibleVersion?: ApiJsonSchemaVersion;
}

export interface IApiPackageJson extends IApiItemJson {
  /**
   * A file header that stores metadata about the tool that wrote the *.api.json file.
   */
  metadata: IApiPackageMetadataJson;
}

/**
 * Options for {@link ApiPackage.saveToJsonFile}.
 * @public
 */
export interface IApiPackageSaveOptions extends IJsonFileSaveOptions {
  /**
   * Optionally specifies a value for the "toolPackage" field in the output .api.json data file;
   * otherwise, the value will be "api-extractor-model".
   */
  toolPackage?: string;

  /**
   * Optionally specifies a value for the "toolVersion" field in the output .api.json data file;
   * otherwise, the value will be the current version of the api-extractor-model package.
   */
  toolVersion?: string;

  /**
   * Set to true only when invoking API Extractor's test harness.
   *
   * @remarks
   * When `testMode` is true, the `toolVersion` field in the .api.json file is assigned an empty string
   * to prevent spurious diffs in output files tracked for tests.
   */
  testMode?: boolean;
}

/**
 * Represents an NPM package containing API declarations.
 *
 * @remarks
 *
 * This is part of the {@link ApiModel} hierarchy of classes, which are serializable representations of
 * API declarations.
 *
 * @public
 */
export class ApiPackage extends ApiItemContainerMixin(ApiNameMixin(ApiDocumentedItem)) {

  public constructor(options: IApiPackageOptions) {
    super(options);
  }

  public static loadFromJsonFile(apiJsonFilename: string, tsdocConfig?: tsdoc.TSDocConfiguration): ApiPackage {
    const jsonObject: IApiPackageJson = JsonFile.load(apiJsonFilename);

    if (!jsonObject
      || !jsonObject.metadata
      || typeof jsonObject.metadata.schemaVersion !== 'number') {
        throw new Error(`Error loading ${apiJsonFilename}:`
        + `\nThe file format is not recognized; the "metadata.schemaVersion" field is missing or invalid`);
    }

    const schemaVersion: number = jsonObject.metadata.schemaVersion;

    if (schemaVersion < ApiJsonSchemaVersion.OLDEST_SUPPORTED) {
      throw new Error(`Error loading ${apiJsonFilename}:`
        + `\nThe file format is version ${schemaVersion},`
        + ` whereas ${ApiJsonSchemaVersion.OLDEST_SUPPORTED} is the oldest version supported by this tool`);
    }

    let oldestForwardsCompatibleVersion: number = schemaVersion;
    if (jsonObject.metadata.oldestForwardsCompatibleVersion) {
      // Sanity check
      if (jsonObject.metadata.oldestForwardsCompatibleVersion > schemaVersion) {
        throw new Error(`Error loading ${apiJsonFilename}:`
        + `\nInvalid file format; "oldestForwardsCompatibleVersion" cannot be newer than "schemaVersion"`);
      }
      oldestForwardsCompatibleVersion = jsonObject.metadata.oldestForwardsCompatibleVersion;
    }

    let versionToDeserialize: number = schemaVersion;
    if (versionToDeserialize > ApiJsonSchemaVersion.LATEST) {
      // If the file format is too new, can we treat it as some earlier compatible version
      // as indicated by oldestForwardsCompatibleVersion?
      versionToDeserialize = Math.max(oldestForwardsCompatibleVersion, ApiJsonSchemaVersion.LATEST);

      if (versionToDeserialize > ApiJsonSchemaVersion.LATEST) {
        // Nope, still too new
        throw new Error(`Error loading ${apiJsonFilename}:`
        + `\nThe file format version ${schemaVersion} was written by a newer release of`
        + ` the api-extractor-model library; you may need to upgrade your software`);
      }
    }

    const context: DeserializerContext = new DeserializerContext({
      apiJsonFilename,
      toolPackage: jsonObject.metadata.toolPackage,
      toolVersion: jsonObject.metadata.toolVersion,
      versionToDeserialize: versionToDeserialize,
      tsdocConfig
    });

    return ApiItem.deserialize(jsonObject, context) as ApiPackage;
  }

  /** @override */
  public get kind(): ApiItemKind {
    return ApiItemKind.Package;
  }

  /** @override */
  public get containerKey(): string {
    // No prefix needed, because ApiPackage is the only possible member of an ApiModel
    return this.name;
  }

  public get entryPoints(): ReadonlyArray<ApiEntryPoint> {
    return this.members as ReadonlyArray<ApiEntryPoint>;
  }

  /** @override */
  public addMember(member: ApiEntryPoint): void {
    if (member.kind !== ApiItemKind.EntryPoint) {
      throw new Error('Only items of type ApiEntryPoint may be added to an ApiPackage');
    }
    super.addMember(member);
  }

  public findEntryPointsByPath(importPath: string): ReadonlyArray<ApiEntryPoint> {
    return this.findMembersByName(importPath) as ReadonlyArray<ApiEntryPoint>;
  }

  public saveToJsonFile(apiJsonFilename: string, options?: IApiPackageSaveOptions): void {
    if (!options) {
      options = {};
    }

    const packageJson: IPackageJson = PackageJsonLookup.loadOwnPackageJson(__dirname);

    const jsonObject: IApiPackageJson = {
      metadata: {
        toolPackage: options.toolPackage || packageJson.name,
        // In test mode, we don't write the real version, since that would cause spurious diffs whenever
        // the version is bumped.  Instead we write a placeholder string.
        toolVersion: options.testMode ? '[test mode]' : options.toolVersion || packageJson.version,
        schemaVersion: ApiJsonSchemaVersion.LATEST,
        oldestForwardsCompatibleVersion: ApiJsonSchemaVersion.OLDEST_FORWARDS_COMPATIBLE
      }
    } as IApiPackageJson;
    this.serializeInto(jsonObject);
    JsonFile.save(jsonObject, apiJsonFilename, options);
  }

  /** @beta @override */
  public buildCanonicalReference(): DeclarationReference {
    return DeclarationReference.package(this.name);
  }
}
