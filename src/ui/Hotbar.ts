/**
 * Hotbar.ts — 9-slot quick-select hotbar UI for the Minecraft Clone.
 *
 * This class creates and manages the bottom-center hotbar that allows the
 * player to select which block type to place. It provides:
 *
 * - **Visual slots**: 9 slots, each displaying the procedural texture of
 *   its corresponding block type as a crisp pixel-art icon.
 * - **Keyboard selection**: Number keys 1-9 (both main row and numpad)
 *   switch the selected slot.
 * - **Mouse wheel cycling**: Scrolling the wheel over the hotbar cycles
 *   through slots in both directions.
 * - **Programmatic selection**: The `setSelectedSlot()` method allows
 *   external code to change the selection.
 * - **Block type access**: `getSelectedBlockType()` returns the currently
 *   selected block type for placement logic.
 *
 * The hotbar is styled via CSS classes (`hotbar`, `hotbar-slot`, `selected`)
 * defined in `src/style.css`. The class does not hardcode any dimensions,
 * allowing the CSS to handle responsive scaling on narrow windows.
 *
 * ## Design Decisions
 *
 * - **Procedural textures**: Each slot's icon is generated at runtime using
 *   `TextureGenerator.getBlockTexture()`, converted to a data URL via
 *   `canvas.toDataURL()`. This ensures zero external asset dependencies.
 * - **Graceful fallbacks**: If texture generation fails (missing canvas
 *   context, null texture), the slot falls back to a solid color derived
 *   from the block type. This prevents broken UI in edge cases.
 * - **Event listener cleanup**: All event listeners are stored as bound
 *   arrow functions and removed in `dispose()`, preventing memory leaks
 *   when the game is torn down or restarted.
 * - **Modifier key safety**: Number key shortcuts are ignored when Ctrl,
 *   Alt, or Meta is pressed, preventing conflicts with browser shortcuts.
 */
import { BlockType } from '../world/World';
import { TextureGenerator } from '../textures/TextureGenerator';

/**
 * Hotbar — Manages the 9-slot quick-select bar.
 *
 * The hotbar is a DOM overlay rendered above the WebGL canvas. It displays
 * one slot per block type in the `BLOCK_TYPES` array, with the currently
 * selected slot highlighted by the `selected` CSS class.
 */
export class Hotbar {
  /**
   * The ordered list of block types shown in the hotbar.
   *
   * This order matches the design doc: grass, dirt, stone, sand, wood,
   * leaves, water, bedrock, glass. Index 0 corresponds to key 1, index 8
   * to key 9.
   */
  public static readonly BLOCK_TYPES: BlockType[] = [
    BlockType.GRASS,
    BlockType.DIRT,
    BlockType.STONE,
    BlockType.SAND,
    BlockType.WOOD,
    BlockType.LEAVES,
    BlockType.WATER,
    BlockType.BEDROCK,
    BlockType.GLASS,
  ];

  /** The root hotbar container element. */
  public container: HTMLDivElement;

  /** Array of the 9 slot elements, in display order. */
  public slots: HTMLDivElement[];

  /** Index of the currently selected slot (0-8). */
  public selectedIndex: number;

  /** Bound keydown handler — stored for removal in dispose(). */
  private readonly _handleKeyDown: (event: KeyboardEvent) => void;

  /** Bound wheel handler — stored for removal in dispose(). */
  private readonly _handleWheel: (event: WheelEvent) => void;

