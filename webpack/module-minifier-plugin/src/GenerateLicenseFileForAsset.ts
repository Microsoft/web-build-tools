// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import * as webpack from 'webpack';
import { ConcatSource } from 'webpack-sources';
import { IAssetInfo, IModuleMap, IModuleInfo, IExtendedModule } from './ModuleMinifierPlugin.types';

function getAllComments(moduleIds: (string | number)[], minifiedModules: IModuleMap): Set<string> {
  const allComments: Set<string> = new Set();

  for (const moduleId of moduleIds) {
    const mod: IModuleInfo | undefined = minifiedModules.get(moduleId);
    if (!mod) {
      continue;
    }

    const { module: webpackModule } = mod;
    const modules: IExtendedModule[] = webpackModule.modules || [webpackModule];
    for (const submodule of modules) {
      const { comments: subModuleComments } = submodule.factoryMeta;
      if (subModuleComments) {
        for (const comment of subModuleComments) {
          allComments.add(comment);
        }
      }
    }
  }

  return allComments;
}

/**
 * Generates a companion asset containing all extracted comments. If it is non-empty, returns a banner comment directing users to said companion asset.
 *
 * @param compilation - The webpack compilation
 * @param asset - The asset to process
 * @param minifiedModules - The minified modules to pull comments from
 * @param assetName - The name of the asset
 * @public
 */
export function generateLicenseFileForAsset(
  compilation: webpack.compilation.Compilation,
  asset: IAssetInfo,
  minifiedModules: IModuleMap
): string {
  // Extracted comments from the modules.
  const comments: Set<string> = getAllComments(asset.modules, minifiedModules);

  const assetName: string = asset.fileName;

  let banner: string = '';

  if (comments.size) {
    // There are license comments in this chunk, so generate the companion file and inject a banner
    const licenseSource: ConcatSource = new ConcatSource();
    comments.forEach((comment) => {
      licenseSource.add(comment);
    });
    const licenseFileName: string = `${assetName}.LICENSE.txt`;
    compilation.assets[licenseFileName] = licenseSource;
    banner = `/*! For license information please see ${path.basename(licenseFileName)} */\n`;
  }

  return banner;
}
