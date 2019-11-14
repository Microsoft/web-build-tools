// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  TSDocConfiguration,
  TSDocTagDefinition,
  TSDocTagSyntaxKind,
  StandardTags
} from '@microsoft/tsdoc';

/**
 * @internal
 */
export class AedocDefinitions {
  public static readonly betaDocumentation: TSDocTagDefinition = new TSDocTagDefinition({
    tagName: '@betaDocumentation',
    syntaxKind: TSDocTagSyntaxKind.ModifierTag
  });

  public static readonly internalRemarks: TSDocTagDefinition = new TSDocTagDefinition({
    tagName: '@internalRemarks',
    syntaxKind: TSDocTagSyntaxKind.BlockTag
  });

  public static readonly preapprovedTag: TSDocTagDefinition = new TSDocTagDefinition({
    tagName: '@preapproved',
    syntaxKind: TSDocTagSyntaxKind.ModifierTag
  });

  /**
   * @deprecated Use `AedocDefinitions.getTsdocConfiguration()` instead, to allow customization of supported tags
   * without polluting a global object.
   */
  public static get tsdocConfiguration(): TSDocConfiguration {
    if (!AedocDefinitions._tsdocConfiguration) {
      AedocDefinitions._tsdocConfiguration = AedocDefinitions.getTsdocConfiguration([]);
    }
    return AedocDefinitions._tsdocConfiguration;
  }

  private static _tsdocConfiguration: TSDocConfiguration | undefined;

  /**
   * Gets a TSDoc configuration, optionally with additional supported tags.
   */
  public static getTsdocConfiguration(additionalTags: ReadonlyArray<TSDocTagDefinition> = []): TSDocConfiguration {
    const configuration: TSDocConfiguration = new TSDocConfiguration();
    configuration.addTagDefinitions([
      AedocDefinitions.betaDocumentation,
      AedocDefinitions.internalRemarks,
      AedocDefinitions.preapprovedTag,
      ...additionalTags
    ], true);

    configuration.setSupportForTags(
      [
        StandardTags.alpha,
        StandardTags.beta,
        StandardTags.defaultValue,
        StandardTags.deprecated,
        StandardTags.eventProperty,
        StandardTags.example,
        StandardTags.inheritDoc,
        StandardTags.internal,
        StandardTags.link,
        StandardTags.override,
        StandardTags.packageDocumentation,
        StandardTags.param,
        StandardTags.privateRemarks,
        StandardTags.public,
        StandardTags.readonly,
        StandardTags.remarks,
        StandardTags.returns,
        StandardTags.sealed,
        StandardTags.virtual
      ],
      true
    );

    return configuration;
  }
}
