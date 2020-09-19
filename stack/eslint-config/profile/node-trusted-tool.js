// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// This profile enables lint rules intended for a Node.js project whose inputs will always
// come from a developer or other trusted source.  Most build system tasks are like this,
// since they operate exclusively files prepared by a developer.
//
// This profile disables certain security rules that would otherwise prohibit APIs that could
// cause a denial-of-service by consuming too many resources, or which might interact with
// the filesystem in unsafe ways.  Such activities are safe and commonplace for a trusted tool.

const common = require('./_common');

module.exports = {
  ...common,

  // Disabled because build tools will commonly read a RegExp from a config file and then
  // apply it to inputs such as file paths.
  '@rushstack/security/no-unsafe-regexp': 'off'
};