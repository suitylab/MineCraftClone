/**
 * Input.ts — Unified keyboard and mouse input system with Pointer Lock support.
 *
 * This module provides a self-contained input abstraction for the Minecraft clone.
 * It handles:
 * - Keyboard state tracking (WASD, Space, and any other key via `event.code`)
 * - Mouse delta accumulation in Pointer Lock mode (for camera rotation)
 * - Pointer Lock request and state tracking
 * - Clean lifecycle management via `dispose()`
 *
 * ## Usage
 *
 * ```typescript
 * const input = new Input(canvas);
 *
 * // In the game loop:
 * const delta = input.getMouseDelta();
 * camera.rotation.x -= delta.y * sensitivity;
 * camera.rotation.y -= delta.x * sensitivity;
 *
 * if (input.isKeyDown('KeyW')) {
 *   // Move forward
 * }
 *
 * // On game shutdown:
 * input.dispose();
 * ```
 *
 * ## Design Decisions
 *
 * - Uses `event.code` (physical key position) instead of `event.key` (character value)
 *   to ensure layout-independent behavior (e.g., WASD works on AZERTY keyboards).
 * - Mouse delta is accumulated between frames and consumed via `getMouseDelta()`,
 *   which resets the accumulator to zero. This prevents drift and ensures each
 *   frame receives exactly the movement since the last frame.
 * - All event listeners are bound as arrow function properties to preserve `this`
 *   context AND allow clean removal via `removeEventListener`.
  * - The class is fully self-contained — it has no dependencies on other game modules.
 * - Pointer lock requests are gated by the `_allowPointerLockRequest` flag.
 *   This prevents the mouse from being hidden when clicking menu buttons
 *   in the main menu. The Game class enables this flag only when entering
 *   the PLAYING state and disables it when leaving PLAYING.
 */
export class Input {
  /** Map of currently pressed keys, keyed by `event.code` (e.g., 'KeyW', 'Space'). */
  private _keys: { [code: string]: boolean };

  /** Accumulated mouse X delta since the last `getMouseDelta()` call. */
  private _mouseDeltaX: number;

  /** Accumulated mouse Y delta since the last `getMouseDelta()` call. */
  private _mouseDeltaY: number;

  /** Whether the pointer is currently locked to the canvas. */
  private _isPointerLocked: boolean;

  /** The canvas element to request pointer lock on. */
  private readonly _canvas: HTMLCanvasElement;

    /** Whether the input system has been disposed (prevents double-dispose). */
  private _disposed: boolean;

  /** Handler invoked on left mouse button click (block break). */
  private _onLeftClick: (() => void) | null;

    /** Handler invoked on right mouse button click (block place). */
  private _onRightClick: (() => void) | null;

  /**
   * Whether pointer lock requests are allowed.
   *
   * When false (default), the _onClick handler does NOT request pointer
   * lock. This prevents the mouse from being hidden when clicking menu
   * buttons in the main menu. The Game class enables this flag only
   * when entering the PLAYING state.
   */
  private _allowPointerLockRequest: boolean;

  /**
   * Creates a new Input instance and binds all event listeners.
   *
   * @param canvas - The canvas element to request pointer lock on.
   *                 This is typically the WebGL renderer's canvas.
   */
  constructor(canvas: HTMLCanvasElement) {
    this._keys = {};
    this._mouseDeltaX = 0;
    this._mouseDeltaY = 0;
    this._isPointerLocked = false;
        this._canvas = canvas;
    this._disposed = false;
        this._onLeftClick = null;
    this._onRightClick = null;
    this._allowPointerLockRequest = false;

    this._bindEvents();
  }

  /**
   * Checks whether the given key is currently pressed.
   *
   * Uses `event.code` values (physical key positions), not `event.key`
   * (character values). Common codes:
   * - 'KeyW', 'KeyA', 'KeyS', 'KeyD' — WASD movement keys
   * - 'Space' — Space bar
   * - 'Digit1' through 'Digit9' — Number row keys
   * - 'ShiftLeft', 'ShiftRight' — Shift keys
   *
   * @param code - The `event.code` value to check (e.g., 'KeyW', 'Space').
   * @returns True if the key is currently held down, false otherwise.
   *          Returns false for unknown keys or after disposal.
   */
  public isKeyDown(code: string): boolean {
    if (this._disposed) {
      return false;
    }
    return this._keys[code] === true;
  }

