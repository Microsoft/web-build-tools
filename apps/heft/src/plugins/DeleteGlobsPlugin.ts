// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import glob from 'glob';
import { FileSystem, LegacyAdapters } from '@rushstack/node-core-library';
import { Tap } from 'tapable';

import { IHeftPlugin } from '../pluginFramework/IHeftPlugin';
import { HeftSession } from '../pluginFramework/HeftSession';
import { HeftConfiguration } from '../configuration/HeftConfiguration';
import { ICleanStageContext } from '../stages/CleanStage';
import { ScopedLogger } from '../pluginFramework/logging/ScopedLogger';
import { IHeftEventActions, CoreConfigFiles, HeftEvent } from '../utilities/CoreConfigFiles';
import { Async } from '../utilities/Async';
import {
  IBuildStageContext,
  IBundleSubstage,
  ICompileSubstage,
  IPostBuildSubstage,
  IPreCompileSubstage
} from '../stages/BuildStage';
import { Constants } from '../utilities/Constants';

const globEscape: (unescaped: string) => string = require('glob-escape'); // No @types/glob-escape package exists

const PLUGIN_NAME: string = 'DeleteGlobsPlugin';
const HEFT_STAGE_TAP: Tap = {
  name: PLUGIN_NAME,
  stage: Number.MIN_SAFE_INTEGER
};

export class DeleteGlobsPlugin implements IHeftPlugin {
  public readonly pluginName: string = PLUGIN_NAME;

  public apply(heftSession: HeftSession, heftConfiguration: HeftConfiguration): void {
    const logger: ScopedLogger = heftSession.requestScopedLogger('delete-globs');
    heftSession.hooks.clean.tap(PLUGIN_NAME, (clean: ICleanStageContext) => {
      clean.hooks.run.tapPromise(HEFT_STAGE_TAP, async () => {
        await this._runDeleteForHeftEvent(
          HeftEvent.clean,
          logger,
          heftConfiguration,
          clean.properties.pathsToDelete
        );
      });
    });

    heftSession.hooks.build.tap(PLUGIN_NAME, (build: IBuildStageContext) => {
      build.hooks.preCompile.tap(PLUGIN_NAME, (preCompile: IPreCompileSubstage) => {
        preCompile.hooks.run.tapPromise(HEFT_STAGE_TAP, async () => {
          await this._runDeleteForHeftEvent(HeftEvent.preCompile, logger, heftConfiguration);
        });
      });

      build.hooks.compile.tap(PLUGIN_NAME, (compile: ICompileSubstage) => {
        compile.hooks.run.tapPromise(HEFT_STAGE_TAP, async () => {
          await this._runDeleteForHeftEvent(HeftEvent.compile, logger, heftConfiguration);
        });
      });

      build.hooks.bundle.tap(PLUGIN_NAME, (bundle: IBundleSubstage) => {
        bundle.hooks.run.tapPromise(HEFT_STAGE_TAP, async () => {
          await this._runDeleteForHeftEvent(HeftEvent.bundle, logger, heftConfiguration);
        });
      });

      build.hooks.postBuild.tap(PLUGIN_NAME, (postBuild: IPostBuildSubstage) => {
        postBuild.hooks.run.tapPromise(HEFT_STAGE_TAP, async () => {
          await this._runDeleteForHeftEvent(HeftEvent.postBuild, logger, heftConfiguration);
        });
      });
    });
  }

  private async _runDeleteForHeftEvent(
    heftEvent: HeftEvent,
    logger: ScopedLogger,
    heftConfiguration: HeftConfiguration,
    additionalPathsToDelete?: Set<string>
  ): Promise<void> {
    let deletedFiles: number = 0;
    let deletedFolders: number = 0;

    const eventActions: IHeftEventActions = await CoreConfigFiles.getConfigConfigFileEventActionsAsync(
      logger.terminal,
      heftConfiguration
    );

    const pathsToDelete: Set<string> = new Set<string>(additionalPathsToDelete);
    for (const deleteGlobsEventAction of eventActions.deleteGlobs.get(heftEvent) || []) {
      for (const globPattern of deleteGlobsEventAction.globsToDelete) {
        const resolvedPaths: string[] = await this._resolvePathAsync(
          globPattern,
          heftConfiguration.buildFolder
        );
        for (const resolvedPath of resolvedPaths) {
          pathsToDelete.add(resolvedPath);
        }
      }
    }

    await Async.forEachLimitAsync(
      Array.from(pathsToDelete),
      Constants.maxParallelism,
      async (pathToDelete) => {
        try {
          FileSystem.deleteFile(pathToDelete, { throwIfNotExists: true });
          logger.terminal.writeVerboseLine(`Deleted "${pathToDelete}"`);
          deletedFiles++;
        } catch (error) {
          if (FileSystem.exists(pathToDelete)) {
            FileSystem.deleteFolder(pathToDelete);
            logger.terminal.writeVerboseLine(`Deleted folder "${pathToDelete}"`);
            deletedFolders++;
          }
        }
      }
    );

    if (deletedFiles > 0 || deletedFolders > 0) {
      logger.terminal.writeLine(
        `Deleted ${deletedFiles} file${deletedFiles !== 1 ? 's' : ''} ` +
          `and ${deletedFolders} folder${deletedFolders !== 1 ? 's' : ''}`
      );
    }
  }

  private async _resolvePathAsync(globPattern: string, buildFolder: string): Promise<string[]> {
    if (globEscape(globPattern) !== globPattern) {
      const expandedGlob: string[] = await LegacyAdapters.convertCallbackToPromise(glob, globPattern, {
        cwd: buildFolder
      });

      const result: string[] = [];
      for (const pathFromGlob of expandedGlob) {
        result.push(path.resolve(buildFolder, pathFromGlob));
      }

      return result;
    } else {
      return [path.resolve(buildFolder, globPattern)];
    }
  }
}
