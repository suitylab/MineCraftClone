/**
 * AboutScreen.ts — About screen for the Minecraft Clone Phase 7.
 *
 * This class creates and manages the fullscreen about overlay that appears
 * when the user clicks "关于" (About) on the main menu. It displays:
 *
 * - **Title**: "关于" centered with a pixel-style font and text-shadow
 *   glow effect.
 * - **Info Panel**: A styled card showing project information:
 *   - Project name: "我的世界复刻版"
 *   - Tech stack: "TypeScript + Vite + THREE.js + Voxel"
 *   - Version: "v1.0.0"
 *   - Copyright: "© 2025 我的世界复刻版 项目组"
 * - **Back Button**: A "返回" (Back) button positioned at the bottom of the
 *   container that returns the user to the main menu.
 * - **Background**: A semi-transparent dark overlay (rgba(0,0,0,0.7)) that
 *   dims the menu background scene behind, making it visible but clearly
 *   in the background.
 *
 * The overlay is a DOM element positioned with `position: fixed` and a high
 * z-index (3000) so it renders above the WebGL canvas, crosshair (1000),
 * and hotbar (2000).
 *
 * ## Design Decisions
 *
 * - **Decoupled from game logic**: The AboutScreen class has no imports
 *   from game modules. It communicates with the Game class exclusively
 *   through the `setOnBack()` callback setter. This keeps the UI layer
 *   clean and testable.
 * - **CSS class-based styling**: All visual styling is defined in
 *   `src/style.css` using the classes `menu-screen`, `menu-title`,
 *   `about-panel`, `about-item`, `about-label`, `about-value`,
 *   `menu-button`, and `back-button`. The class only manages DOM structure
 *   and event handling, not visual appearance.
 * - **Dynamic info items**: The project information is defined as a static
 *   array of `[label, value]` tuples. The info rows are built dynamically
 *   from this array, making it easy to add, remove, or reorder information
 *   without modifying the DOM construction logic.
 * - **Safe callback invocation**: The back callback is optional (nullable).
 *   The click handler checks for null before invoking, preventing errors
 *   if the Game class hasn't wired up the callback yet.
 * - **Clean lifecycle**: The `dispose()` method removes the click listener
 *   and DOM elements, preventing memory leaks when the game is restarted
 *   or torn down.
 */
export class AboutScreen {
  /**
   * The project information displayed in the about panel.
   *
   * Each entry is a `[label, value]` tuple. The label column shows the
   * field name (e.g., "项目名称"), and the value column shows the
   * corresponding value (e.g., "我的世界复刻版"). This array is the
   * single source of truth for the about content — adding or removing
   * entries here automatically updates the displayed panel.
   */
  public static readonly ABOUT_ITEMS: ReadonlyArray<readonly [string, string]> = [
    ['项目名称', '我的世界复刻版'],
    ['技术栈', 'TypeScript + Vite + THREE.js + Voxel'],
    ['版本号', 'v1.0.0'],
    ['版权信息', '© 2025 我的世界复刻版 项目组'],
  ];

  /** The root overlay container element. */
  public container: HTMLDivElement;

  /** The title element displaying "关于". */
  public titleElement: HTMLHeadingElement;

  /** The info panel container holding the about items. */
  public panelElement: HTMLDivElement;

  /** The "返回" (Back) button element. */
  public backButton: HTMLButtonElement;

  /** Callback invoked when the "返回" button is clicked. */
  private _onBack: (() => void) | null;

  /** Bound click handler for the back button — stored for removal in dispose(). */
  private readonly _handleBackClick: (event: MouseEvent) => void;