  /**
   * Returns the accumulated mouse movement since the last call to this method.
   *
   * The delta is consumed and reset to zero after each call. This ensures
   * each frame receives exactly the mouse movement that occurred since the
   * previous frame, preventing drift or double-counting.
   *
   * When the pointer is not locked, this method returns `{ x: 0, y: 0 }`
   * because mouse movement is not tracked outside of Pointer Lock mode.
   *
   * @returns An object containing the accumulated X and Y deltas in pixels.
   *          Returns `{ x: 0, y: 0 }` if the pointer is not locked or after disposal.
   */
  public getMouseDelta(): { x: number; y: number } {
    if (this._disposed) {
      return { x: 0, y: 0 };
    }

    // Capture the accumulated deltas.
    const delta = { x: this._mouseDeltaX, y: this._mouseDeltaY };

    // Reset the accumulator to zero (consume the delta).
    this._mouseDeltaX = 0;
    this._mouseDeltaY = 0;

    return delta;
  }

  /**
   * Checks whether the pointer is currently locked to the canvas.
   *
   * Pointer Lock mode is required for FPS-style camera controls — it
   * hides the cursor and provides raw mouse movement deltas.
   *
   * @returns True if the pointer is locked, false otherwise.
   *          Returns false after disposal.
   */
  public isPointerLocked(): boolean {
    if (this._disposed) {
      return false;
    }
    return this._isPointerLocked;
  }

    /**
   * Sets the handler invoked when the left mouse button is clicked.
   *
   * The handler is only invoked when the pointer is locked (game active).
   * Pass null to clear the handler.
   *
   * @param handler - The left-click handler function, or null to clear.
   */
  public setLeftClickHandler(handler: () => void): void {
    this._onLeftClick = handler;
  }

  /**
   * Sets the handler invoked when the right mouse button is clicked.
   *
   * The handler is only invoked when the pointer is locked (game active).
   * Pass null to clear the handler.
   *
   * @param handler - The right-click handler function, or null to clear.
   */
    public setRightClickHandler(handler: () => void): void {
    this._onRightClick = handler;
  }

  /**
   * Sets whether pointer lock requests are allowed.
   *
   * When false, the _onClick handler does NOT request pointer lock.
   * This prevents the mouse from being hidden when clicking menu buttons
   * in the main menu. The Game class enables this flag only when entering
   * the PLAYING state and disables it when leaving PLAYING.
   *
   * @param allow - Whether pointer lock requests should be allowed.
   */
  public setAllowPointerLockRequest(allow: boolean): void {
    this._allowPointerLockRequest = allow;
  }

  /**
   * Requests Pointer Lock on the canvas.
   *
   * This is typically called when the user clicks the canvas or presses
   * a "resume" button. The browser may reject the request if:
   * - The document is not focused
   * - The user has not interacted with the page recently
   * - Pointer Lock is not supported by the browser
   *
   * If the pointer is already locked, this method is a no-op.
   * If the canvas is not attached to the DOM, a warning is logged.
   */
  public requestPointerLock(): void {
    if (this._disposed) {
      return;
    }

    // Check if the pointer is already locked — no-op if so.
    if (this._isPointerLocked) {
      return;
    }

    // Check if the canvas is attached to the DOM.
        if (!this._canvas.isConnected) {
      return;
    }

    // Request pointer lock on the canvas.
    // The promise-based API is used when available (modern browsers).
    const requestPromise = this._canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (requestPromise && typeof requestPromise.catch === 'function') {
            requestPromise.catch(() => {
        // Pointer lock request rejected — no action needed.
      });
    }
  }

