// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import * as resolve from 'resolve';
import lodash = require('lodash');
import * as tsdoc from '@microsoft/tsdoc';

import {
  JsonFile,
  JsonSchema,
  FileSystem,
  PackageJsonLookup,
  INodePackageJson,
  PackageName,
  Text,
  InternalError,
  Path
} from '@microsoft/node-core-library';
import {
  IConfigFile,
  IExtractorMessagesConfig,
  IConfigTsdocTagDefinition
} from './IConfigFile';
import { PackageMetadataManager } from '../analyzer/PackageMetadataManager';
import { MessageRouter } from '../collector/MessageRouter';
import { AedocDefinitions } from '@microsoft/api-extractor-model';

/**
 * Tokens used during variable expansion of path fields from api-extractor.json.
 */
interface IExtractorConfigTokenContext {
  /**
   * The `<unscopedPackageName>` token returns the project's NPM package name, without any NPM scope.
   * If there is no associated package.json file, then the value is `unknown-package`.
   *
   * Example: `my-project`
   */
  unscopedPackageName: string;

  /**
   * The `<packageName>` token returns the project's full NPM package name including any NPM scope.
   * If there is no associated package.json file, then the value is `unknown-package`.
   *
   * Example: `@scope/my-project`
   */
  packageName: string;

  projectFolder: string;
}

/**
 * Options for {@link ExtractorConfig.prepare}.
 *
 * @public
 */
export interface IExtractorConfigPrepareOptions {
  /**
   * A configuration object as returned by {@link ExtractorConfig.loadFile}.
   */
  configObject: IConfigFile;

  /**
   * The absolute path of the file that the `configObject` object was loaded from.  This is used for error messages
   * and when probing for `tsconfig.json`.
   *
   * @remarks
   *
   * If this is omitted, then the `projectFolder` must not be specified using the `<lookup>` token.
   */
  configObjectFullPath: string | undefined;

  /**
   * The parsed package.json file for the working package, or undefined if API Extractor was invoked without
   * a package.json file.
   *
   * @remarks
   *
   * If omitted, then the `<unscopedPackageName>` and `<packageName>` tokens will have default values.
   */
  packageJson?: INodePackageJson | undefined;

  /**
   * The absolute path of the file that the `packageJson` object was loaded from, or undefined if API Extractor
   * was invoked without a package.json file.
   *
   * @remarks
   *
   * This is used for error messages and when resolving paths found in package.json.
   *
   * If `packageJsonFullPath` is specified but `packageJson` is omitted, the file will be loaded automatically.
   */
  packageJsonFullPath: string | undefined;
}

interface IExtractorConfigParameters {
  projectFolder: string;
  packageJson: INodePackageJson | undefined;
  packageFolder: string | undefined;
  mainEntryPointFilePath: string;
  bundledPackages: string[];
  tsconfigFilePath: string;
  overrideTsconfig: { } | undefined;
  skipLibCheck: boolean;
  apiReportEnabled: boolean;
  reportFilePath: string;
  reportTempFilePath: string;
  docModelEnabled: boolean;
  apiJsonFilePath: string;
  rollupEnabled: boolean;
  untrimmedFilePath: string;
  betaTrimmedFilePath: string;
  publicTrimmedFilePath: string;
  omitTrimmingComments: boolean;
  tsdocMetadataEnabled: boolean;
  tsdocMetadataFilePath: string;
  tsdocConfig: tsdoc.TSDocConfiguration;
  messages: IExtractorMessagesConfig;
  testMode: boolean;
}

/**
 * The `ExtractorConfig` class loads, validates, interprets, and represents the api-extractor.json config file.
 * @public
 */
export class ExtractorConfig {
  /**
   * The JSON Schema for API Extractor config file (api-extractor.schema.json).
   */
  public static readonly jsonSchema: JsonSchema = JsonSchema.fromFile(
    path.join(__dirname, '../schemas/api-extractor.schema.json'));

