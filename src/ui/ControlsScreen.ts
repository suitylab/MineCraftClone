/**
 * ControlsScreen.ts — Controls/instructions screen for the Minecraft Clone Phase 7.
 *
 * This class creates and manages the fullscreen controls overlay that appears
 * when the user clicks "操作说明" (Controls) on the main menu. It displays:
 *
 * - **Title**: "操作说明" centered with a pixel-style font and text-shadow
 *   glow effect.
 * - **Control Table**: A two-column table showing key bindings and their
 *   functions, with alternating row backgrounds for readability.
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
 * - **Decoupled from game logic**: The ControlsScreen class has no imports
 *   from game modules. It communicates with the Game class exclusively
 *   through the `setOnBack()` callback setter. This keeps the UI layer
 *   clean and testable.
 * - **CSS class-based styling**: All visual styling is defined in
 *   `src/style.css` using the classes `menu-screen`, `menu-title`,
 *   `controls-table`, `controls-row`, `controls-key`, `controls-desc`,
 *   `menu-button`, and `back-button`. The class only manages DOM structure
 *   and event handling, not visual appearance.
 * - **Dynamic control list**: The control bindings are defined as a static
 *   array of `[key, description]` tuples. The table rows are built
 *   dynamically from this array, making it easy to add, remove, or reorder
 *   control bindings without modifying the DOM construction logic.
 * - **Safe callback invocation**: The back callback is optional (nullable).
 *   The click handler checks for null before invoking, preventing errors
 *   if the Game class hasn't wired up the callback yet.
 * - **Clean lifecycle**: The `dispose()` method removes the click listener
 *   and DOM elements, preventing memory leaks when the game is restarted
 *   or torn down.
 */
export class ControlsScreen {
  /**
   * The control bindings displayed in the table.
   *
   * Each entry is a `[key, description]` tuple. The key column shows the
   * keyboard/mouse binding, and the description column explains its function.
   * This array is the single source of truth for the control list — adding
   * or removing entries here automatically updates the displayed table.
   */
  public static readonly CONTROL_ITEMS: ReadonlyArray<readonly [string, string]> = [
    ['WASD', '移动'],
    ['空格', '跳跃'],
    ['鼠标', '视角'],
    ['左键', '破坏方块'],
    ['右键', '放置方块'],
    ['1-9', '选择快捷栏'],
    ['ESC', '暂停'],
  ];

  /** The root overlay container element. */
  public container: HTMLDivElement;

  /** The title element displaying "操作说明". */
  public titleElement: HTMLHeadingElement;

  /** The table element containing the control bindings. */
  public tableElement: HTMLTableElement;

  /** The table body element containing the control rows. */
  public tableBody: HTMLTableSectionElement;

  /** The "返回" (Back) button element. */
  public backButton: HTMLButtonElement;

  /** Callback invoked when the "返回" button is clicked. */
  private _onBack: (() => void) | null;

  /** Bound click handler for the back button — stored for removal in dispose(). */
  private readonly _handleBackClick: (event: MouseEvent) => void;

  /**
   * Creates the controls screen overlay and appends it to the document body.
   *
   * The constructor:
   * 1. Creates the root container div with id `controls-screen` and classes
   *    `menu-screen controls-screen`.
   * 2. Creates the title element with the controls title text.
   * 3. Creates the table element with a header row (按键/功能).
   * 4. Builds the control rows dynamically from the CONTROL_ITEMS array.
   * 5. Creates the back button with the "返回" text.
   * 6. Appends elements in the correct DOM hierarchy order.
   * 7. Binds the click event listener to the back button.
   * 8. Sets the initial visibility to hidden (the Game class calls
   *    `show()` when the game enters the CONTROLS state).
   */
  constructor() {
    // Initialize callback reference to null.
    this._onBack = null;

    // --- Root Container ---
    // Create the fullscreen overlay container.
    // The `controls-screen` class provides the darker background and
    // layout styling that distinguishes it from the main menu.
    this.container = document.createElement('div');
    this.container.className = 'menu-screen controls-screen';
    this.container.id = 'controls-screen';

    // --- Title Element ---
    // Create the controls title heading.
    this.titleElement = document.createElement('h1');
    this.titleElement.className = 'menu-title';
    this.titleElement.textContent = '操作说明';

    // --- Table Element ---
    // Create the table that holds the control bindings.
    this.tableElement = document.createElement('table');
    this.tableElement.className = 'controls-table';

    // Create the table header with two columns: 按键 (Key) and 功能 (Function).
    const tableHead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'controls-row controls-header';

    const keyHeader = document.createElement('th');
    keyHeader.className = 'controls-key';
    keyHeader.textContent = '按键';

    const descHeader = document.createElement('th');
    descHeader.className = 'controls-desc';
    descHeader.textContent = '功能';

    headerRow.appendChild(keyHeader);
    headerRow.appendChild(descHeader);
    tableHead.appendChild(headerRow);
    this.tableElement.appendChild(tableHead);

    // Create the table body and populate it with control rows.
    this.tableBody = document.createElement('tbody');
    this._buildControlRows();
    this.tableElement.appendChild(this.tableBody);

    // --- Back Button ---
    // Create the back button positioned at the bottom of the container.
    this.backButton = document.createElement('button');
    this.backButton.className = 'menu-button back-button';
    this.backButton.textContent = '返回';
    this.backButton.type = 'button';

    // --- DOM Assembly ---
    // Append title, table, and back button to the root container.
    this.container.appendChild(this.titleElement);
    this.container.appendChild(this.tableElement);
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
    // Start hidden — the Game class calls show() when entering CONTROLS state.
    this.hide();
  }

  /**
   * Builds the table body rows from the CONTROL_ITEMS array.
   *
   * Each control binding is rendered as a table row with two cells:
   * - The key binding (e.g., "WASD") in the `controls-key` cell
   * - The function description (e.g., "移动") in the `controls-desc` cell
   *
   * The rows are appended to `this.tableBody`. Alternating row styling
   * is handled by CSS via the `controls-row` class.
   */
  private _buildControlRows(): void {
    // Iterate over the control bindings and create a row for each.
    for (const [key, description] of ControlsScreen.CONTROL_ITEMS) {
      // Create the row element.
      const row = document.createElement('tr');
      row.className = 'controls-row';

      // Create the key cell.
      const keyCell = document.createElement('td');
      keyCell.className = 'controls-key';
      keyCell.textContent = key;

      // Create the description cell.
      const descCell = document.createElement('td');
      descCell.className = 'controls-desc';
      descCell.textContent = description;

      // Append the cells to the row.
      row.appendChild(keyCell);
      row.appendChild(descCell);

      // Append the row to the table body.
      this.tableBody.appendChild(row);
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
   * Shows the controls screen overlay.
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
   * Hides the controls screen overlay.
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
   * Checks whether the controls screen is currently visible.
   *
   * @returns True if the overlay is visible, false otherwise.
   */
  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Removes all event listeners and cleans up the controls screen DOM.
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