  /**
   * Creates the hotbar UI and appends it to the document body.
   *
   * The constructor:
   * 1. Finds or creates the `#hotbar` container element.
   * 2. Generates the 9 slot elements with procedural texture icons.
   * 3. Sets the initial selection to slot 0 (GRASS).
   * 4. Binds keyboard and wheel event listeners.
   *
   * If a `#hotbar` element already exists in the DOM (e.g., pre-defined
   * in index.html), it is reused and populated. Otherwise, a new container
   * is created and appended to `document.body`.
   */
  constructor() {
    // --- Container Setup ---
    // Reuse an existing #hotbar element if present, otherwise create one.
    const existing = document.getElementById('hotbar');
    if (existing && existing instanceof HTMLDivElement) {
      this.container = existing;
      // Clear any existing children to avoid duplicates on re-initialization.
      this.container.innerHTML = '';
    } else {
      this.container = document.createElement('div');
      this.container.id = 'hotbar';
      document.body.appendChild(this.container);
    }

    // --- Slot Generation ---
    this.slots = [];
    this.selectedIndex = 0;

    // Generate one slot per block type in the BLOCK_TYPES array.
    for (let i = 0; i < Hotbar.BLOCK_TYPES.length; i++) {
      const slot = this._createSlot(Hotbar.BLOCK_TYPES[i], i);
      this.container.appendChild(slot);
      this.slots.push(slot);
    }

    // Apply the initial selection highlight to slot 0.
    this.slots[0].classList.add('selected');

    // --- Event Listener Binding ---
    // Store bound handlers as arrow functions so they can be removed
    // in dispose() without losing the `this` context.
    this._handleKeyDown = (event: KeyboardEvent) => this._onKeyDown(event);
    this._handleWheel = (event: WheelEvent) => this._onWheel(event);

    // Keydown is global — the player can press 1-9 regardless of focus.
    document.addEventListener('keydown', this._handleKeyDown);

    // Wheel is scoped to the hotbar container to avoid hijacking
    // page scrolling or other wheel interactions.
    this.container.addEventListener('wheel', this._handleWheel, { passive: true });
  }

  /**
   * Creates a single hotbar slot element with the block's texture icon.
   *
   * @param type - The BlockType this slot represents.
   * @param index - The slot index (0-8), used for the data-label attribute.
   * @returns A configured HTMLDivElement ready to be appended to the container.
   */
  private _createSlot(type: BlockType, index: number): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot';

    // Store the block type and index as data attributes for debugging
    // and potential future styling hooks.
    slot.dataset.blockType = String(type);
    slot.dataset.index = String(index);

    // Set the tooltip label to the block type name.
    slot.title = BlockType[type];

    // Attempt to generate the procedural texture for this block type.
    // If generation fails, fall back to a solid color background.
    try {
      const texture = TextureGenerator.getBlockTexture(type);
      if (texture) {
        // Convert the canvas texture to a data URL for use as a CSS background.
        // The texture's image is a canvas element, so we can call toDataURL.
        const canvas = texture.image as HTMLCanvasElement;
        if (canvas && typeof canvas.toDataURL === 'function') {
          const dataUrl = canvas.toDataURL();
          slot.style.backgroundImage = `url(${dataUrl})`;
          slot.style.backgroundSize = 'cover';
          slot.style.imageRendering = 'pixelated';
        } else {
          // Texture exists but has no canvas image — fall back to solid color.
          slot.style.backgroundColor = this._getFallbackColor(type);
        }
      } else {
        // No texture available for this block type — fall back to solid color.
        slot.style.backgroundColor = this._getFallbackColor(type);
      }
        } catch {
      // Texture generation threw an error — fall back to solid color.
      slot.style.backgroundColor = this._getFallbackColor(type);
    }

