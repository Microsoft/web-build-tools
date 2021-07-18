// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * An IThemingInstruction can specify a rawString to be preserved or a theme slot and a default value
 * to use if that slot is not specified by the theme.
 */

/* eslint-disable @typescript-eslint/no-use-before-define */

// Declaring a global here in case that the execution environment is Node.js (without importing the
// entire node.js d.ts for now)
declare let global: any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface IThemingInstruction {
  theme?: string;
  defaultValue?: string;
  rawString?: string;
}

export type ThemableArray = IThemingInstruction[];

export interface ITheme {
  [key: string]: string;
}

interface IStyleSheet {
  cssText: string;
}

interface IExtendedHtmlStyleElement extends HTMLStyleElement {
  styleSheet: IStyleSheet;
}

/**
 * Performance Measurement of loading styles
 */
interface IMeasurement {
  /**
   * Count of style element injected, which is the slow operation in IE
   */
  count: number;
  /**
   * Total duration of all loadStyles exections
   */
  duration: number;
}

interface IRunState {
  mode: Mode;
  buffer: ThemableArray[];
  flushTimer: number;
}

interface IThemeState {
  theme: ITheme | undefined;
  lastStyleElement: IExtendedHtmlStyleElement;
  registeredStyles: IStyleRecord[]; // records of already registered non-themable styles
  registeredThemableStyles: IStyleRecord[]; // records of already registered themable styles
  loadStyles: ((processedStyles: string, rawStyles?: string | ThemableArray) => void) | undefined;
  perf: IMeasurement;
  runState: IRunState;
}

interface IStyleRecord {
  styleElement: Element;
  themableStyle: ThemableArray;
}

interface ICustomEvent<T> extends Event {
  args?: T;
}

/**
 * object returned from resolveThemableArray function
 */
interface IThemableArrayResolveResult {
  /** this string is the processed styles in string */
  styleString: string;

  /** this boolean indicates if this style array is themable */
  themable: boolean;
}

/**
 * In sync mode, styles are registered as style elements synchronously with loadStyles() call.
 * In async mode, styles are buffered and registered as batch in async timer for performance purpose.
 */
export const enum Mode {
  sync,
  async
}

/**
 * Themable styles and non-themable styles are tracked separately
 * Specify ClearStyleOptions when calling clearStyles API to specify which group of registered styles should be cleared.
 */
export const enum ClearStyleOptions {
  /** only themable styles will be cleared */
  onlyThemable = 1,
  /** only non-themable styles will be cleared */
  onlyNonThemable = 2,
  /** both themable and non-themable styles will be cleared */
  all = 3
}

// Store the theming state in __themeState__ global scope for reuse in the case of duplicate
// load-themed-styles hosted on the page.
const _root: any = typeof window === 'undefined' ? global : window; // eslint-disable-line @typescript-eslint/no-explicit-any

// Nonce string to inject into script tag if one provided. This is used in CSP (Content Security Policy).
const _styleNonce: string = _root && _root.CSPSettings && _root.CSPSettings.nonce;

const _themeState: IThemeState = initializeThemeState();

/**
 * Matches theming tokens. For example, "[theme: themeSlotName, default: #FFF]" (including the quotes).
 */
