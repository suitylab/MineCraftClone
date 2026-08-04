/**
 * PauseMenu.ts — Pause menu screen for the Minecraft Clone Phase 7.
 *
 * This class creates and manages the fullscreen pause menu overlay that
 * appears when the player presses ESC during gameplay. It displays:
 *
 * - **Title**: "游戏暂停" centered with a pixel-style font and text-shadow
 *   glow effect. The title is smaller than the main menu title to create
 *   visual distinction.
 * - **Buttons**: Three vertically arranged buttons — "继续游戏" (Resume),
 *   "重新开始" (Restart), and "返回主菜单" (Back to Main Menu).
 * - **Background**: A semi-transparent dark overlay (rgba(0,0,0,0.7))
 *   that dims the frozen game scene behind, making it visible but clearly
 *   in the background.
 *
 * The menu is a DOM overlay positioned with `position: fixed` and a high
 * z-index (3000) so it renders above the WebGL canvas, crosshair (1000),
 * and hotbar (2000).
 *
 * ## Design Decisions
 *
 * - **Decoupled from game logic**: The PauseMenu class has no imports from
 *   game modules. It communicates with the Game class exclusively through
 *   callback setters (`setOnResume`, `setOnRestart`, `setOnMainMenu`).
 *   This keeps the UI layer clean and testable.
 * - **CSS class-based styling**: All visual styling is defined in
 *   `src/style.css` using the classes `menu-screen`, `menu-title`,
 *   `menu-button`, etc. The `pause-menu` class on the container provides
 *   the darker background and smaller title styling that distinguishes
 *   it from the main menu.
 * - **Safe callback invocation**: All callbacks are optional (nullable).
 *   The click handlers check for null before invoking, preventing errors
 *   if the Game class hasn't wired up the callbacks yet.
 * - **Clean lifecycle**: The `dispose()` method removes all event
 *   listeners and DOM elements, preventing memory leaks when the game
 *   is restarted or torn down.
 */
export class PauseMenu {
  /** The root overlay container element. */
  public container: HTMLDivElement;

  /** The title element displaying "游戏暂停". */
  public titleElement: HTMLHeadingElement;

  /** The container holding the three menu buttons. */
  public buttonsContainer: HTMLDivElement;

  /** The "继续游戏" (Resume) button element. */
  public resumeButton: HTMLButtonElement;

  /** The "重新开始" (Restart) button element. */
  public restartButton: HTMLButtonElement;

  /** The "返回主菜单" (Back to Main Menu) button element. */
  public mainMenuButton: HTMLButtonElement;

  /** Callback invoked when the "继续游戏" button is clicked. */
  private _onResume: (() => void) | null;

  /** Callback invoked when the "重新开始" button is clicked. */
  private _onRestart: (() => void) | null;

  /** Callback invoked when the "返回主菜单" button is clicked. */
  private _onMainMenu: (() => void) | null;

  /** Bound click handler for the resume button — stored for removal in dispose(). */
  private readonly _handleResumeClick: (event: MouseEvent) => void;

  /** Bound click handler for the restart button — stored for removal in dispose(). */
  private readonly _handleRestartClick: (event: MouseEvent) => void;

  /** Bound click handler for the main menu button — stored for removal in dispose(). */
  private readonly _handleMainMenuClick: (event: MouseEvent) => void;

