// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * @beta
 */
export enum TerminalProviderSeverity {
  log,
  warning,
  error,
  verbose
}

/**
 * Implement the interface to create a terminal provider. Terminal providers
 * can be registered to a {@link Terminal} instance to receive messages.
 *
 * @beta
 */
export interface ITerminalProvider {
  /**
   * This property should return true only if the terminal provider supports
   * rendering console colors.
   */
  supportsColor: boolean;

  /**
   * This property should return the newline character the terminal provider
   * expects.
   */
  eolCharacter: string;

  /**
   * This function gets called on every terminal provider upon every
   * message function call on the terminal instance.
   *
   * @param data - The terminal message.
   * @param severity - The message severity. Terminal providers can
   * route different kinds of messages to different streams and may choose
   * to ignore verbose messages.
   */
  write(data: string, severity: TerminalProviderSeverity): void;
}