  /**
   * The config file name "api-extractor.json".
   */
  public static readonly FILENAME: string = 'api-extractor.json';

  private static readonly _defaultConfig: Partial<IConfigFile> = JsonFile.load(path.join(__dirname,
    '../schemas/api-extractor-defaults.json'));

  private static readonly _declarationFileExtensionRegExp: RegExp = /\.d\.ts$/i;

  /** {@inheritDoc IConfigFile.projectFolder} */
  public readonly projectFolder: string;

  /**
   * The parsed package.json file for the working package, or undefined if API Extractor was invoked without
   * a package.json file.
   */
  public readonly packageJson: INodePackageJson | undefined;

  /**
   * The absolute path of the folder containing the package.json file for the working package, or undefined
   * if API Extractor was invoked without a package.json file.
   */
  public readonly packageFolder: string | undefined;

  /** {@inheritDoc IConfigFile.mainEntryPointFilePath} */
  public readonly mainEntryPointFilePath: string;

  /** {@inheritDoc IConfigFile.bundledPackages} */
  public readonly bundledPackages: string[];

  /** {@inheritDoc IConfigCompiler.tsconfigFilePath} */
  public readonly tsconfigFilePath: string;

  /** {@inheritDoc IConfigCompiler.overrideTsconfig} */
  public readonly overrideTsconfig: { } | undefined;

  /** {@inheritDoc IConfigCompiler.skipLibCheck} */
  public readonly skipLibCheck: boolean;

  /** {@inheritDoc IConfigApiReport.enabled} */
  public readonly apiReportEnabled: boolean;

  /** The `reportFolder` path combined with the `reportFileName`. */
  public readonly reportFilePath: string;
  /** The `reportTempFolder` path combined with the `reportFileName`. */
  public readonly reportTempFilePath: string;

  /** {@inheritDoc IConfigDocModel.enabled} */
  public readonly docModelEnabled: boolean;
  /** {@inheritDoc IConfigDocModel.apiJsonFilePath} */
  public readonly apiJsonFilePath: string;

  /** {@inheritDoc IConfigDtsRollup.enabled} */
  public readonly rollupEnabled: boolean;
  /** {@inheritDoc IConfigDtsRollup.untrimmedFilePath} */
  public readonly untrimmedFilePath: string;
  /** {@inheritDoc IConfigDtsRollup.betaTrimmedFilePath} */
  public readonly betaTrimmedFilePath: string;
  /** {@inheritDoc IConfigDtsRollup.publicTrimmedFilePath} */
  public readonly publicTrimmedFilePath: string;
  /** {@inheritDoc IConfigDtsRollup.omitTrimmingComments} */
  public readonly omitTrimmingComments: boolean;

  /** {@inheritDoc IConfigTsdocMetadata.enabled} */
  public readonly tsdocMetadataEnabled: boolean;
  /** {@inheritDoc IConfigTsdocMetadata.tsdocMetadataFilePath} */
  public readonly tsdocMetadataFilePath: string;

  /**
   * Configuration to use when parsing TSDoc comments.
   */
  public readonly tsdocConfig: tsdoc.TSDocConfiguration;

  /** {@inheritDoc IConfigFile.messages} */
  public readonly messages: IExtractorMessagesConfig;

  /** {@inheritDoc IConfigFile.testMode} */
  public readonly testMode: boolean;