const _themeTokenRegex: RegExp =
  /[\'\"]\[theme:\s*(\w+)\s*(?:\,\s*default:\s*([\\"\']?[\.\,\(\)\#\-\s\w]*[\.\,\(\)\#\-\w][\"\']?))?\s*\][\'\"]/g;

const now: () => number = () =>
  typeof performance !== 'undefined' && !!performance.now ? performance.now() : Date.now();

function measure(func: () => void): void {
  const start: number = now();
  func();
  const end: number = now();
  _themeState.perf.duration += end - start;
}

/**
 * initialize global state object
 */
function initializeThemeState(): IThemeState {
  let state: IThemeState = _root.__themeState__ || {
    theme: undefined,
    lastStyleElement: undefined,
    registeredStyles: []
  };

  if (!state.runState) {
    state = {
      ...state,
      perf: {
        count: 0,
        duration: 0
      },
      runState: {
        flushTimer: 0,
        mode: Mode.sync,
        buffer: []
      }
    };
  }
  if (!state.registeredThemableStyles) {
    state = {
      ...state,
      registeredThemableStyles: []
    };
  }
  _root.__themeState__ = state;
  return state;
}

/**
 * Loads a set of style text. If it is registered too early, we will register it when the window.load
 * event is fired.
 * @param {string | ThemableArray} styles Themable style text to register.
 * @param {boolean} loadAsync When true, always load styles in async mode, irrespective of current sync mode.
 */
export function loadStyles(styles: string | ThemableArray, loadAsync: boolean = false): void {
  measure(() => {
    const styleParts: ThemableArray = Array.isArray(styles) ? styles : splitStyles(styles);
    const { mode, buffer, flushTimer } = _themeState.runState;
    if (loadAsync || mode === Mode.async) {
      buffer.push(styleParts);
      if (!flushTimer) {
        _themeState.runState.flushTimer = asyncLoadStyles();
      }
    } else {
      applyThemableStyles(styleParts);
    }
  });
}

/**
 * Allows for customizable loadStyles logic. e.g. for server side rendering application
 * @param {(processedStyles: string, rawStyles?: string | ThemableArray) => void}
 * a loadStyles callback that gets called when styles are loaded or reloaded
 */
export function configureLoadStyles(
  loadStylesFn: ((processedStyles: string, rawStyles?: string | ThemableArray) => void) | undefined
): void {
  _themeState.loadStyles = loadStylesFn;
}

/**
 * Configure run mode of load-themable-styles
 * @param mode load-themable-styles run mode, async or sync
 */
export function configureRunMode(mode: Mode): void {
  _themeState.runState.mode = mode;
}

/**
 * external code can call flush to synchronously force processing of currently buffered styles
 */
export function flush(): void {
  measure(() => {
    const styleArrays: ThemableArray[] = _themeState.runState.buffer.slice();
    _themeState.runState.buffer = [];
    const mergedStyleArray: ThemableArray = ([] as ThemableArray).concat.apply([], styleArrays);
    if (mergedStyleArray.length > 0) {
      applyThemableStyles(mergedStyleArray);
    }
  });
}

/**
 * register async loadStyles
 */
function asyncLoadStyles(): number {
  return setTimeout(() => {
    _themeState.runState.flushTimer = 0;
    flush();
  }, 0);
}

/**
 * Loads a set of style text. If it is registered too early, we will register it when the window.load event
 * is fired.
 * @param {string} styleText Style to register.
 * @param {IStyleRecord} styleRecord Existing style record to re-apply.
 */
function applyThemableStyles(stylesArray: ThemableArray, styleRecord?: IStyleRecord): void {
  if (_themeState.loadStyles) {
    _themeState.loadStyles(resolveThemableArray(stylesArray).styleString, stylesArray);
  } else {
    registerStyles(stylesArray);
  }
}

/**
 * Registers a set theme tokens to find and replace. If styles were already registered, they will be
 * replaced.
 * @param {theme} theme JSON object of theme tokens to values.
 */
export function loadTheme(theme: ITheme | undefined): void {
  _themeState.theme = theme;

  // reload styles.
  reloadStyles();
}

/**
 * Clear already registered style elements and style records in theme_State object
 * @param option - specify which group of registered styles should be cleared.
 * Default to be both themable and non-themable styles will be cleared
 */
export function clearStyles(option: ClearStyleOptions = ClearStyleOptions.all): void {
  if (option === ClearStyleOptions.all || option === ClearStyleOptions.onlyNonThemable) {
    clearStylesInternal(_themeState.registeredStyles);
    _themeState.registeredStyles = [];
  }
  if (option === ClearStyleOptions.all || option === ClearStyleOptions.onlyThemable) {
    clearStylesInternal(_themeState.registeredThemableStyles);
    _themeState.registeredThemableStyles = [];
  }
}

function clearStylesInternal(records: IStyleRecord[]): void {
  records.forEach((styleRecord: IStyleRecord) => {
    const styleElement: HTMLStyleElement = styleRecord && (styleRecord.styleElement as HTMLStyleElement);
    if (styleElement && styleElement.parentElement) {
      styleElement.parentElement.removeChild(styleElement);
    }
  });
}

/**
 * Reloads styles.
 */
function reloadStyles(): void {
  if (_themeState.theme) {
    const themableStyles: ThemableArray[] = [];
    for (const styleRecord of _themeState.registeredThemableStyles) {
      themableStyles.push(styleRecord.themableStyle);
    }
    if (themableStyles.length > 0) {
      clearStyles(ClearStyleOptions.onlyThemable);
      applyThemableStyles(([] as ThemableArray).concat.apply([], themableStyles));
    }
  }
}

/**
 * Find theme tokens and replaces them with provided theme values.
 * @param {string} styles Tokenized styles to fix.
 */
export function detokenize(styles: string | undefined): string | undefined {
  if (styles) {
    styles = resolveThemableArray(splitStyles(styles)).styleString;
  }

  return styles;
}

/**
 * Resolves ThemingInstruction objects in an array and joins the result into a string.
 * @param {ThemableArray} splitStyleArray ThemableArray to resolve and join.
 */
function resolveThemableArray(splitStyleArray: ThemableArray = []): IThemableArrayResolveResult {
  const shouldWarn: boolean = console && typeof DEBUG !== 'undefined' && DEBUG;
  const { theme }: IThemeState = _themeState;
  let themable: boolean = false;
  let styleString: string = '';

  // Resolve the array of theming instructions to an array of strings.
  // Then join the array to produce the final CSS string.
  for (let i: number = 0; i < splitStyleArray.length; i++) {
    const currentValue: IThemingInstruction = splitStyleArray[i];
    const themeSlot: string | undefined = currentValue.theme;

    if (themeSlot) {
      themable = true;
      // A theming annotation. Resolve it.
      const themedValue: string | undefined = theme ? theme[themeSlot] : undefined;
      const defaultValue: string = currentValue.defaultValue || 'inherit';

      // Warn to console if we hit an unthemed value even when themes are provided, but only if "DEBUG" is true.
      // Allow the themedValue to be undefined to explicitly request the default value.
      if (shouldWarn && theme && !themedValue && !(themeSlot in theme)) {
        console.warn(`Theming value not provided for "${themeSlot}". Falling back to "${defaultValue}".`);
      }

      styleString += themedValue || defaultValue;
    } else {
      // A non-themable string. Preserve it.
      styleString += currentValue.rawString;
    }
  }

  return {
    styleString,
    themable
  };
}

/**
 * Split tokenized CSS into an array of strings and theme specification objects
 * @param {string} styles Tokenized styles to split.
 */
export function splitStyles(styles: string): ThemableArray {
  const result: ThemableArray = [];
  if (styles) {
    let pos: number = 0; // Current position in styles.
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = _themeTokenRegex.exec(styles))) {
      const matchIndex: number = tokenMatch.index;
      if (matchIndex > pos) {
        result.push({
          rawString: styles.substring(pos, matchIndex)
        });
      }

      result.push({
        theme: tokenMatch[1],
        defaultValue: tokenMatch[2] // May be undefined
      });

      // index of the first character after the current match
      pos = _themeTokenRegex.lastIndex;
    }

    // Push the rest of the string after the last match.
    result.push({
      rawString: styles.substring(pos)
    });
  }

  return result;
}

