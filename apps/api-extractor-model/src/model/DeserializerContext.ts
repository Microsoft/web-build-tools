// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as tsdoc from '@microsoft/tsdoc';

export enum ApiJsonSchemaVersion {
  /**
   * The initial release.
   */
  V_1000 = 1000,

  /**
   * Add support for type parameters and type alias types.
   */
  V_1001 = 1001,

  /**
   * Remove "canonicalReference" field.  This field was for diagnostic purposes only and was never deserialized.
   */
  V_1002 = 1002,

  /**
   * Reintroduce the "canonicalReference" field using the experimental new TSDoc declaration reference notation.
   *
   * This is not a breaking change because this field is never deserialized; it is provided for informational
   * purposes only.
   */
  V_1003 = 1003,

  /**
   * The current latest .api.json schema version.
   *
   * IMPORTANT: When incrementing this number, consider whether `OLDEST_SUPPORTED` or `OLDEST_FORWARDS_COMPATIBLE`
   * should be updated.
   */
  LATEST = V_1003,

  /**
   * The oldest .api.json schema version that is still supported for backwards compatibility.
   *
   * This must be updated if you change to the file format and do not implement compatibility logic for
   * deserializing the older representation.
   */
  OLDEST_SUPPORTED = V_1001,

  /**
   * Used to assign `IApiPackageMetadataJson.oldestForwardsCompatibleVersion`.
   *
   * This value must be \<= `ApiJsonSchemaVersion.LATEST`.  It must be reset to the `LATEST` value
   * if the older library would not be able to deserialize your new file format.  Adding a nonessential field
   * is generally okay.  Removing, modifying, or reinterpreting existing fields is NOT safe.
   */
  OLDEST_FORWARDS_COMPATIBLE = V_1001
}

export class DeserializerContext {
  /**
   * The path of the file being deserialized, which may be useful for diagnostic purposes.
   */
  public readonly apiJsonFilename: string;

  /**
   * Metadata from `IApiPackageMetadataJson.toolPackage`.
   */
  public readonly toolPackage: string;

  /**
   * Metadata from `IApiPackageMetadataJson.toolVersion`.
   */
  public readonly toolVersion: string;

  /**
   * The version of the schema being deserialized, as obtained from `IApiPackageMetadataJson.schemaVersion`.
   */
  public readonly versionToDeserialize: ApiJsonSchemaVersion;

  /**
   * TSDoc configuration to use when deserializing documentation comments.
   */
  public readonly tsdocConfig?: tsdoc.TSDocConfiguration;

  public constructor(options: DeserializerContext) {
    this.apiJsonFilename = options.apiJsonFilename;
    this.toolPackage = options.toolPackage;
    this.toolVersion = options.toolVersion;
    this.versionToDeserialize = options.versionToDeserialize;
    this.tsdocConfig = options.tsdocConfig;
  }
}
