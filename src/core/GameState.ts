/**
 * GameState.ts — Game state machine for the Minecraft Clone Phase 7.
 *
 * This module defines the complete game state machine with all possible
 * states and legal transitions. It provides:
 *
 * - **GameState enum**: All possible game states (MENU, LOADING, PLAYING,
 *   PAUSED, CONTROLS, ABOUT) with numeric values for type-safe comparison.
 * - **GameStateManager class**: Tracks the current state, validates
 *   transitions according to the state transition table, and provides
 *   a `transition()` method to change states.
 * - **Callback system**: Allows the Game class to register listeners for
 *   specific state changes, enabling reactive UI updates and system
 *   start/stop logic.
 *
 * ## State Transition Table
 *
 * | From State | Trigger | To State |
 * |------------|---------|----------|
 * | MENU       | start game      | LOADING  |
 * | LOADING    | world gen done  | PLAYING  |
 * | PLAYING    | ESC pressed     | PAUSED   |
 * | PAUSED     | resume          | PLAYING  |
 * | PAUSED     | restart         | LOADING  |
 * | PAUSED     | main menu       | MENU     |
 * | CONTROLS   | back            | MENU     |
 * | ABOUT      | back            | MENU     |
 *
 * ## Usage
 *
 * ```typescript
 * const stateManager = new GameStateManager();
 *
 * // Register a callback for when the game enters PLAYING state.
 * const unsubscribe = stateManager.onStateChange(GameState.PLAYING, () => {
 *   console.log('Game started!');
 * });
 *
 * // Transition to LOADING (from initial MENU state).
 * stateManager.transition(GameState.LOADING);
 *
 * // Later, when world generation completes:
 * stateManager.transition(GameState.PLAYING);
 *
 * // Clean up the callback when no longer needed.
 * unsubscribe();
 * ```
 */
export enum GameState {
  /** Main menu — initial state, shows title and menu buttons. */
  MENU = 0,
  /** Loading screen — world generation in progress. */
  LOADING = 1,
  /** Playing — active gameplay with player controls enabled. */
  PLAYING = 2,
  /** Paused — game frozen, pause menu shown. */
  PAUSED = 3,
  /** Controls — shows control instructions, accessible from menu. */
  CONTROLS = 4,
  /** About — shows project information, accessible from menu. */
  ABOUT = 5,
}

/**
 * GameStateManager — Tracks and manages game state transitions.
 *
 * The manager maintains the current state and validates all transitions
 * against the state transition table. Invalid transitions throw descriptive
 * errors to catch programming mistakes early.
 *
 * The callback system allows external code (e.g., the Game class) to react
 * to state changes. Callbacks are registered per-target-state and invoked
 * when the manager transitions INTO that state.
 */
export class GameStateManager {
  /**
   * The state transition table.
   *
   * Maps each source state to a set of allowed target states. This is
   * the single source of truth for legal transitions.
   */
  private static readonly TRANSITIONS: Record<GameState, Set<GameState>> = {
    [GameState.MENU]: new Set([GameState.LOADING, GameState.CONTROLS, GameState.ABOUT]),
    [GameState.LOADING]: new Set([GameState.PLAYING]),
    [GameState.PLAYING]: new Set([GameState.PAUSED]),
    [GameState.PAUSED]: new Set([GameState.PLAYING, GameState.LOADING, GameState.MENU]),
    [GameState.CONTROLS]: new Set([GameState.MENU]),
    [GameState.ABOUT]: new Set([GameState.MENU]),
  };

  /** The current game state. */
  private _currentState: GameState;

  /** Map of state → array of callbacks to invoke when entering that state. */
  private _listeners: Map<GameState, Array<() => void>>;

  /**
   * Creates a new GameStateManager.
   *
   * The initial state is MENU — the game always starts at the main menu.
   */
  constructor() {
    this._currentState = GameState.MENU;
    this._listeners = new Map();
  }

  /**
   * Returns the current game state.
   *
   * @returns The current GameState enum value.
   */
  public getCurrentState(): GameState {
    return this._currentState;
  }

  /**
   * Returns the current state as a human-readable string.
   *
   * Useful for debugging and logging.
   *
   * @returns The name of the current state (e.g., 'MENU', 'PLAYING').
   */
  public getStateName(): string {
    return GameState[this._currentState];
  }

  /**
   * Transitions the game to a new state.
   *
   * Validates the transition against the state transition table. If the
   * transition is legal, updates the current state and invokes all
   * callbacks registered for the target state.
   *
   * @param newState - The target state to transition to.
   * @throws Error if the transition is not allowed from the current state.
   */
  public transition(newState: GameState): void {
    // Validate the transition.
    if (!this._isValidTransition(this._currentState, newState)) {
      throw new Error(
        `Invalid game state transition: ${GameState[this._currentState]} → ${GameState[newState]}`
      );
    }

    // Update the current state.
    this._currentState = newState;

    // Invoke all callbacks registered for the new state.
    this._invokeListeners(newState);
  }

  /**
   * Registers a callback to be invoked when the game enters the given state.
   *
   * The callback is invoked synchronously during `transition()` when the
   * target state matches the registered state.
   *
   * @param state - The state to listen for.
   * @param callback - The function to invoke when entering the state.
   * @returns An unsubscribe function that removes the callback.
   */
  public onStateChange(state: GameState, callback: () => void): () => void {
    // Get or create the listener array for this state.
    let listeners = this._listeners.get(state);
    if (!listeners) {
      listeners = [];
      this._listeners.set(state, listeners);
    }

    // Add the callback.
    listeners.push(callback);

    // Return an unsubscribe function.
    return () => {
      const currentListeners = this._listeners.get(state);
      if (currentListeners) {
        const index = currentListeners.indexOf(callback);
        if (index !== -1) {
          currentListeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * Checks whether a transition from one state to another is legal.
   *
   * @param fromState - The current state.
   * @param toState - The desired target state.
   * @returns True if the transition is allowed, false otherwise.
   */
  private _isValidTransition(fromState: GameState, toState: GameState): boolean {
    // Get the allowed target states for the source state.
    const allowedTargets = GameStateManager.TRANSITIONS[fromState];

    // If the source state has no entry in the table, no transitions are allowed.
    if (!allowedTargets) {
      return false;
    }

    // Check if the target state is in the allowed set.
    return allowedTargets.has(toState);
  }

  /**
   * Invokes all callbacks registered for the given state.
   *
   * @param state - The state whose listeners should be invoked.
   */
  private _invokeListeners(state: GameState): void {
    const listeners = this._listeners.get(state);
    if (listeners) {
      // Copy the array to avoid issues if callbacks modify the listener list.
      const callbacks = [...listeners];
      for (const callback of callbacks) {
        callback();
      }
    }
  }
}