  /**
   * Creates the pause menu overlay and appends it to the document body.
   *
   * The constructor:
   * 1. Creates the root container div with classes `menu-screen pause-menu`.
   * 2. Creates the title element with the pause menu title text.
   * 3. Creates the buttons container and three button elements.
   * 4. Appends elements in the correct DOM order.
   * 5. Binds click event listeners to the buttons.
   * 6. Sets the initial visibility to hidden (the Game class calls
   *    `show()` when the game enters the PAUSED state).
   */
  constructor() {
    // Initialize callback references to null.
    this._onResume = null;
    this._onRestart = null;
    this._onMainMenu = null;

    // --- Root Container ---
    // Create the fullscreen overlay container.
    // The `pause-menu` class provides the darker background and
    // smaller title styling that distinguishes it from the main menu.
    this.container = document.createElement('div');
    this.container.className = 'menu-screen pause-menu';
    this.container.id = 'pause-menu';

    // --- Title Element ---
    // Create the pause menu title heading.
    this.titleElement = document.createElement('h1');
    this.titleElement.className = 'menu-title';
    this.titleElement.textContent = '游戏暂停';

    // --- Buttons Container ---
    // Create the container that holds the three buttons vertically.
    this.buttonsContainer = document.createElement('div');
    this.buttonsContainer.className = 'menu-buttons';

    // --- Resume Button ---
    this.resumeButton = document.createElement('button');
    this.resumeButton.className = 'menu-button';
    this.resumeButton.textContent = '继续游戏';
    this.resumeButton.type = 'button';

    // --- Restart Button ---
    this.restartButton = document.createElement('button');
    this.restartButton.className = 'menu-button';
    this.restartButton.textContent = '重新开始';
    this.restartButton.type = 'button';

    // --- Main Menu Button ---
    this.mainMenuButton = document.createElement('button');
    this.mainMenuButton.className = 'menu-button';
    this.mainMenuButton.textContent = '返回主菜单';
    this.mainMenuButton.type = 'button';

    // --- DOM Assembly ---
    // Append buttons to the buttons container.
    this.buttonsContainer.appendChild(this.resumeButton);
    this.buttonsContainer.appendChild(this.restartButton);
    this.buttonsContainer.appendChild(this.mainMenuButton);

    // Append title and buttons container to the root container.
    this.container.appendChild(this.titleElement);
    this.container.appendChild(this.buttonsContainer);

    // Append the root container to the document body.
    document.body.appendChild(this.container);

    // --- Event Listener Binding ---
    // Store bound handlers as arrow functions so they can be removed
    // in dispose() without losing the `this` context.
    this._handleResumeClick = (event: MouseEvent) => this._onResumeButtonClick(event);
    this._handleRestartClick = (event: MouseEvent) => this._onRestartButtonClick(event);
    this._handleMainMenuClick = (event: MouseEvent) => this._onMainMenuButtonClick(event);

    // Bind click listeners to the buttons.
    this.resumeButton.addEventListener('click', this._handleResumeClick);
    this.restartButton.addEventListener('click', this._handleRestartClick);
    this.mainMenuButton.addEventListener('click', this._handleMainMenuClick);

    // --- Initial Visibility ---
    // Start hidden — the Game class calls show() when entering PAUSED state.
    this.hide();
  }

  /**
   * Sets the callback invoked when the "继续游戏" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnResume(callback: () => void): void {
    this._onResume = callback;
  }

  /**
   * Sets the callback invoked when the "重新开始" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnRestart(callback: () => void): void {
    this._onRestart = callback;
  }

  /**
   * Sets the callback invoked when the "返回主菜单" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnMainMenu(callback: () => void): void {
    this._onMainMenu = callback;
  }

  /**
   * Shows the pause menu overlay.
   *
   * Removes the `hidden` class and sets `display: flex` to make the
   * overlay visible. The overlay is positioned above all other UI
   * elements via its z-index.
   */
  public show(): void {
    this.container.classList.remove('hidden');
    this.container.style.display = 'flex';
  }

  /**
   * Hides the pause menu overlay.
   *
   * Adds the `hidden` class and sets `display: none` to make the
   * overlay invisible. The overlay remains in the DOM but does not
   * intercept pointer events.
   */
  public hide(): void {
    this.container.classList.add('hidden');
    this.container.style.display = 'none';
  }

  /**
   * Checks whether the pause menu is currently visible.
   *
   * @returns True if the overlay is visible, false otherwise.
   */
  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Removes all event listeners and cleans up the pause menu DOM.
   *
   * This method:
   * 1. Removes the click listeners from all three buttons.
   * 2. Removes the root container from the DOM.
   * 3. Clears all callback references.
   *
   * Call this when the game is being torn down to prevent memory leaks
   * and orphaned event listeners.
   */
  public dispose(): void {
    // Remove event listeners from the buttons.
    this.resumeButton.removeEventListener('click', this._handleResumeClick);
    this.restartButton.removeEventListener('click', this._handleRestartClick);
    this.mainMenuButton.removeEventListener('click', this._handleMainMenuClick);

    // Remove the container from the DOM if it's still attached.
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    // Clear callback references.
    this._onResume = null;
    this._onRestart = null;
    this._onMainMenu = null;
  }

  /**
   * Handles clicks on the "继续游戏" button.
   *
   * Invokes the registered resume callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onResumeButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onResume) {
      this._onResume();
    }
  }

  /**
   * Handles clicks on the "重新开始" button.
   *
   * Invokes the registered restart callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onRestartButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onRestart) {
      this._onRestart();
    }
  }

  /**
   * Handles clicks on the "返回主菜单" button.
   *
   * Invokes the registered main menu callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onMainMenuButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onMainMenu) {
      this._onMainMenu();
    }
  }
}