  private constructor(parameters: IExtractorConfigParameters) {
    this.projectFolder = parameters.projectFolder;
    this.packageJson = parameters.packageJson;
    this.packageFolder = parameters.packageFolder;
    this.mainEntryPointFilePath = parameters.mainEntryPointFilePath;
    this.bundledPackages = parameters.bundledPackages;
    this.tsconfigFilePath = parameters.tsconfigFilePath;
    this.overrideTsconfig = parameters.overrideTsconfig;
    this.skipLibCheck = parameters.skipLibCheck;
    this.apiReportEnabled = parameters.apiReportEnabled;
    this.reportFilePath = parameters.reportFilePath;
    this.reportTempFilePath = parameters.reportTempFilePath;
    this.docModelEnabled = parameters.docModelEnabled;
    this.apiJsonFilePath = parameters.apiJsonFilePath;
    this.rollupEnabled = parameters.rollupEnabled;
    this.untrimmedFilePath = parameters.untrimmedFilePath;
    this.betaTrimmedFilePath = parameters.betaTrimmedFilePath;
    this.publicTrimmedFilePath = parameters.publicTrimmedFilePath;
    this.omitTrimmingComments = parameters.omitTrimmingComments;
    this.tsdocMetadataEnabled = parameters.tsdocMetadataEnabled;
    this.tsdocMetadataFilePath = parameters.tsdocMetadataFilePath;
    this.tsdocConfig = parameters.tsdocConfig;
    this.messages = parameters.messages;
    this.testMode = parameters.testMode;
  }

  /**
   * Returns a JSON-like string representing the `ExtractorConfig` state, which can be printed to a console
   * for diagnostic purposes.
   *
   * @remarks
   * This is used by the "--diagnostics" command-line option.  The string is not intended to be deserialized;
   * its format may be changed at any time.
   */
  public getDiagnosticDump(): string {
    const result: object = MessageRouter.buildJsonDumpObject(this);
    return JSON.stringify(result, undefined, 2);
  }

  /**
   * Returns a simplified file path for use in error messages.
   * @internal
   */
  public _getShortFilePath(absolutePath: string): string {
    if (!path.isAbsolute(absolutePath)) {
      throw new InternalError('Expected absolute path: ' + absolutePath);
    }
    if (Path.isUnderOrEqual(absolutePath, this.projectFolder)) {
      return path.relative(this.projectFolder, absolutePath).replace(/\\/g, '/');
    }
    return absolutePath;
  }

  /**
   * Loads the api-extractor.json config file from the specified file path, and prepares an `ExtractorConfig` object.
   *
   * @remarks
   * Loads the api-extractor.json config file from the specified file path.   If the "extends" field is present,
   * the referenced file(s) will be merged.  For any omitted fields, the API Extractor default values are merged.
   *
   * The result is prepared using `ExtractorConfig.prepare()`.
   */
  public static loadFileAndPrepare(configJsonFilePath: string): ExtractorConfig {
    const configObjectFullPath: string = path.resolve(configJsonFilePath);
    const configObject: IConfigFile = ExtractorConfig.loadFile(configObjectFullPath);

    const packageJsonLookup: PackageJsonLookup = new PackageJsonLookup();
    const packageJsonFullPath: string | undefined = packageJsonLookup.tryGetPackageJsonFilePathFor(
      configObjectFullPath);

    const extractorConfig: ExtractorConfig = ExtractorConfig.prepare({
      configObject,
      configObjectFullPath,
      packageJsonFullPath
    });

    return extractorConfig;
  }

