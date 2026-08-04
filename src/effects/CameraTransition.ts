/**
 * CameraTransition.ts — Smooth camera descent transition for the Minecraft Clone.
 *
 * This module implements a 1-second camera transition that smoothly descends
 * from a starting position (e.g., 20 blocks above spawn) to an end position
 * (e.g., the player's eye position) using easeInOutCubic easing.
 *
 * ## Easing Function
 *
 * The transition uses easeInOutCubic:
 * - t < 0.5: 4·t³ (accelerating)
 * - t ≥ 0.5: 1 − (−2·t + 2)³ / 2 (decelerating)
 *
 * This provides a smooth start, a natural mid-transition speed, and a gentle
 * settle at the end — ideal for a camera descent that feels weighty but not
 * jarring.
 *
 * ## Usage
 *
 * ```typescript
 * const transition = new CameraTransition(camera);
 *
 * // When entering PLAYING state:
 * const startPos = new THREE.Vector3(spawn.x, spawn.y + 20, spawn.z);
 * const endPos = player.getEyePosition();
 * transition.start(startPos, endPos);
 *
 * // In the game loop:
 * if (transition.isActive()) {
 *   const complete = transition.update(deltaTime);
 *   if (complete) {
 *     // Transition finished — enable player controls.
 *   }
 * }
 *
 * // On game shutdown:
 * transition.dispose();
 * ```
 *
 * ## Robustness
 *
 * - `update()` before `start()` returns `false` immediately.
 * - Negative or zero `deltaTime` does not advance the animation.
 * - Progress is clamped to [0, 1] to prevent overshoot.
 * - On completion, the camera position is set exactly to the end position.
 */
import * as THREE from 'three';

/** Total transition duration in seconds. */
const TRANSITION_DURATION = 1.0;

/**
 * CameraTransition — Smooth camera position interpolation.
 *
 * The transition interpolates the camera position from a start position to
 * an end position over 1 second using easeInOutCubic easing. Camera rotation
 * is not modified — the camera is expected to already be oriented correctly.
 *
 * The class is self-contained with no dependencies beyond THREE.js. It does
 * not own the camera — it only mutates its position during the transition.
 * Call `dispose()` when the transition is no longer needed.
 */
export class CameraTransition {
  /** The camera whose position is interpolated. */
  private readonly _camera: THREE.PerspectiveCamera;

  /** The starting position of the transition. */
  private _startPosition: THREE.Vector3;

  /** The ending position of the transition. */
  private _endPosition: THREE.Vector3;

  /** Elapsed time in seconds since the transition started. */
  private _elapsedTime: number;

  /** Whether the transition is currently active. */
  private _isActive: boolean;

  /** Whether the transition has been disposed (prevents double-dispose). */
  private _disposed: boolean;

  /**
   * Creates a new CameraTransition for the given camera.
   *
   * The transition starts inactive — call `start()` to begin the animation.
   *
   * @param camera - The camera whose position will be interpolated.
   */
  constructor(camera: THREE.PerspectiveCamera) {
    this._camera = camera;
    this._startPosition = new THREE.Vector3();
    this._endPosition = new THREE.Vector3();
    this._elapsedTime = 0;
    this._isActive = false;
    this._disposed = false;
  }

  /**
   * Begins the camera transition from the given start position to the end position.
   *
   * The input vectors are cloned internally, so external mutations after
   * calling `start()` do not affect the transition. If the transition is
   * already active, calling `start()` restarts it from the new positions.
   *
   * @param fromPosition - The starting camera position (e.g., 20 blocks above spawn).
   * @param toPosition - The ending camera position (e.g., the player's eye position).
   */
  public start(fromPosition: THREE.Vector3, toPosition: THREE.Vector3): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Clone the input vectors to prevent external mutation during the transition.
    this._startPosition.copy(fromPosition);
    this._endPosition.copy(toPosition);

    // Reset the elapsed time and activate the transition.
    this._elapsedTime = 0;
    this._isActive = true;
  }

  /**
   * Advances the transition by the given delta time.
   *
   * Should be called every frame while the transition is active. Returns
   * `true` when the transition completes, signaling the caller to enable
   * player controls or perform other post-transition actions.
   *
   * @param deltaTime - Time in seconds since the last frame.
   * @returns True when the transition is complete, false otherwise.
   */
  public update(deltaTime: number): boolean {
    // Guard against use after disposal.
    if (this._disposed) {
      return false;
    }

    // If the transition is not active, return false immediately.
    if (!this._isActive) {
      return false;
    }

    // Ignore non-positive delta times — they would not advance the animation.
    if (deltaTime <= 0) {
      return false;
    }

    // Advance the elapsed time.
    this._elapsedTime += deltaTime;

    // Clamp the progress to [0, 1] to prevent overshoot.
    const progress = Math.min(1, this._elapsedTime / TRANSITION_DURATION);

    // Compute the eased progress using easeInOutCubic.
    const easedProgress = this._easeInOutCubic(progress);

    // Interpolate the camera position between start and end.
    this._camera.position.lerpVectors(this._startPosition, this._endPosition, easedProgress);

    // Check if the transition is complete.
    if (progress >= 1) {
      // Set the camera position exactly to the end position (no overshoot).
      this._camera.position.copy(this._endPosition);

      // Deactivate the transition.
      this._isActive = false;

      return true;
    }

    return false;
  }

  /**
   * Returns whether the transition is currently running.
   *
   * @returns True if the transition is active, false otherwise.
   */
  public isActive(): boolean {
    return this._isActive;
  }

  /**
   * Stops the transition and resets its state.
   *
   * The camera position is left at its current value — this method does
   * not snap the camera to either the start or end position. Call this
   * when the transition should be aborted (e.g., the game is paused or
   * the player returns to a menu).
   */
  public reset(): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Reset the transition state.
    this._elapsedTime = 0;
    this._isActive = false;
  }

  /**
   * Cleans up all resources held by the transition.
   *
   * This method resets the transition state and marks the instance as
   * disposed. After calling dispose(), all public methods become no-ops.
   * Calling dispose() multiple times is safe — subsequent calls are ignored.
   *
   * The camera reference is not released — the camera is owned by the
   * caller and should be disposed separately if needed.
   */
  public dispose(): void {
    // Guard against double-dispose.
    if (this._disposed) {
      return;
    }

    // Reset the transition state.
    this._elapsedTime = 0;
    this._isActive = false;

    // Mark as disposed.
    this._disposed = true;
  }

  /**
   * Computes the easeInOutCubic easing function.
   *
   * @param t - The raw progress value in range [0, 1].
   * @returns The eased progress value in range [0, 1].
   */
  private _easeInOutCubic(t: number): number {
    if (t < 0.5) {
      return 4 * t * t * t;
    }
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}