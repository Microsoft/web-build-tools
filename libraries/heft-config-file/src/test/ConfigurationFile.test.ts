// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as nodeJsPath from 'path';

import { ConfigurationFile, PathResolutionMethod, InheritanceType } from '../ConfigurationFile';
import { FileSystem, JsonFile, Path } from '@rushstack/node-core-library';
import { RigConfig } from '@rushstack/rig-package';
import { StringBufferTerminalProvider, Terminal } from '@rushstack/terminal';

describe('ConfigurationFile', () => {
  const projectRoot: string = nodeJsPath.resolve(__dirname, '..', '..');
  let terminalProvider: StringBufferTerminalProvider;
  let terminal: Terminal;

  beforeEach(() => {
    const projectRoot: string = nodeJsPath.resolve(__dirname, '..', '..');
    const formatPathForLogging: (path: string) => string = (path: string) =>
      `<project root>/${Path.convertToSlashes(nodeJsPath.relative(projectRoot, path))}`;
    jest.spyOn(ConfigurationFile, '_formatPathForLogging').mockImplementation(formatPathForLogging);
    jest.spyOn(JsonFile, '_formatPathForError').mockImplementation(formatPathForLogging);

    terminalProvider = new StringBufferTerminalProvider(false);
    terminal = new Terminal(terminalProvider);
  });

  afterEach(() => {
    expect({
      log: terminalProvider.getOutput(),
      warning: terminalProvider.getWarningOutput(),
      error: terminalProvider.getErrorOutput(),
      verbose: terminalProvider.getVerbose()
    }).toMatchSnapshot();
  });

  describe('A simple config file', () => {
    const configFileFolderName: string = 'simplestConfigFile';
    const projectRelativeFilePath: string = `${configFileFolderName}/simplestConfigFile.json`;
    const schemaPath: string = nodeJsPath.resolve(
      __dirname,
      configFileFolderName,
      'simplestConfigFile.schema.json'
    );

    interface ISimplestConfigFile {
      thing: string;
    }

    it('Correctly loads the config file', async () => {
      const configFileLoader: ConfigurationFile<ISimplestConfigFile> =
        new ConfigurationFile<ISimplestConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath
        });
      const loadedConfigFile: ISimplestConfigFile =
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
      const expectedConfigFile: ISimplestConfigFile = { thing: 'A' };

      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile)).toEqual(
        nodeJsPath.resolve(__dirname, projectRelativeFilePath)
      );
      expect(
        configFileLoader.getPropertyOriginalValue({ parentObject: loadedConfigFile, propertyName: 'thing' })
      ).toEqual('A');
    });

    it('Correctly resolves paths relative to the config file', async () => {
      const configFileLoader: ConfigurationFile<ISimplestConfigFile> =
        new ConfigurationFile<ISimplestConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.thing': {
              pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToConfigurationFile
            }
          }
        });
      const loadedConfigFile: ISimplestConfigFile =
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
      const expectedConfigFile: ISimplestConfigFile = {
        thing: nodeJsPath.resolve(__dirname, configFileFolderName, 'A')
      };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile)).toEqual(
        nodeJsPath.resolve(__dirname, projectRelativeFilePath)
      );
      expect(
        configFileLoader.getPropertyOriginalValue({ parentObject: loadedConfigFile, propertyName: 'thing' })
      ).toEqual('A');
    });

    it('Correctly resolves paths relative to the project root', async () => {
      const configFileLoader: ConfigurationFile<ISimplestConfigFile> =
        new ConfigurationFile<ISimplestConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.thing': {
              pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
            }
          }
        });
      const loadedConfigFile: ISimplestConfigFile =
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
      const expectedConfigFile: ISimplestConfigFile = {
        thing: nodeJsPath.resolve(projectRoot, 'A')
      };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile)).toEqual(
        nodeJsPath.resolve(__dirname, projectRelativeFilePath)
      );
      expect(
        configFileLoader.getPropertyOriginalValue({ parentObject: loadedConfigFile, propertyName: 'thing' })
      ).toEqual('A');
    });
  });

  describe('A simple config file containing an array', () => {
    const configFileFolderName: string = 'simpleConfigFile';
    const projectRelativeFilePath: string = `${configFileFolderName}/simpleConfigFile.json`;
    const schemaPath: string = nodeJsPath.resolve(
      __dirname,
      configFileFolderName,
      'simpleConfigFile.schema.json'
    );

    interface ISimpleConfigFile {
      things: string[];
    }

    it('Correctly loads the config file', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        { projectRelativeFilePath: projectRelativeFilePath, jsonSchemaPath: schemaPath }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = { things: ['A', 'B', 'C'] };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly resolves paths relative to the config file', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.things.*': {
              pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToConfigurationFile
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = {
        things: [
          nodeJsPath.resolve(__dirname, configFileFolderName, 'A'),
          nodeJsPath.resolve(__dirname, configFileFolderName, 'B'),
          nodeJsPath.resolve(__dirname, configFileFolderName, 'C')
        ]
      };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly resolves paths relative to the project root', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.things.*': {
              pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToProjectRoot
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = {
        things: [
          nodeJsPath.resolve(projectRoot, 'A'),
          nodeJsPath.resolve(projectRoot, 'B'),
          nodeJsPath.resolve(projectRoot, 'C')
        ]
      };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });
  });

  describe('A simple config file with "extends"', () => {
    const configFileFolderName: string = 'simpleConfigFileWithExtends';
    const projectRelativeFilePath: string = `${configFileFolderName}/simpleConfigFileWithExtends.json`;
    const schemaPath: string = nodeJsPath.resolve(
      __dirname,
      configFileFolderName,
      'simpleConfigFileWithExtends.schema.json'
    );

    interface ISimpleConfigFile {
      things: string[];
    }

    it('Correctly loads the config file with default config meta', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        { projectRelativeFilePath: projectRelativeFilePath, jsonSchemaPath: schemaPath }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = { things: ['A', 'B', 'C', 'D', 'E'] };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly loads the config file with "append" in config meta', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          propertyInheritance: {
            things: {
              inheritanceType: InheritanceType.append
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = { things: ['A', 'B', 'C', 'D', 'E'] };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly loads the config file with "replace" in config meta', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          propertyInheritance: {
            things: {
              inheritanceType: InheritanceType.replace
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = { things: ['D', 'E'] };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly loads the config file with "custom" in config meta', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          propertyInheritance: {
            things: {
              inheritanceType: InheritanceType.custom,
              inheritanceFunction: (current: string[], parent: string[]) => ['X', 'Y', 'Z']
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const expectedConfigFile: ISimpleConfigFile = { things: ['X', 'Y', 'Z'] };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });

    it('Correctly resolves paths relative to the config file', async () => {
      const configFileLoader: ConfigurationFile<ISimpleConfigFile> = new ConfigurationFile<ISimpleConfigFile>(
        {
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.things.*': {
              pathResolutionMethod: PathResolutionMethod.resolvePathRelativeToConfigurationFile
            }
          }
        }
      );
      const loadedConfigFile: ISimpleConfigFile = await configFileLoader.loadConfigurationFileForProjectAsync(
        terminal,
        __dirname
      );
      const parentConfigFileFolder: string = nodeJsPath.resolve(
        __dirname,
        configFileFolderName,
        '..',
        'simpleConfigFile'
      );

      const expectedConfigFile: ISimpleConfigFile = {
        things: [
          nodeJsPath.resolve(parentConfigFileFolder, 'A'),
          nodeJsPath.resolve(parentConfigFileFolder, 'B'),
          nodeJsPath.resolve(parentConfigFileFolder, 'C'),
          nodeJsPath.resolve(__dirname, configFileFolderName, 'D'),
          nodeJsPath.resolve(__dirname, configFileFolderName, 'E')
        ]
      };
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
    });
  });

  describe('A complex config file', () => {
    interface IComplexConfigFile {
      plugins: { plugin: string }[];
    }

    it('Correctly loads a complex config file', async () => {
      const projectRelativeFilePath: string = 'complexConfigFile/pluginsD.json';
      const rootConfigFilePath: string = nodeJsPath.resolve(__dirname, 'complexConfigFile', 'pluginsA.json');
      const secondConfigFilePath: string = nodeJsPath.resolve(
        __dirname,
        'complexConfigFile',
        'pluginsB.json'
      );
      const schemaPath: string = nodeJsPath.resolve(__dirname, 'complexConfigFile', 'plugins.schema.json');

      const configFileLoader: ConfigurationFile<IComplexConfigFile> =
        new ConfigurationFile<IComplexConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath,
          jsonPathMetadata: {
            '$.plugins.*.plugin': {
              pathResolutionMethod: PathResolutionMethod.NodeResolve
            }
          }
        });
      const loadedConfigFile: IComplexConfigFile =
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
      const expectedConfigFile: IComplexConfigFile = {
        plugins: [
          {
            plugin: await FileSystem.getRealPathAsync(
              nodeJsPath.resolve(
                projectRoot,
                'node_modules',
                '@rushstack',
                'node-core-library',
                'lib',
                'index.js'
              )
            )
          },
          {
            plugin: await FileSystem.getRealPathAsync(
              nodeJsPath.resolve(projectRoot, 'node_modules', '@rushstack', 'heft', 'lib', 'index.js')
            )
          },
          {
            plugin: await FileSystem.getRealPathAsync(
              nodeJsPath.resolve(projectRoot, 'node_modules', '@rushstack', 'eslint-config', 'index.js')
            )
          }
        ]
      };

      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));

      expect(
        configFileLoader.getPropertyOriginalValue({
          parentObject: loadedConfigFile.plugins[0],
          propertyName: 'plugin'
        })
      ).toEqual('@rushstack/node-core-library');
      expect(
        configFileLoader.getPropertyOriginalValue({
          parentObject: loadedConfigFile.plugins[1],
          propertyName: 'plugin'
        })
      ).toEqual('@rushstack/heft');
      expect(
        configFileLoader.getPropertyOriginalValue({
          parentObject: loadedConfigFile.plugins[2],
          propertyName: 'plugin'
        })
      ).toEqual('@rushstack/eslint-config');

      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile.plugins[0])).toEqual(
        rootConfigFilePath
      );
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile.plugins[1])).toEqual(
        nodeJsPath.resolve(__dirname, secondConfigFilePath)
      );
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile.plugins[2])).toEqual(
        nodeJsPath.resolve(__dirname, secondConfigFilePath)
      );
    });
  });

  describe('loading a rig', () => {
    const projectFolder: string = nodeJsPath.resolve(__dirname, 'project-referencing-rig');
    const rigConfig: RigConfig = RigConfig.loadForProjectFolder({ projectFolderPath: projectFolder });

    const schemaPath: string = nodeJsPath.resolve(
      __dirname,
      'simplestConfigFile',
      'simplestConfigFile.schema.json'
    );

    interface ISimplestConfigFile {
      thing: string;
    }

    it('correctly loads a config file inside a rig', async () => {
      const projectRelativeFilePath: string = 'config/simplestConfigFile.json';
      const configFileLoader: ConfigurationFile<ISimplestConfigFile> =
        new ConfigurationFile<ISimplestConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath
        });
      const loadedConfigFile: ISimplestConfigFile =
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, projectFolder, rigConfig);
      const expectedConfigFile: ISimplestConfigFile = { thing: 'A' };

      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile)).toEqual(
        nodeJsPath.resolve(
          projectFolder,
          'node_modules',
          'test-rig',
          'profiles',
          'default',
          projectRelativeFilePath
        )
      );
      expect(
        configFileLoader.getPropertyOriginalValue({ parentObject: loadedConfigFile, propertyName: 'thing' })
      ).toEqual('A');
    });

    it('correctly loads a config file inside a rig via tryLoadConfigurationFileForProjectAsync', async () => {
      const projectRelativeFilePath: string = 'config/simplestConfigFile.json';
      const configFileLoader: ConfigurationFile<ISimplestConfigFile> =
        new ConfigurationFile<ISimplestConfigFile>({
          projectRelativeFilePath: projectRelativeFilePath,
          jsonSchemaPath: schemaPath
        });
      const loadedConfigFile: ISimplestConfigFile | undefined =
        await configFileLoader.tryLoadConfigurationFileForProjectAsync(terminal, projectFolder, rigConfig);
      const expectedConfigFile: ISimplestConfigFile = { thing: 'A' };

      expect(loadedConfigFile).not.toBeUndefined();
      expect(JSON.stringify(loadedConfigFile)).toEqual(JSON.stringify(expectedConfigFile));
      expect(configFileLoader.getObjectSourceFilePath(loadedConfigFile!)).toEqual(
        nodeJsPath.resolve(
          projectFolder,
          'node_modules',
          'test-rig',
          'profiles',
          'default',
          projectRelativeFilePath
        )
      );
      expect(
        configFileLoader.getPropertyOriginalValue({ parentObject: loadedConfigFile!, propertyName: 'thing' })
      ).toEqual('A');
    });

    it("throws an error when a config file doesn't exist in a project referencing a rig, which also doesn't have the file", async () => {
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: 'config/notExist.json',
        jsonSchemaPath: schemaPath
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, projectFolder, rigConfig);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });
  });

  describe('error cases', () => {
    const errorCasesFolderName: string = 'errorCases';

    it("throws an error when the file doesn't exist", async () => {
      const errorCaseFolderName: string = 'invalidType';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/notExist.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it("returns undefined when the file doesn't exist for tryLoadConfigurationFileForProjectAsync", async () => {
      const errorCaseFolderName: string = 'invalidType';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/notExist.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      expect(
        await configFileLoader.tryLoadConfigurationFileForProjectAsync(terminal, __dirname)
      ).toBeUndefined();
    });

    it("Throws an error when the file isn't valid JSON", async () => {
      const errorCaseFolderName: string = 'invalidJson';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/config.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it("Throws an error for a file that doesn't match its schema", async () => {
      const errorCaseFolderName: string = 'invalidType';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/config.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it('Throws an error when there is a circular reference in "extends" properties', async () => {
      const errorCaseFolderName: string = 'circularReference';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/config1.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it('Throws an error when an "extends" property points to a file that cannot be resolved', async () => {
      const errorCaseFolderName: string = 'extendsNotExist';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/config.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });
      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it("Throws an error when a combined config file doesn't match the schema", async () => {
      const errorCaseFolderName: string = 'invalidCombinedFile';
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/${errorCaseFolderName}/config1.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          errorCaseFolderName,
          'config.schema.json'
        )
      });

      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });

    it("Throws an error when a requested file doesn't exist", async () => {
      const configFileLoader: ConfigurationFile<void> = new ConfigurationFile({
        projectRelativeFilePath: `${errorCasesFolderName}/folderThatDoesntExist/config.json`,
        jsonSchemaPath: nodeJsPath.resolve(
          __dirname,
          errorCasesFolderName,
          'invalidCombinedFile',
          'config.schema.json'
        )
      });

      try {
        await configFileLoader.loadConfigurationFileForProjectAsync(terminal, __dirname);
        fail();
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
    });
  });
});