  /**
   * Performs only the first half of {@link ExtractorConfig.loadFileAndPrepare}, providing an opportunity to
   * modify the object before it is passed to {@link ExtractorConfig.prepare}.
   *
   * @remarks
   * Loads the api-extractor.json config file from the specified file path.   If the "extends" field is present,
   * the referenced file(s) will be merged.  For any omitted fields, the API Extractor default values are merged.
   */
  public static loadFile(jsonFilePath: string): IConfigFile {
    // Set to keep track of config files which have been processed.
    const visitedPaths: Set<string> = new Set<string>();

    let currentConfigFilePath: string = path.resolve(process.cwd(), jsonFilePath);
    let configObject: Partial<IConfigFile> = { };

    try {
      do {
        // Check if this file was already processed.
        if (visitedPaths.has(currentConfigFilePath)) {
          throw new Error(`The API Extractor "extends" setting contains a cycle.`
            + `  This file is included twice: "${currentConfigFilePath}"`);
        }
        visitedPaths.add(currentConfigFilePath);

        const currentConfigFolderPath: string = path.dirname(currentConfigFilePath);

        // Load the extractor config defined in extends property.
        const baseConfig: IConfigFile = JsonFile.load(currentConfigFilePath);

        let extendsField: string = baseConfig.extends || '';

        // Delete the "extends" field so it doesn't get merged
        delete baseConfig.extends;

        if (extendsField) {
          if (extendsField.match(/^\.\.?[\\/]/)) {
            // EXAMPLE:  "./subfolder/api-extractor-base.json"
            extendsField = path.resolve(currentConfigFolderPath, extendsField);
          } else {
            // EXAMPLE:  "my-package/api-extractor-base.json"
            //
            // Resolve "my-package" from the perspective of the current folder.
            try {
              extendsField = resolve.sync(
                extendsField,
                {
                  basedir: currentConfigFolderPath
                }
              );
            } catch (e) {
              throw new Error(`Error resolving NodeJS path "${extendsField}": ${e.message}`);
            }
          }
        }

        // This step has to be performed in advance, since the currentConfigFolderPath information will be lost
        // after lodash.merge() is performed.
        ExtractorConfig._resolveConfigFileRelativePaths(baseConfig, currentConfigFolderPath);

        // Merge extractorConfig into baseConfig, mutating baseConfig
        lodash.merge(baseConfig, configObject);
        configObject = baseConfig;

        currentConfigFilePath = extendsField;
      } while (currentConfigFilePath);

    } catch (e) {
      throw new Error(`Error loading ${currentConfigFilePath}:\n` + e.message);
    }

    // Lastly, apply the defaults
    configObject = lodash.merge(lodash.cloneDeep(ExtractorConfig._defaultConfig), configObject);

    ExtractorConfig.jsonSchema.validateObject(configObject, jsonFilePath);

    // The schema validation should ensure that this object conforms to IConfigFile
    return configObject as IConfigFile;
  }

  private static _resolveConfigFileRelativePaths(configFile: IConfigFile, currentConfigFolderPath: string): void {

    if (configFile.projectFolder) {
      configFile.projectFolder = ExtractorConfig._resolveConfigFileRelativePath(
        'projectFolder', configFile.projectFolder, currentConfigFolderPath);
    }

    if (configFile.mainEntryPointFilePath) {
      configFile.mainEntryPointFilePath = ExtractorConfig._resolveConfigFileRelativePath(
        'mainEntryPointFilePath', configFile.mainEntryPointFilePath, currentConfigFolderPath);
    }

    if (configFile.compiler) {
      if (configFile.compiler.tsconfigFilePath) {
        configFile.compiler.tsconfigFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'tsconfigFilePath', configFile.compiler.tsconfigFilePath, currentConfigFolderPath);
      }
    }

    if (configFile.apiReport) {
      if (configFile.apiReport.reportFolder) {
        configFile.apiReport.reportFolder = ExtractorConfig._resolveConfigFileRelativePath(
          'reportFolder', configFile.apiReport.reportFolder, currentConfigFolderPath);
      }
      if (configFile.apiReport.reportTempFolder) {
        configFile.apiReport.reportTempFolder = ExtractorConfig._resolveConfigFileRelativePath(
          'reportTempFolder', configFile.apiReport.reportTempFolder, currentConfigFolderPath);
      }
    }

