/**
 * MainMenu.ts — Main menu screen for the Minecraft Clone Phase 7.
 *
 * This class creates and manages the fullscreen main menu overlay that
 * appears when the game starts. It displays:
 *
 * - **Title**: "我的世界复刻版" centered with a pixel-style font and
 *   text-shadow glow effect.
 * - **Buttons**: Three vertically arranged buttons — "开始游戏" (Start Game),
 *   "操作说明" (Controls), and "关于" (About).
 * - **Background**: A subtle dark gradient overlay (rgba(0,0,0,0.6) to
 *   rgba(0,0,0,0.3)) that lets the Three.js rotating block scene behind
 *   show through.
 *
 * The menu is a DOM overlay positioned with `position: fixed` and a high
 * z-index (3000) so it renders above the WebGL canvas, crosshair (1000),
 * and hotbar (2000).
 *
 * ## Design Decisions
 *
 * - **Decoupled from game logic**: The MainMenu class has no imports from
 *   game modules. It communicates with the Game class exclusively through
 *   callback setters (`onStartGame`, `onControls`, `onAbout`). This keeps
 *   the UI layer clean and testable.
 * - **CSS class-based styling**: All visual styling is defined in
 *   `src/style.css` using the classes `menu-screen`, `menu-title`,
 *   `menu-button`, etc. The class only manages DOM structure and event
 *   handling, not visual appearance.
 * - **Safe callback invocation**: All callbacks are optional (nullable).
 *   The click handlers check for null before invoking, preventing errors
 *   if the Game class hasn't wired up the callbacks yet.
 * - **Clean lifecycle**: The `dispose()` method removes all event
 *   listeners and DOM elements, preventing memory leaks when the game
 *   is restarted or torn down.
 */
export class MainMenu {
  /** The root overlay container element. */
  public container: HTMLDivElement;

  /** The title element displaying "我的世界复刻版". */
  public titleElement: HTMLHeadingElement;

  /** The container holding the three menu buttons. */
  public buttonsContainer: HTMLDivElement;

  /** The "开始游戏" (Start Game) button element. */
  public startButton: HTMLButtonElement;

  /** The "操作说明" (Controls) button element. */
  public controlsButton: HTMLButtonElement;

  /** The "关于" (About) button element. */
  public aboutButton: HTMLButtonElement;

  /** Callback invoked when the "开始游戏" button is clicked. */
  private _onStartGame: (() => void) | null;

  /** Callback invoked when the "操作说明" button is clicked. */
  private _onControls: (() => void) | null;

  /** Callback invoked when the "关于" button is clicked. */
  private _onAbout: (() => void) | null;

  /** Bound click handler for the start button — stored for removal in dispose(). */
  private readonly _handleStartClick: (event: MouseEvent) => void;

  /** Bound click handler for the controls button — stored for removal in dispose(). */
  private readonly _handleControlsClick: (event: MouseEvent) => void;

  /** Bound click handler for the about button — stored for removal in dispose(). */
  private readonly _handleAboutClick: (event: MouseEvent) => void;

  /**
   * Creates the main menu overlay and appends it to the document body.
   *
   * The constructor:
   * 1. Creates the root container div with class `menu-screen`.
   * 2. Creates the title element with the game title text.
   * 3. Creates the buttons container and three button elements.
   * 4. Appends elements in the correct DOM order.
   * 5. Binds click event listeners to the buttons.
   * 6. Sets the initial visibility to hidden (the Game class calls
   *    `show()` when the game enters the MENU state).
   */
  constructor() {
    // Initialize callback references to null.
    this._onStartGame = null;
    this._onControls = null;
    this._onAbout = null;

    // --- Root Container ---
    // Create the fullscreen overlay container.
    this.container = document.createElement('div');
    this.container.className = 'menu-screen';
    this.container.id = 'main-menu';

    // --- Title Element ---
    // Create the game title heading.
    this.titleElement = document.createElement('h1');
    this.titleElement.className = 'menu-title';
    this.titleElement.textContent = '我的世界复刻版';

    // --- Buttons Container ---
    // Create the container that holds the three buttons vertically.
    this.buttonsContainer = document.createElement('div');
    this.buttonsContainer.className = 'menu-buttons';

    // --- Start Game Button ---
    this.startButton = document.createElement('button');
    this.startButton.className = 'menu-button';
    this.startButton.textContent = '开始游戏';
    this.startButton.type = 'button';

    // --- Controls Button ---
    this.controlsButton = document.createElement('button');
    this.controlsButton.className = 'menu-button';
    this.controlsButton.textContent = '操作说明';
    this.controlsButton.type = 'button';

    // --- About Button ---
    this.aboutButton = document.createElement('button');
    this.aboutButton.className = 'menu-button';
    this.aboutButton.textContent = '关于';
    this.aboutButton.type = 'button';

    // --- DOM Assembly ---
    // Append buttons to the buttons container.
    this.buttonsContainer.appendChild(this.startButton);
    this.buttonsContainer.appendChild(this.controlsButton);
    this.buttonsContainer.appendChild(this.aboutButton);

    // Append title and buttons container to the root container.
    this.container.appendChild(this.titleElement);
    this.container.appendChild(this.buttonsContainer);

    // Append the root container to the document body.
    document.body.appendChild(this.container);

    // --- Event Listener Binding ---
    // Store bound handlers as arrow functions so they can be removed
    // in dispose() without losing the `this` context.
    this._handleStartClick = (event: MouseEvent) => this._onStartButtonClick(event);
    this._handleControlsClick = (event: MouseEvent) => this._onControlsButtonClick(event);
    this._handleAboutClick = (event: MouseEvent) => this._onAboutButtonClick(event);

    // Bind click listeners to the buttons.
    this.startButton.addEventListener('click', this._handleStartClick);
    this.controlsButton.addEventListener('click', this._handleControlsClick);
    this.aboutButton.addEventListener('click', this._handleAboutClick);

    // --- Initial Visibility ---
    // Start hidden — the Game class calls show() when entering MENU state.
    this.hide();
  }

  /**
   * Sets the callback invoked when the "开始游戏" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnStartGame(callback: () => void): void {
    this._onStartGame = callback;
  }

  /**
   * Sets the callback invoked when the "操作说明" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnControls(callback: () => void): void {
    this._onControls = callback;
  }

  /**
   * Sets the callback invoked when the "关于" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnAbout(callback: () => void): void {
    this._onAbout = callback;
  }

  /**
   * Shows the main menu overlay.
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
   * Hides the main menu overlay.
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
   * Checks whether the main menu is currently visible.
   *
   * @returns True if the overlay is visible, false otherwise.
   */
  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Removes all event listeners and cleans up the main menu DOM.
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
    this.startButton.removeEventListener('click', this._handleStartClick);
    this.controlsButton.removeEventListener('click', this._handleControlsClick);
    this.aboutButton.removeEventListener('click', this._handleAboutClick);

    // Remove the container from the DOM if it's still attached.
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    // Clear callback references.
    this._onStartGame = null;
    this._onControls = null;
    this._onAbout = null;
  }

  /**
   * Handles clicks on the "开始游戏" button.
   *
   * Invokes the registered start game callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onStartButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onStartGame) {
      this._onStartGame();
    }
  }

  /**
   * Handles clicks on the "操作说明" button.
   *
   * Invokes the registered controls callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onControlsButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onControls) {
      this._onControls();
    }
  }

  /**
   * Handles clicks on the "关于" button.
   *
   * Invokes the registered about callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onAboutButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onAbout) {
      this._onAbout();
    }
  }
}