// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StdioSummarizer } from '@rushstack/terminal';
import { CollatedWriter } from '@rushstack/stream-collator';

import { Stopwatch } from '../../utilities/Stopwatch';
import { TaskStatus } from './TaskStatus';
import { TaskError } from './TaskError';
import { BaseBuilder } from './BaseBuilder';

/**
 * The `Task` class is a node in the dependency graph of work that needs to be scheduled by the `TaskRunner`.
 * Each `Task` has a `BaseBuilder` member, whose subclass manages the actual operations for building a single
 * project.
 */
export class Task {
  /**
   * When the scheduler is ready to process this `Task`, the `builder` implements the actual work of
   * building the project.
   */
  public builder: BaseBuilder;

  /**
   * The current execution status of a task. Tasks start in the 'ready' state,
   * but can be 'blocked' if an upstream task failed. It is 'executing' when
   * the task is executing. Once execution is complete, it is either 'success' or
   * 'failure'.
   */
  public status: TaskStatus;

  /**
   * A set of all dependencies which must be executed before this task is complete.
   * When dependencies finish execution, they are removed from this list.
   */
  public dependencies: Set<Task> = new Set<Task>();

  /**
   * The inverse of dependencies, lists all projects which are directly dependent on this one.
   */
  public dependents: Set<Task> = new Set<Task>();

  /**
   * This number represents how far away this Task is from the furthest "root" project (i.e.
   * a project with no dependents). This helps us to calculate the critical path (i.e. the
   * longest chain of projects which must be executed in order, thereby limiting execution speed
   * of the entire task tree.
   *
   * This number is calculated via a memoized recursive function, and when choosing the next
   * task to execute, the task with the highest criticalPathLength is chosen.
   *
   * Example:
   *        (0) A
   *             \
   *          (1) B     C (0)         (applications)
   *               \   /|\
   *                \ / | \
   *             (2) D  |  X (1)      (utilities)
   *                    | / \
   *                    |/   \
   *                (2) Y     Z (2)   (other utilities)
   *
   * All roots (A & C) have a criticalPathLength of 0.
   * B has a score of 1, since A depends on it.
   * D has a score of 2, since we look at the longest chain (e.g D->B->A is longer than D->C)
   * X has a score of 1, since the only package which depends on it is A
   * Z has a score of 2, since only X depends on it, and X has a score of 1
   * Y has a score of 2, since the chain Y->X->C is longer than Y->C
   *
   * The algorithm is implemented in TaskRunner as _calculateCriticalPaths()
   */
  public criticalPathLength: number | undefined;

  /**
   * The error which occurred while executing this task, this is stored in case we need
   * it later (for example to re-print errors at end of execution).
   */
  public error: TaskError | undefined;

  /**
   * The task writer which contains information from the output streams of this task
   */
  public collatedWriter!: CollatedWriter;

  public stdioSummarizer!: StdioSummarizer;

  /**
   * The stopwatch which measures how long it takes the task to execute
   */
  public stopwatch!: Stopwatch;

  public allowWarningsOnSuccess: boolean | undefined;

  public constructor(builder: BaseBuilder, initialStatus: TaskStatus) {
    this.builder = builder;
    this.status = initialStatus;
  }

  public get name(): string {
    return this.builder.name;
  }
}
