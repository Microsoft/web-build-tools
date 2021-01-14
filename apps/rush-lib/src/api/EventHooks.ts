// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { IEventHooksJson } from './RushConfiguration';
import { Enum } from '@rushstack/node-core-library';

/**
 * Events happen during Rush runs.
 * @beta
 */
export enum Event {
  /**
   * Pre Rush install event
   */
  preRushInstall = 1,
  /**
   * Post Rush install event
   */
  postRushInstall = 2,
  /**
   * Pre Rush build event
   */
  preRushBuild = 3,
  /**
   * Post Rush build event
   */
  postRushBuild = 4,
  /**
   * Pre Rush add event
   */
  preRushAdd = 5,
  /**
   * Post Rush add event
   */
  postRushAdd = 6
}

/**
 * This class represents Rush event hooks configured for this repo.
 * Hooks are customized script actions that Rush executes when specific events occur.
 * The actions are expressed as a command-line that is executed using the operating system shell.
 * @beta
 */
export class EventHooks {
  private _hooks: Map<Event, string[]>;

  /**
   * @internal
   */
  public constructor(eventHooksJson: IEventHooksJson) {
    this._hooks = new Map<Event, string[]>();
    for (const [name, eventHooks] of Object.entries(eventHooksJson)) {
      const eventName: Event | undefined = Enum.tryGetValueByKey(Event, name);
      if (eventName) {
        this._hooks.set(eventName, [...eventHooks] || []);
      }
    }
  }

  /**
   * Return all the scripts associated with the specified event.
   * @param event - Rush event
   */
  public get(event: Event): string[] {
    return this._hooks.get(event) || [];
  }
}