/**
 * Registers a set of style text. If it is registered too early, we will register it when the
 * window.load event is fired.
 * @param {ThemableArray} styleArray Array of IThemingInstruction objects to register.
 * @param {IStyleRecord} styleRecord May specify a style Element to update.
 */
function registerStyles(styleArray: ThemableArray): void {
  if (typeof document === 'undefined') {
    return;
  }
  const head: HTMLHeadElement = document.getElementsByTagName('head')[0];
  const styleElement: HTMLStyleElement = document.createElement('style');
  const { styleString, themable } = resolveThemableArray(styleArray);

  styleElement.setAttribute('data-load-themed-styles', 'true');
  if (_styleNonce) {
    styleElement.setAttribute('nonce', _styleNonce);
  }
  styleElement.appendChild(document.createTextNode(styleString));
  _themeState.perf.count++;
  head.appendChild(styleElement);

  const ev: ICustomEvent<{ newStyle: HTMLStyleElement }> = document.createEvent('HTMLEvents');
  ev.initEvent('styleinsert', true /* bubbleEvent */, false /* cancelable */);
  ev.args = {
    newStyle: styleElement
  };
  document.dispatchEvent(ev);

  const record: IStyleRecord = {
    styleElement: styleElement,
    themableStyle: styleArray
  };

  if (themable) {
    _themeState.registeredThemableStyles.push(record);
  } else {
    _themeState.registeredStyles.push(record);
  }
}