    if (configFile.docModel) {
      if (configFile.docModel.apiJsonFilePath) {
        configFile.docModel.apiJsonFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'apiJsonFilePath', configFile.docModel.apiJsonFilePath, currentConfigFolderPath);
      }
    }

    if (configFile.dtsRollup) {
      if (configFile.dtsRollup.untrimmedFilePath) {
        configFile.dtsRollup.untrimmedFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'untrimmedFilePath', configFile.dtsRollup.untrimmedFilePath, currentConfigFolderPath);
      }
      if (configFile.dtsRollup.betaTrimmedFilePath) {
        configFile.dtsRollup.betaTrimmedFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'betaTrimmedFilePath', configFile.dtsRollup.betaTrimmedFilePath, currentConfigFolderPath);
      }
      if (configFile.dtsRollup.publicTrimmedFilePath) {
        configFile.dtsRollup.publicTrimmedFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'publicTrimmedFilePath', configFile.dtsRollup.publicTrimmedFilePath, currentConfigFolderPath);
      }
    }

    if (configFile.tsdocMetadata) {
      if (configFile.tsdocMetadata.tsdocMetadataFilePath) {
        configFile.tsdocMetadata.tsdocMetadataFilePath = ExtractorConfig._resolveConfigFileRelativePath(
          'tsdocMetadataFilePath', configFile.tsdocMetadata.tsdocMetadataFilePath, currentConfigFolderPath);
      }
    }
  }

  private static _resolveConfigFileRelativePath(fieldName: string, fieldValue: string,
    currentConfigFolderPath: string): string {

    if (!path.isAbsolute(fieldValue)) {
      if (fieldValue.indexOf('<projectFolder>') !== 0) {
        // If the path is not absolute and does not start with "<projectFolder>", then resolve it relative
        // to the folder of the config file that it appears in
        return path.join(currentConfigFolderPath, fieldValue);
      }
    }

    return fieldValue;
  }

  /**
   * Prepares an `ExtractorConfig` object using a configuration that is provided as a runtime object,
   * rather than reading it from disk.  This allows configurations to be constructed programmatically,
   * loaded from an alternate source, and/or customized after loading.
   */
  public static prepare(options: IExtractorConfigPrepareOptions): ExtractorConfig {
    const filenameForErrors: string = options.configObjectFullPath || 'the configuration object';
    const configObject: Partial<IConfigFile> = options.configObject;

    if (configObject.extends) {
      throw new Error('The IConfigFile.extends field must be expanded before calling ExtractorConfig.prepare()');
    }

    if (options.configObjectFullPath) {
      if (!path.isAbsolute(options.configObjectFullPath)) {
        throw new Error('The "configObjectFullPath" setting must be an absolute path');
      }
    }

    ExtractorConfig.jsonSchema.validateObject(configObject, filenameForErrors);

    const packageJsonFullPath: string | undefined = options.packageJsonFullPath;
    let packageFolder: string | undefined = undefined;
    let packageJson: INodePackageJson | undefined = undefined;

    if (packageJsonFullPath) {
      if (!/.json$/i.test(packageJsonFullPath)) {
        // Catch common mistakes e.g. where someone passes a folder path instead of a file path
        throw new Error('The "packageJsonFullPath" setting does not have a .json file extension');
      }
      if (!path.isAbsolute(packageJsonFullPath)) {
        throw new Error('The "packageJsonFullPath" setting must be an absolute path');
      }

      if (options.packageJson) {
        packageJson = options.packageJson;
      } else {
        const packageJsonLookup: PackageJsonLookup = new PackageJsonLookup();
        packageJson = packageJsonLookup.loadNodePackageJson(packageJsonFullPath);
      }

      packageFolder = path.dirname(packageJsonFullPath);
    }

    try {

      if (!configObject.compiler) {
        // A merged configuration should have this
        throw new Error('The "compiler" section is missing');
      }

      if (!configObject.projectFolder) {
        // A merged configuration should have this
        throw new Error('The "projectFolder" setting is missing');
      }

      let projectFolder: string;
      if (configObject.projectFolder.trim() === '<lookup>') {
        if (!options.configObjectFullPath) {
          throw new Error('The "projectFolder" setting uses the "<lookup>" token, but it cannot be expanded because'
            + ' the "configObjectFullPath" setting was not specified');
        }

        // "The default value for `projectFolder` is the token `<lookup>`, which means the folder is determined
        // by traversing parent folders, starting from the folder containing api-extractor.json, and stopping
        // at the first folder that contains a tsconfig.json file.  If a tsconfig.json file cannot be found in
        // this way, then an error will be reported."

        let currentFolder: string = path.dirname(options.configObjectFullPath);
        for (; ; ) {
          const tsconfigPath: string = path.join(currentFolder, 'tsconfig.json');
          if (FileSystem.exists(tsconfigPath)) {
            projectFolder = currentFolder;
            break;
          }
          const parentFolder: string = path.dirname(currentFolder);
          if (parentFolder === '' || parentFolder === currentFolder) {
            throw new Error('The "projectFolder" setting uses the "<lookup>" token, but a tsconfig.json file cannot be'
              + ' found in this folder or any parent folder.');
          }
          currentFolder = parentFolder;
        }
      } else {
        ExtractorConfig._rejectAnyTokensInPath(configObject.projectFolder, 'projectFolder');

        if (!FileSystem.exists(configObject.projectFolder)) {
          throw new Error('The specified "projectFolder" path does not exist: ' + configObject.projectFolder);
        }

        projectFolder = configObject.projectFolder;
      }

      const tokenContext: IExtractorConfigTokenContext = {
        unscopedPackageName: 'unknown-package',
        packageName: 'unknown-package',
        projectFolder: projectFolder
      };

      if (packageJson) {
        tokenContext.packageName = packageJson.name;
        tokenContext.unscopedPackageName = PackageName.getUnscopedName(packageJson.name);
      }

      if (!configObject.mainEntryPointFilePath) {
        // A merged configuration should have this
        throw new Error('The "mainEntryPointFilePath" setting is missing');
      }
      const mainEntryPointFilePath: string = ExtractorConfig._resolvePathWithTokens('mainEntryPointFilePath',
        configObject.mainEntryPointFilePath, tokenContext);

      if (!ExtractorConfig.hasDtsFileExtension(mainEntryPointFilePath)) {
        throw new Error('The "mainEntryPointFilePath" value is not a declaration file: ' + mainEntryPointFilePath);
      }

      if (!FileSystem.exists(mainEntryPointFilePath)) {
        throw new Error('The "mainEntryPointFilePath" path does not exist: ' + mainEntryPointFilePath);
      }

      const bundledPackages: string[] = configObject.bundledPackages || [];
      for (const bundledPackage of bundledPackages) {
        if (!PackageName.isValidName(bundledPackage)) {
          throw new Error(`The "bundledPackages" list contains an invalid package name: "${bundledPackage}"`);
        }
      }

      const tsconfigFilePath: string = ExtractorConfig._resolvePathWithTokens('tsconfigFilePath',
        configObject.compiler.tsconfigFilePath, tokenContext);

      if (configObject.compiler.overrideTsconfig === undefined) {
        if (!tsconfigFilePath) {
          throw new Error('Either the "tsconfigFilePath" or "overrideTsconfig" setting must be specified');
        }
        if (!FileSystem.exists(tsconfigFilePath)) {
          throw new Error('The file referenced by "tsconfigFilePath" does not exist: ' + tsconfigFilePath);
        }
      }

      let apiReportEnabled: boolean = false;
      let reportFilePath: string = '';
      let reportTempFilePath: string = '';
      if (configObject.apiReport) {
        apiReportEnabled = !!configObject.apiReport.enabled;

        const reportFilename: string = ExtractorConfig._expandStringWithTokens('reportFileName',
          configObject.apiReport.reportFileName || '', tokenContext);

        if (!reportFilename) {
          // A merged configuration should have this
          throw new Error('The "reportFilename" setting is missing');
        }
        if (reportFilename.indexOf('/') >= 0 || reportFilename.indexOf('\\') >= 0) {
          // A merged configuration should have this
          throw new Error(`The "reportFilename" setting contains invalid characters: "${reportFilename}"`);
        }

        const reportFolder: string = ExtractorConfig._resolvePathWithTokens('reportFolder',
          configObject.apiReport.reportFolder, tokenContext);
        const reportTempFolder: string = ExtractorConfig._resolvePathWithTokens('reportTempFolder',
          configObject.apiReport.reportTempFolder, tokenContext);

        reportFilePath = path.join(reportFolder, reportFilename);
        reportTempFilePath = path.join(reportTempFolder, reportFilename);
      }

      let docModelEnabled: boolean = false;
      let apiJsonFilePath: string = '';
      if (configObject.docModel) {
        docModelEnabled = !!configObject.docModel.enabled;
        apiJsonFilePath = ExtractorConfig._resolvePathWithTokens('apiJsonFilePath',
          configObject.docModel.apiJsonFilePath, tokenContext);
      }

      let tsdocMetadataEnabled: boolean = false;
      let tsdocMetadataFilePath: string = '';
      if (configObject.tsdocMetadata) {
        tsdocMetadataEnabled = !!configObject.tsdocMetadata.enabled;

        if (tsdocMetadataEnabled) {
          tsdocMetadataFilePath = configObject.tsdocMetadata.tsdocMetadataFilePath || '';

          if (tsdocMetadataFilePath.trim() === '<lookup>') {
            if (!packageJson) {
              throw new Error('The "<lookup>" token cannot be used with the "tsdocMetadataFilePath" setting because'
                + ' the "packageJson" option was not provided');
            }
            if (!packageJsonFullPath) {
              throw new Error('The "<lookup>" token cannot be used with "tsdocMetadataFilePath" because'
                + 'the "packageJsonFullPath" option was not provided');
            }
            tsdocMetadataFilePath = PackageMetadataManager.resolveTsdocMetadataPath(
              path.dirname(packageJsonFullPath),
              packageJson
            );
          } else {
            tsdocMetadataFilePath = ExtractorConfig._resolvePathWithTokens('tsdocMetadataFilePath',
              configObject.tsdocMetadata.tsdocMetadataFilePath, tokenContext);
          }

          if (!tsdocMetadataFilePath) {
            throw new Error('The "tsdocMetadata.enabled" setting is enabled,'
              + ' but "tsdocMetadataFilePath" is not specified');
          }
        }
      }

      let rollupEnabled: boolean = false;
      let untrimmedFilePath: string = '';
      let betaTrimmedFilePath: string = '';
      let publicTrimmedFilePath: string = '';
      let omitTrimmingComments: boolean = false;

      if (configObject.dtsRollup) {
        rollupEnabled = !!configObject.dtsRollup.enabled;
        untrimmedFilePath = ExtractorConfig._resolvePathWithTokens('untrimmedFilePath',
          configObject.dtsRollup.untrimmedFilePath, tokenContext);
        betaTrimmedFilePath = ExtractorConfig._resolvePathWithTokens('betaTrimmedFilePath',
          configObject.dtsRollup.betaTrimmedFilePath, tokenContext);
        publicTrimmedFilePath = ExtractorConfig._resolvePathWithTokens('publicTrimmedFilePath',
          configObject.dtsRollup.publicTrimmedFilePath, tokenContext);
        omitTrimmingComments = !!configObject.dtsRollup.omitTrimmingComments;
      }

      let tsdocConfig: tsdoc.TSDocConfiguration = AedocDefinitions.tsdocConfiguration;
      if (configObject.tsdoc && configObject.tsdoc.tagDefinitions) {
        const customTags: tsdoc.TSDocTagDefinition[] = configObject.tsdoc.tagDefinitions.map(
          (tag: IConfigTsdocTagDefinition): tsdoc.TSDocTagDefinition => {
            const tagParams: tsdoc.ITSDocTagDefinitionParameters = {
              tagName: tag.tagName,
              syntaxKind: tsdoc.TSDocTagSyntaxKind.BlockTag,
              allowMultiple: tag.allowMultiple
            };
            if (tag.syntaxKind === 'inline') {
              tagParams.syntaxKind = tsdoc.TSDocTagSyntaxKind.InlineTag;
            } else if (tag.syntaxKind === 'modifier') {
              tagParams.syntaxKind = tsdoc.TSDocTagSyntaxKind.ModifierTag;
            }
            return new tsdoc.TSDocTagDefinition(tagParams);
          });
        tsdocConfig = AedocDefinitions.getTsdocConfiguration(customTags);
      }

      return new ExtractorConfig({
        projectFolder: projectFolder,
        packageJson,
        packageFolder,
        mainEntryPointFilePath,
        bundledPackages,
        tsconfigFilePath,
        overrideTsconfig: configObject.compiler.overrideTsconfig,
        skipLibCheck: !!configObject.compiler.skipLibCheck,
        apiReportEnabled,
        reportFilePath,
        reportTempFilePath,
        docModelEnabled,
        apiJsonFilePath,
        rollupEnabled,
        untrimmedFilePath,
        betaTrimmedFilePath,
        publicTrimmedFilePath,
        omitTrimmingComments,
        tsdocMetadataEnabled,
        tsdocMetadataFilePath,
        tsdocConfig,
        messages: configObject.messages || { },
        testMode: !!configObject.testMode
      });

    } catch (e) {
      throw new Error(`Error parsing ${filenameForErrors}:\n` + e.message);
    }
  }

  private static _resolvePathWithTokens(fieldName: string, value: string | undefined,
    tokenContext: IExtractorConfigTokenContext): string {

    value = ExtractorConfig._expandStringWithTokens(fieldName, value, tokenContext);
    if (value !== '') {
      value = path.resolve(tokenContext.projectFolder, value);
    }
    return value;
  }

  private static _expandStringWithTokens(fieldName: string, value: string | undefined,
    tokenContext: IExtractorConfigTokenContext): string {
    value = value ? value.trim() : '';
    if (value !== '') {
      value = Text.replaceAll(value, '<unscopedPackageName>', tokenContext.unscopedPackageName);
      value = Text.replaceAll(value, '<packageName>', tokenContext.packageName);

      const projectFolderToken: string = '<projectFolder>';
      if (value.indexOf(projectFolderToken) === 0) {
        // Replace "<projectFolder>" at the start of a string
        value = path.join(tokenContext.projectFolder, value.substr(projectFolderToken.length));
      }

      if (value.indexOf(projectFolderToken) >= 0) {
        // If after all replacements, "<projectFolder>" appears somewhere in the string, report an error
        throw new Error(`The "${fieldName}" value incorrectly uses the "<projectFolder>" token.`
          + ` It must appear at the start of the string.`);
      }

      if (value.indexOf('<lookup>') >= 0) {
        throw new Error(`The "${fieldName}" value incorrectly uses the "<lookup>" token`);
      }
      ExtractorConfig._rejectAnyTokensInPath(value, fieldName);
    }
    return value;
  }

  /**
   * Returns true if the specified file path has the ".d.ts" file extension.
   */
  public static hasDtsFileExtension(filePath: string): boolean {
    return ExtractorConfig._declarationFileExtensionRegExp.test(filePath);
  }

  /**
   * Given a path string that may have originally contained expandable tokens such as `<projectFolder>"`
   * this reports an error if any token-looking substrings remain after expansion (e.g. `c:\blah\<invalid>\blah`).
   */
  private static _rejectAnyTokensInPath(value: string, fieldName: string): void {
    if (value.indexOf('<') < 0 && value.indexOf('>') < 0) {
      return;
    }

    // Can we determine the name of a token?
    const tokenRegExp: RegExp = /(\<[^<]*?\>)/;
    const match: RegExpExecArray | null = tokenRegExp.exec(value);
    if (match) {
      throw new Error(`The "${fieldName}" value contains an unrecognized token "${match[1]}"`);
    }
    throw new Error(`The "${fieldName}" value contains extra token characters ("<" or ">"): ${value}`);
  }
}