  /**
   * Creates the about screen overlay and appends it to the document body.
   *
   * The constructor:
   * 1. Creates the root container div with id `about-screen` and classes
   *    `menu-screen about-screen`.
   * 2. Creates the title element with the about title text.
   * 3. Creates the info panel container.
   * 4. Builds the about items dynamically from the ABOUT_ITEMS array.
   * 5. Creates the back button with the "返回" text.
   * 6. Appends elements in the correct DOM hierarchy order.
   * 7. Binds the click event listener to the back button.
   * 8. Sets the initial visibility to hidden (the Game class calls
   *    `show()` when the game enters the ABOUT state).
   */
  constructor() {
    // Initialize callback reference to null.
    this._onBack = null;

    // --- Root Container ---
    // Create the fullscreen overlay container.
    // The `about-screen` class provides the darker background and
    // layout styling that distinguishes it from the main menu.
    this.container = document.createElement('div');
    this.container.className = 'menu-screen about-screen';
    this.container.id = 'about-screen';

    // --- Title Element ---
    // Create the about title heading.
    this.titleElement = document.createElement('h1');
    this.titleElement.className = 'menu-title';
    this.titleElement.textContent = '关于';

    // --- Info Panel ---
    // Create the panel container that holds the about items.
    // The `about-panel` class provides the card styling (semi-transparent
    // dark background, border, rounded corners, and padding).
    this.panelElement = document.createElement('div');
    this.panelElement.className = 'about-panel';

    // Build the about item rows dynamically from the ABOUT_ITEMS array.
    this._buildAboutItems();

    // --- Back Button ---
    // Create the back button positioned at the bottom of the container.
    this.backButton = document.createElement('button');
    this.backButton.className = 'menu-button back-button';
    this.backButton.textContent = '返回';
    this.backButton.type = 'button';

    // --- DOM Assembly ---
    // Append title, panel, and back button to the root container.
    this.container.appendChild(this.titleElement);
    this.container.appendChild(this.panelElement);
    this.container.appendChild(this.backButton);

    // Append the root container to the document body.
    document.body.appendChild(this.container);

    // --- Event Listener Binding ---
    // Store the bound handler as an arrow function so it can be removed
    // in dispose() without losing the `this` context.
    this._handleBackClick = (event: MouseEvent) => this._onBackButtonClick(event);

    // Bind the click listener to the back button.
    this.backButton.addEventListener('click', this._handleBackClick);

    // --- Initial Visibility ---
    // Start hidden — the Game class calls show() when entering ABOUT state.
    this.hide();
  }

  /**
   * Builds the about item rows from the ABOUT_ITEMS array.
   *
   * Each info entry is rendered as a row with two cells:
   * - The label (e.g., "项目名称") in the `about-label` cell, styled
   *   with a muted color on the left side.
   * - The value (e.g., "我的世界复刻版") in the `about-value` cell,
   *   styled with a bright color on the right side.
   *
   * The rows are appended to `this.panelElement`.
   */
  private _buildAboutItems(): void {
    // Iterate over the info entries and create a row for each.
    for (const [label, value] of AboutScreen.ABOUT_ITEMS) {
      // Create the row element.
      const row = document.createElement('div');
      row.className = 'about-item';

      // Create the label element.
      const labelElement = document.createElement('span');
      labelElement.className = 'about-label';
      labelElement.textContent = label;

      // Create the value element.
      const valueElement = document.createElement('span');
      valueElement.className = 'about-value';
      valueElement.textContent = value;

      // Append the label and value to the row.
      row.appendChild(labelElement);
      row.appendChild(valueElement);

      // Append the row to the panel.
      this.panelElement.appendChild(row);
    }
  }

  /**
   * Sets the callback invoked when the "返回" button is clicked.
   *
   * @param callback - The function to invoke, or null to clear.
   */
  public setOnBack(callback: () => void): void {
    this._onBack = callback;
  }

  /**
   * Shows the about screen overlay.
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
   * Hides the about screen overlay.
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
   * Checks whether the about screen is currently visible.
   *
   * @returns True if the overlay is visible, false otherwise.
   */
  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Removes all event listeners and cleans up the about screen DOM.
   *
   * This method:
   * 1. Removes the click listener from the back button.
   * 2. Removes the root container from the DOM.
   * 3. Clears the callback reference.
   *
   * Call this when the game is being torn down to prevent memory leaks
   * and orphaned event listeners.
   */
  public dispose(): void {
    // Remove the click listener from the back button.
    this.backButton.removeEventListener('click', this._handleBackClick);

    // Remove the container from the DOM if it's still attached.
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    // Clear the callback reference.
    this._onBack = null;
  }

  /**
   * Handles clicks on the "返回" button.
   *
   * Invokes the registered back callback, if set.
   *
   * @param event - The mouse click event.
   */
  private _onBackButtonClick(event: MouseEvent): void {
    // Prevent the event from bubbling to the container.
    event.stopPropagation();

    // Invoke the callback if it has been set.
    if (this._onBack) {
      this._onBack();
    }
  }
}