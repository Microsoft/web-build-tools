// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * This library implements a system for processing human readable text that
 * will be output by console applications.
 *
 * @remarks
 * See the {@link TerminalWritable} documentation for an overview of the major concepts.
 *
 * @packageDocumentation
 */

export { ICallbackWritableOptions, CallbackWritable } from './CallbackWritable';
export { IDiscardStdoutTransformOptions, DiscardStdoutTransform } from './DiscardStdoutTransform';
export { TerminalChunkKind, ITerminalChunk } from './ITerminalChunk';
export { MockWritable } from './MockWritable';
export {
  INormalizeNewlinesTextRewriterOptions,
  NormalizeNewlinesTextRewriter
} from './NormalizeNewlinesTextRewriter';
export { RemoveColorsTextRewriter } from './RemoveColorsTextRewriter';
export { ISplitterTransformOptions, SplitterTransform } from './SplitterTransform';
export { IStdioLineTransformOptions, StderrLineTransform } from './StdioLineTransform';
export { IStdioSummarizerOptions, StdioSummarizer } from './StdioSummarizer';
export { StdioWritable } from './StdioWritable';
export { ITerminalTransformOptions, TerminalTransform } from './TerminalTransform';
export { ITerminalWritableOptions, TerminalWritable } from './TerminalWritable';
export { TextRewriterState, TextRewriter } from './TextRewriter';
export { ITextRewriterTransformOptions, TextRewriterTransform } from './TextRewriterTransform';
export { AnsiEscape, IAnsiEscapeConvertForTestsOptions } from './AnsiEscape';
export { ITerminal, Terminal } from './Terminal/Terminal';
export { Colors, IColorableSequence, ColorValue, TextAttribute } from './Terminal/Colors';
export { ITerminalProvider, TerminalProviderSeverity } from './Terminal/ITerminalProvider';
export { ConsoleTerminalProvider, IConsoleTerminalProviderOptions } from './Terminal/ConsoleTerminalProvider';
export {
  StringBufferTerminalProvider,
  IStringBufferOutputOptions
} from './Terminal/StringBufferTerminalProvider';
