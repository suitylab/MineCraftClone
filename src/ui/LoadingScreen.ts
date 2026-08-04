/**
 * LoadingScreen.ts — Loading screen overlay for the Minecraft Clone Phase 7.
 *
 * This class creates and manages the fullscreen loading overlay that appears
 * while the world is being generated. It displays:
 *
 * - **Title**: "正在生成世界..." centered with a pixel-style font and
 *   text-shadow glow effect.
 * - **Progress Bar**: A horizontal bar with a fill element that animates
 *   smoothly from 0% to 100% using a CSS width transition.
 * - **Percentage Label**: A text label showing the current progress as a
 *   percentage (e.g., "45%").
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
 * - **Decoupled from game logic**: The LoadingScreen class has no imports
 *   from game modules. It communicates with the Game class exclusively
 *   through the `setProgress()` method, which takes a normalized value
 *   in [0, 1]. This keeps the UI layer clean and testable.
 * - **CSS class-based styling**: All visual styling is defined in
 *   `src/style.css` using the classes `loading-screen`, `loading-title`,
 *   `loading-bar-container`, `loading-bar-fill`, and `loading-percentage`.
 *   The class only manages DOM structure and progress updates, not visual
 *   appearance.
 * - **Smooth progress animation**: The progress bar fill element uses a
 *   CSS transition on `width` (0.2s ease), providing smooth visual feedback
 *   as progress updates arrive. The percentage text updates instantly for
 *   precise numerical feedback.
 * - **Input validation**: The `setProgress()` method clamps input to [0, 1]
 *   and guards against NaN values, ensuring the UI never displays invalid
 *   progress states.
 * - **Clean lifecycle**: The `dispose()` method removes the container from
 *   the DOM, preventing memory leaks when the game is restarted or torn down.
 *   No event listeners are bound, so no listener cleanup is required.
 */
export class LoadingScreen {
  /** The root overlay container element. */
  public container: HTMLDivElement;

  /** The title element displaying "正在生成世界...". */
  public titleElement: HTMLHeadingElement;

  /** The container holding the progress bar. */
  public barContainer: HTMLDivElement;

  /** The fill element whose width represents the current progress. */
  public barFill: HTMLDivElement;

  /** The percentage label showing the current progress as text. */
  public percentageLabel: HTMLDivElement;

  /**
   * Creates the loading screen overlay and appends it to the document body.
   *
   * The constructor:
   * 1. Creates the root container div with id `loading-screen` and class
   *    `loading-screen`.
   * 2. Creates the title element with the loading text.
   * 3. Creates the progress bar container, fill element, and percentage label.
   * 4. Appends elements in the correct DOM hierarchy order.
   * 5. Appends the root container to the document body.
   * 6. Sets the initial progress to 0% and hides the overlay.
   */
  constructor() {
    // --- Root Container ---
    // Create the fullscreen overlay container.
    // The id `loading-screen` allows external code (e.g., CSS or tests)
    // to locate this element reliably.
    this.container = document.createElement('div');
    this.container.className = 'loading-screen';
    this.container.id = 'loading-screen';

    // --- Title Element ---
    // Create the loading title heading.
    this.titleElement = document.createElement('h1');
    this.titleElement.className = 'loading-title';
    this.titleElement.textContent = '正在生成世界...';

    // --- Progress Bar Container ---
    // Create the container that holds the progress bar fill element.
    // This provides the track/background for the bar.
    this.barContainer = document.createElement('div');
    this.barContainer.className = 'loading-bar-container';

    // --- Progress Bar Fill ---
    // Create the fill element whose width represents the current progress.
    // The width is set as a percentage via setProgress().
    this.barFill = document.createElement('div');
    this.barFill.className = 'loading-bar-fill';
    this.barFill.style.width = '0%';

    // Append the fill element to the bar container.
    this.barContainer.appendChild(this.barFill);

    // --- Percentage Label ---
    // Create the label showing the current progress as text.
    this.percentageLabel = document.createElement('div');
    this.percentageLabel.className = 'loading-percentage';
    this.percentageLabel.textContent = '0%';

    // --- DOM Assembly ---
    // Append title, bar container, and percentage label to the root container.
    this.container.appendChild(this.titleElement);
    this.container.appendChild(this.barContainer);
    this.container.appendChild(this.percentageLabel);

    // Append the root container to the document body.
    document.body.appendChild(this.container);

    // --- Initial State ---
    // Set the initial progress to 0%.
    this.setProgress(0);

    // Start hidden — the Game class calls show() when entering LOADING state.
    this.hide();
  }

  /**
   * Updates the progress bar and percentage label.
   *
   * The progress value is clamped to [0, 1] to handle out-of-range inputs.
   * The bar fill width is set as a percentage string (e.g., "45%"), and
   * the percentage label text is updated to match (e.g., "45%").
   *
   * The bar fill uses a CSS transition on `width` (0.2s ease) for smooth
   * visual feedback. The percentage text updates instantly.
   *
   * @param progress - The progress value in [0, 1]. Values outside this
   *                   range are clamped. NaN values are treated as 0.
   */
  public setProgress(progress: number): void {
    // Guard against NaN — treat as 0 to prevent invalid UI states.
    if (!Number.isFinite(progress)) {
      progress = 0;
    }

    // Clamp the progress value to [0, 1].
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Calculate the percentage as an integer (0-100).
    const percentage = Math.round(clampedProgress * 100);

    // Update the bar fill width as a percentage string.
    this.barFill.style.width = `${percentage}%`;

    // Update the percentage label text.
    this.percentageLabel.textContent = `${percentage}%`;
  }

  /**
   * Shows the loading screen overlay.
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
   * Hides the loading screen overlay.
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
   * Checks whether the loading screen is currently visible.
   *
   * @returns True if the overlay is visible, false otherwise.
   */
  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Removes the loading screen from the DOM.
   *
   * This method removes the root container from the document body.
   * No event listeners are bound by this class, so no listener
   * cleanup is required.
   *
   * Call this when the game is being torn down to prevent orphaned
   * DOM elements and memory leaks.
   */
  public dispose(): void {
    // Remove the container from the DOM if it's still attached.
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}