// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Worker } from 'worker_threads';

/**
 * Symbol to read the ID off of a worker
 * @internal
 */
export const WORKER_ID_SYMBOL: unique symbol = Symbol('workerId');

/**
 * @internal
 */
export interface IWorkerPoolOptions {
  /**
   * Identifier for this pool, to assign to its workers for tracking
   */
  id: string;
  /**
   * Maximum number of concurrent workers this WorkerPool may spawn.
   */
  maxWorkers: number;
  /**
   * Optional callback invoked when a worker is destroyed.
   */
  onWorkerDestroyed?: () => void;
  /**
   * Optional callback invoked on a newly created worker.
   */
  prepareWorker?: (worker: Worker) => void;
  /**
   * Optional data to pass to workers when they are initialized.
   * Will be subjected to the Structured Clone algorithm.
   */
  workerData?: unknown;
  /**
   * Absolute path to the worker script.
   */
  workerScriptPath: string;
}

/**
 * Manages a pool of workers.
 * Workers will be shutdown by sending them the boolean value `false` in a postMessage.
 * @internal
 */
export class WorkerPool {
  public id: string;
  public maxWorkers: number;

  private readonly _alive: Worker[];
  private _error: Error | undefined;
  private _finishing: boolean;
  private readonly _idle: Worker[];
  private _nextId: number;
  private readonly _onComplete: [() => void, (error: Error) => void][];
  private readonly _onWorkerDestroyed: (() => void) | undefined;
  private readonly _pending: [(worker: Worker) => void, (error: Error) => void][];
  private readonly _prepare: ((worker: Worker) => void) | undefined;
  private readonly _workerData: unknown;
  private readonly _workerScript: string;

  public constructor(options: IWorkerPoolOptions) {
    const { id, maxWorkers, onWorkerDestroyed, prepareWorker, workerData, workerScriptPath } = options;

    this.id = id;
    this.maxWorkers = maxWorkers;
    this._alive = [];
    this._error = undefined;
    this._finishing = false;
    this._idle = [];
    this._nextId = 0;
    this._onComplete = [];
    this._onWorkerDestroyed = onWorkerDestroyed;
    this._pending = [];
    this._prepare = prepareWorker;
    this._workerData = workerData;
    this._workerScript = workerScriptPath;
  }

  /**
   * Gets the count of active workers.
   */
  public getActiveCount(): number {
    return this._alive.length - this._idle.length;
  }

  /**
   * Gets the count of idle workers.
   */
  public getIdleCount(): number {
    return this._idle.length;
  }

  /**
   * Gets the count of live workers.
   */
  public getLiveCount(): number {
    return this._alive.length;
  }

  /**
   * Tells the pool to shut down when all workers are done.
   * Returns a promise that will be fulfilled if all workers finish successfully, or reject with the first error.
   */
  public async finishAsync(): Promise<void> {
    this._finishing = true;

    if (this._error) {
      throw this._error;
    }

    if (!this._alive.length) {
      // The pool has no live workers, this is a no-op
      return;
    }

    // Clean up all idle workers
    for (const worker of this._idle.splice(0)) {
      worker.postMessage(false);
    }

    // There are still active workers, wait for them to clean up.
    await new Promise<void>((resolve, reject) => this._onComplete.push([resolve, reject]));
  }

  /**
   * Resets the pool and allows more work
   */
  public reset(): void {
    this._finishing = false;
    this._error = undefined;
  }

  /**
   * Returns a worker to the pool. If the pool is finishing, deallocates the worker.
   * @param worker - The worker to free
   */
  public checkinWorker(worker: Worker): void {
    if (this._error) {
      // Shut down the worker (failure)
      worker.postMessage(false);
      return;
    }

    const next: [(worker: Worker) => void, unknown] | undefined = this._pending.shift();

    if (next) {
      // Perform the next unit of work;
      next[0](worker);
    } else if (this._finishing) {
      // Shut down the worker (success)
      worker.postMessage(false);
    } else {
      // No pending work, idle the workers
      this._idle.push(worker);
    }
  }

  /**
   * Checks out a currently available worker or waits for the next free worker.
   * @param allowCreate - If creating new workers is allowed (subject to maxSize)
   */
  public async checkoutWorkerAsync(allowCreate: boolean): Promise<Worker> {
    if (this._error) {
      throw this._error;
    }

    let worker: Worker | undefined = this._idle.shift();
    if (!worker && allowCreate) {
      worker = this._createWorker();
    }

    if (worker) {
      return worker;
    }

    return await new Promise((resolve: (worker: Worker) => void, reject: (error: Error) => void) => {
      this._pending.push([resolve, reject]);
    });
  }

  /**
   * Creates a new worker if allowed by maxSize.
   */
  private _createWorker(): Worker | undefined {
    if (this._alive.length >= this.maxWorkers) {
      return;
    }

    // Defer the import to allow WorkerPoolMinifier to be exposed via the index
    const workerConstructor: typeof Worker = require('worker_threads').Worker;

    const worker: Worker & {
      [WORKER_ID_SYMBOL]?: string;
    } = new workerConstructor(this._workerScript, {
      eval: false,
      workerData: this._workerData
    });

    const id: string = `${this.id}#${++this._nextId}`;
    worker[WORKER_ID_SYMBOL] = id;

    this._alive.push(worker);

    worker.on('error', (err) => {
      this._onError(err);
      this._destroyWorker(worker);
    });

    worker.on('exit', (exitCode) => {
      if (exitCode !== 0) {
        this._onError(new Error(`Worker ${id} exited with code ${exitCode}`));
      }
      this._destroyWorker(worker);
    });

    if (this._prepare) {
      this._prepare(worker);
    }

    return worker;
  }

  /**
   * Cleans up a worker
   */
  private _destroyWorker(worker: Worker): void {
    const aliveIndex: number = this._alive.indexOf(worker);
    if (aliveIndex >= 0) {
      this._alive.splice(aliveIndex, 1);
    }

    const freeIndex: number = this._idle.indexOf(worker);
    if (freeIndex >= 0) {
      this._idle.splice(freeIndex, 1);
    }

    worker.unref();

    if (this._onWorkerDestroyed) {
      this._onWorkerDestroyed();
    }

    if (!this._alive.length && !this._error) {
      for (const [resolve] of this._onComplete.splice(0)) {
        resolve();
      }
    }
  }

  /**
   * Notifies all pending callbacks that an error has occurred and switches this pool into error state.
   */
  private _onError(error: Error): void {
    this._error = error;

    for (const [, reject] of this._pending.splice(0)) {
      reject(this._error);
    }

    for (const [, reject] of this._onComplete.splice(0)) {
      reject(this._error);
    }
  }
}
