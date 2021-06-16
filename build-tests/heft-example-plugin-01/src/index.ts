import { SyncHook } from 'tapable';
import {
  IHeftPlugin,
  HeftSession,
  HeftConfiguration,
  IBuildStageContext,
  IPreCompileSubstage
} from '@rushstack/heft';

export const enum PluginNames {
  ExamplePlugin01 = 'example-plugin-01'
}

export interface IExamplePlugin01Accessor {
  exampleHook: SyncHook<[]>;
}

export class ExamplePlugin01 implements IHeftPlugin {
  private _accessor: IExamplePlugin01Accessor;

  public pluginName: string = PluginNames.ExamplePlugin01;

  public get accessor(): IExamplePlugin01Accessor {
    return this._accessor;
  }

  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    this._accessor = {
      exampleHook: new SyncHook()
    };

    heftSession.hooks.build.tap(PluginNames.ExamplePlugin01, (build: IBuildStageContext) => {
      build.hooks.preCompile.tap(PluginNames.ExamplePlugin01, (preCompile: IPreCompileSubstage) => {
        preCompile.hooks.run.tap(PluginNames.ExamplePlugin01, () => {
          this.accessor.exampleHook.call();
        });
      });
    });
  }
}

export default new ExamplePlugin01();