  /**
   * Exits Pointer Lock mode if it is currently active.
   *
   * This is typically called when the game is paused or the player
   * returns to a menu. The browser also automatically exits Pointer
   * Lock when the user presses ESC.
   */
  public exitPointerLock(): void {
    if (this._disposed) {
      return;
    }

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  /**
   * Cleans up all resources held by the input system.
   *
   * This method:
   * 1. Removes all event listeners (keyboard, mouse, pointer lock)
   * 2. Exits pointer lock if active
   * 3. Clears all key states
   * 4. Resets mouse delta accumulators
   * 5. Marks the instance as disposed
   *
   * After calling dispose(), all public methods return safe defaults
   * (false for isKeyDown/isPointerLocked, zero delta for getMouseDelta).
   * Calling dispose() multiple times is safe — subsequent calls are no-ops.
   */
  public dispose(): void {
    if (this._disposed) {
      return;
    }

    // Remove all event listeners.
    this._unbindEvents();

    // Exit pointer lock if active.
    if (this._isPointerLocked) {
      this.exitPointerLock();
    }

        // Clear all state.
    this._keys = {};
    this._mouseDeltaX = 0;
    this._mouseDeltaY = 0;
    this._isPointerLocked = false;
    this._allowPointerLockRequest = false;

    // Mark as disposed.
    this._disposed = true;
  }

  /**
   * Binds all event listeners for keyboard, mouse, and pointer lock.
   *
   * All listeners are bound as arrow function properties to preserve
   * `this` context. This also allows clean removal via `removeEventListener`
   * in `_unbindEvents()`.
   */
  private _bindEvents(): void {
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('click', this._onClick);
    document.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  /**
   * Removes all event listeners bound by `_bindEvents()`.
   *
   * This is called by `dispose()` to prevent memory leaks. The function
   * references are the same arrow function properties used in `_bindEvents()`,
   * so removal is guaranteed to work.
   */
  private _unbindEvents(): void {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('click', this._onClick);
    document.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }

  /**
   * Handles keydown events by marking the key as pressed.
   *
   * Uses `event.code` (physical key position) rather than `event.key`
   * (character value) for layout-independent behavior.
   *
   * @param event - The KeyboardEvent from the browser.
   */
  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    // Mark the key as pressed.
    this._keys[event.code] = true;
  };

  /**
   * Handles keyup events by marking the key as released.
   *
   * @param event - The KeyboardEvent from the browser.
   */
  private readonly _onKeyUp = (event: KeyboardEvent): void => {
    // Mark the key as released.
    this._keys[event.code] = false;
  };

  /**
   * Handles mousemove events by accumulating mouse deltas.
   *
   * Mouse movement is only tracked when the pointer is locked. When
   * unlocked, `event.movementX/Y` may be unreliable or zero, so we
   * skip accumulation entirely.
   *
   * @param event - The MouseEvent from the browser.
   */
  private readonly _onMouseMove = (event: MouseEvent): void => {
    // Only accumulate deltas when the pointer is locked.
    if (!this._isPointerLocked) {
      return;
    }

    // Accumulate the movement deltas.
    this._mouseDeltaX += event.movementX;
    this._mouseDeltaY += event.movementY;
  };

    /**
   * Handles mousedown events for left/right click actions.
   *
   * Only triggers when the pointer is locked (game active). Left-click
   * (button 0) invokes the left-click handler; right-click (button 2)
   * invokes the right-click handler.
   *
   * @param event - The MouseEvent from the browser.
   */
  private readonly _onMouseDown = (event: MouseEvent): void => {
    // Only trigger when the pointer is locked (game active).
    if (!this._isPointerLocked) {
      return;
    }

    // Left-click: button 0.
    if (event.button === 0 && this._onLeftClick) {
      this._onLeftClick();
    }
    // Right-click: button 2.
    else if (event.button === 2 && this._onRightClick) {
      this._onRightClick();
    }
  };

  /**
   * Prevents the browser's default context menu on right-click.
   *
   * This is necessary because right-click is used for block placement
   * in the game, and the context menu would interfere with gameplay.
   *
   * @param event - The MouseEvent from the browser.
   */
  private readonly _onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  /**
   * Handles click events by requesting Pointer Lock.
   *
   * This provides the standard FPS control scheme: click to lock the
   * pointer, press ESC to unlock. The browser automatically exits
   * Pointer Lock on ESC, which triggers the pointerlockchange event.
   *
   * @param event - The MouseEvent from the browser.
   */
    private readonly _onClick = (event: MouseEvent): void => {
    // Only request pointer lock on left-click (button 0).
    if (event.button !== 0) {
      return;
    }

    // Only request pointer lock when allowed.
    // This prevents the mouse from being hidden when clicking menu buttons
    // in the main menu. The Game class enables this flag only when entering
    // the PLAYING state.
    if (!this._allowPointerLockRequest) {
      return;
    }

    // Request pointer lock on the canvas.
    this.requestPointerLock();
  };

  /**
   * Handles pointerlockchange events to track the lock state.
   *
   * This event fires when:
   * - Pointer lock is successfully acquired (after requestPointerLock)
   * - Pointer lock is released (via ESC, exitPointerLock, or browser action)
   *
   * The state is derived from `document.pointerLockElement` — if it
   * matches our canvas, the pointer is locked to us.
   */
  private readonly _onPointerLockChange = (): void => {
    // Update the lock state based on whether our canvas has the lock.
    this._isPointerLocked = document.pointerLockElement === this._canvas;
  };
}