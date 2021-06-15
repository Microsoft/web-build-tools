// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import type { Config } from '@jest/types';
import { ConfigurationFile } from '@rushstack/heft-config-file';
import { StringBufferTerminalProvider, Terminal } from '@rushstack/terminal';

import { IHeftJestConfiguration, JestPlugin } from '../JestPlugin';

describe('JestConfigLoader', () => {
  let terminalProvider: StringBufferTerminalProvider;
  let terminal: Terminal;

  beforeEach(() => {
    terminalProvider = new StringBufferTerminalProvider(false);
    terminal = new Terminal(terminalProvider);
  });

  it('resolves preset config modules', async () => {
    const rootDir: string = path.join(__dirname, 'project1');
    const loader: ConfigurationFile<IHeftJestConfiguration> = JestPlugin.getJestConfigurationLoader(rootDir);
    const loadedConfig: IHeftJestConfiguration = await loader.loadConfigurationFileForProjectAsync(
      terminal,
      path.join(__dirname, 'project1')
    );

    expect(loadedConfig.preset).toBe(undefined);
    expect(loadedConfig.globalSetup).toBe(path.join(rootDir, 'a', 'b', 'globalSetupFile1.js'));

    // Validate string[]
    expect(loadedConfig.setupFiles?.length).toBe(2);
    expect(loadedConfig.setupFiles![0]).toBe(path.join(rootDir, 'a', 'b', 'setupFile2.js'));
    expect(loadedConfig.setupFiles![1]).toBe(path.join(rootDir, 'a', 'b', 'setupFile1.js'));

    // Validate reporters
    expect(loadedConfig.reporters?.length).toBe(3);
    expect(loadedConfig.reporters![0]).toBe('default');
    expect(loadedConfig.reporters![1]).toBe(path.join(rootDir, 'a', 'c', 'mockReporter1.js'));
    expect((loadedConfig.reporters![2] as Config.ReporterConfig)[0]).toBe(
      path.join(rootDir, 'a', 'c', 'd', 'mockReporter2.js')
    );

    // Validate transformers
    expect(Object.keys(loadedConfig.transform || {}).length).toBe(2);
    expect(loadedConfig.transform!['\\.(xxx)$']).toBe(
      path.join(rootDir, 'a', 'b', 'mockTransformModule2.js')
    );
    expect((loadedConfig.transform!['\\.(yyy)$'] as Config.TransformerConfig)[0]).toBe(
      path.join(rootDir, 'a', 'c', 'mockTransformModule3.js')
    );

    // Validate globals
    expect(Object.keys(loadedConfig.globals || {}).length).toBe(4);
    expect(loadedConfig.globals!.key1).toBe('value5');
    expect((loadedConfig.globals!.key2 as string[]).length).toBe(4);
    expect((loadedConfig.globals!.key2 as string[])[0]).toBe('value2');
    expect((loadedConfig.globals!.key2 as string[])[1]).toContain('value3');
    expect((loadedConfig.globals!.key2 as string[])[2]).toContain('value2');
    expect((loadedConfig.globals!.key2 as string[])[3]).toContain('value6');
    const key3Obj: any = (loadedConfig.globals as any).key3; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Object.keys(key3Obj).length).toBe(3);
    expect(key3Obj.key4).toBe('value7');
    expect(key3Obj.key5).toBe('value5');
    expect(key3Obj.key6).toBe('value8');
    expect(loadedConfig.globals!.key7).toBe('value9');
  });

  it('resolves preset package modules', async () => {
    const rootDir: string = path.join(__dirname, 'project1');
    const loader: ConfigurationFile<IHeftJestConfiguration> = JestPlugin.getJestConfigurationLoader(rootDir);
    const loadedConfig: IHeftJestConfiguration = await loader.loadConfigurationFileForProjectAsync(
      terminal,
      path.join(__dirname, 'project2')
    );

    expect(loadedConfig.setupFiles?.length).toBe(1);
    expect(loadedConfig.setupFiles![0]).toBe(require.resolve('@jest/core'));
  });
});