    return slot;
  }

  /**
   * Returns a fallback CSS color for a block type when texture generation fails.
   *
   * The colors are approximate representations of each block's visual
   * appearance, used only as a safety net so the hotbar remains usable
   * even if canvas texture generation is unavailable.
   *
   * @param type - The BlockType to get a fallback color for.
   * @returns A CSS color string.
   */
  private _getFallbackColor(type: BlockType): string {
    switch (type) {
      case BlockType.GRASS:
        return '#5d9c3a';
      case BlockType.DIRT:
        return '#8b5e3c';
      case BlockType.STONE:
        return '#808080';
      case BlockType.SAND:
        return '#e8d8a0';
      case BlockType.WOOD:
        return '#6b4226';
      case BlockType.LEAVES:
        return '#2d6b1e';
      case BlockType.WATER:
        return '#3a6fd8';
      case BlockType.BEDROCK:
        return '#3e3e3e';
      case BlockType.GLASS:
        return '#c8e8f0';
      default:
        return '#888888';
    }
  }

  /**
   * Handles number key presses (1-9) to switch the selected slot.
   *
   * Supports both the main number row (Digit1-Digit9) and the numpad
   * (Numpad1-Numpad9). Ignores key presses with Ctrl, Alt, or Meta
   * modifiers to avoid conflicting with browser shortcuts.
   *
   * @param event - The keyboard event.
   */
  private _onKeyDown(event: KeyboardEvent): void {
    // Ignore modified key presses (Ctrl/Cmd/Alt) to avoid conflicts
    // with browser shortcuts like Ctrl+1 (tab switching).
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    // Extract the digit from the event code.
    // Supports both Digit1-Digit9 and Numpad1-Numpad9.
    let digit: number | null = null;

    if (event.code.startsWith('Digit')) {
      digit = parseInt(event.code.slice(5), 10);
    } else if (event.code.startsWith('Numpad')) {
      digit = parseInt(event.code.slice(6), 10);
    }

    // Only handle digits 1-9 (ignore 0 and non-digit keys).
    if (digit !== null && digit >= 1 && digit <= 9) {
      this.setSelectedSlot(digit - 1);
    }
  }

  /**
   * Handles mouse wheel events over the hotbar to cycle slots.
   *
   * Scrolling up (negative deltaY) selects the previous slot; scrolling
   * down (positive deltaY) selects the next slot. The selection wraps
   * around at both ends.
   *
   * @param event - The wheel event.
   */
  private _onWheel(event: WheelEvent): void {
    // Normalize the wheel delta — some browsers/mice produce large
    // deltas, so we only advance by one slot per event.
    if (event.deltaY > 0) {
      // Scroll down → next slot.
      this.setSelectedSlot((this.selectedIndex + 1) % Hotbar.BLOCK_TYPES.length);
    } else if (event.deltaY < 0) {
      // Scroll up → previous slot (with wrap-around).
      this.setSelectedSlot(
        (this.selectedIndex - 1 + Hotbar.BLOCK_TYPES.length) % Hotbar.BLOCK_TYPES.length
      );
    }
    // deltaY === 0 (horizontal scroll) is ignored.
  }

  /**
   * Returns the block type of the currently selected slot.
   *
   * @returns The BlockType of the selected slot.
   */
  public getSelectedBlockType(): BlockType {
    return Hotbar.BLOCK_TYPES[this.selectedIndex];
  }

  /**
   * Programmatically selects a slot by index.
   *
   * The index is clamped to the valid range [0, 8]. If the index is
   * already selected, no changes are made. The `selected` CSS class is
   * moved from the previously selected slot to the newly selected one.
   *
   * @param index - The slot index to select (0-8).
   */
  public setSelectedSlot(index: number): void {
    // Clamp the index to the valid range.
    const clampedIndex = Math.max(0, Math.min(Hotbar.BLOCK_TYPES.length - 1, index));

    // No-op if the slot is already selected.
    if (clampedIndex === this.selectedIndex) {
      return;
    }

    // Remove the highlight from the previously selected slot.
    this.slots[this.selectedIndex].classList.remove('selected');

    // Update the selection state.
    this.selectedIndex = clampedIndex;

    // Apply the highlight to the newly selected slot.
    this.slots[this.selectedIndex].classList.add('selected');
  }

  /**
   * Removes all event listeners and cleans up the hotbar DOM.
   *
   * This method:
   * 1. Removes the keydown listener from the document.
   * 2. Removes the wheel listener from the container.
   * 3. Removes the hotbar container from the DOM.
   * 4. Clears the slots array.
   *
   * Call this when the game is being torn down or restarted to prevent
   * memory leaks and orphaned event listeners.
   */
  public dispose(): void {
    // Remove event listeners.
    document.removeEventListener('keydown', this._handleKeyDown);
    this.container.removeEventListener('wheel', this._handleWheel);

    // Remove the container from the DOM if it's still attached.
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    // Clear the slots array to release references.
    this.slots = [];
  }
}