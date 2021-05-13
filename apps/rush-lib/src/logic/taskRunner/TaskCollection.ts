// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Sort } from '@rushstack/node-core-library';

import { Task } from './Task';
import { TaskStatus } from './TaskStatus';
import { BaseBuilder } from './BaseBuilder';

/**
 * This class represents a set of tasks with interdependencies.  Any class of task definition
 * may be registered, and dependencies between tasks are easily specified. There is a check for
 * cyclic dependencies and tasks are ordered based on critical path.
 */
export class TaskCollection {
  private _tasks: Map<string, Task>;

  public constructor() {
    this._tasks = new Map<string, Task>();
  }

  /**
   * Registers a task definition to the map of defined tasks
   */
  public addTask(builder: BaseBuilder): void {
    if (this._tasks.has(builder.name)) {
      throw new Error('A task with that name has already been registered.');
    }

    const task: Task = new Task(builder, TaskStatus.Ready);
    task.criticalPathLength = undefined;
    task.allowWarningsOnSuccess = builder.allowWarningsOnSuccess;
    this._tasks.set(task.name, task);
  }

  /**
   * Returns true if a task with that name has been registered
   */
  public hasTask(taskName: string): boolean {
    return this._tasks.has(taskName);
  }

  /**
   * Defines the list of dependencies for an individual task.
   * @param taskName - the string name of the task for which we are defining dependencies. A task with this
   * name must already have been registered.
   */
  public addDependencies(taskName: string, taskDependencies: Iterable<string>): void {
    const task: Task | undefined = this._tasks.get(taskName);

    if (!task) {
      throw new Error(`The task '${taskName}' has not been registered`);
    }
    if (!taskDependencies) {
      throw new Error('The list of dependencies must be defined');
    }

    for (const dependencyName of taskDependencies) {
      if (!this._tasks.has(dependencyName)) {
        throw new Error(`The project '${dependencyName}' has not been registered.`);
      }
      const dependency: Task = this._tasks.get(dependencyName)!;
      task.dependencies.add(dependency);
      dependency.dependents.add(task);
    }
  }

  /**
   * Returns the tasks registered with the collection ordered by the critical path.
   * It also makes sure there are no cyclic dependencies in the tasks.
   */
  public getOrderedTasks(): Task[] {
    this._checkForCyclicDependencies(this._tasks.values(), [], new Set<string>());

    // Precalculate the number of dependent packages
    this._tasks.forEach((task: Task) => {
      this._calculateCriticalPaths(task);
    });

    const buildQueue: Task[] = [];
    // Add everything to the buildQueue
    this._tasks.forEach((task: Task) => {
      buildQueue.push(task);
    });

    // Sort the queue in descending order, nothing will mess with the order
    Sort.sortBy(buildQueue, (task: Task): number => -task.criticalPathLength!);

    return buildQueue;
  }

  /**
   * Checks for projects that indirectly depend on themselves.
   */
  private _checkForCyclicDependencies(
    tasks: Iterable<Task>,
    dependencyChain: string[],
    alreadyCheckedProjects: Set<string>
  ): void {
    for (const task of tasks) {
      if (dependencyChain.indexOf(task.name) >= 0) {
        throw new Error(
          'A cyclic dependency was encountered:\n' +
            '  ' +
            [...dependencyChain, task.name].reverse().join('\n  -> ') +
            '\nConsider using the cyclicDependencyProjects option for rush.json.'
        );
      }

      if (!alreadyCheckedProjects.has(task.name)) {
        alreadyCheckedProjects.add(task.name);
        dependencyChain.push(task.name);
        this._checkForCyclicDependencies(task.dependents, dependencyChain, alreadyCheckedProjects);
        dependencyChain.pop();
      }
    }
  }

  /**
   * Calculate the number of packages which must be built before we reach
   * the furthest away "root" node
   */
  private _calculateCriticalPaths(task: Task): number {
    // Return the memoized value
    if (task.criticalPathLength !== undefined) {
      return task.criticalPathLength;
    }

    // If no dependents, we are in a "root"
    if (task.dependents.size === 0) {
      task.criticalPathLength = 0;
      return task.criticalPathLength;
    } else {
      // Otherwise we are as long as the longest package + 1
      const depsLengths: number[] = [];
      task.dependents.forEach((dep) => depsLengths.push(this._calculateCriticalPaths(dep)));
      task.criticalPathLength = Math.max(...depsLengths) + 1;
      return task.criticalPathLength;
    }
  }
}
