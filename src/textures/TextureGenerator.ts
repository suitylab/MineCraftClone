/**
 * TextureGenerator.ts — Procedural texture generation for the Minecraft Clone Phase 8.
 *
 * All textures are generated at runtime using CanvasTexture — no external
 * image files are loaded. This keeps the project self-contained and allows
 * infinite variation through seeded noise.
 *
 * Textures are 16×16 pixels to match the voxel aesthetic, using NearestFilter
 * to preserve crisp pixel-art edges. Individual block textures use
 * RepeatWrapping for tiling, while the texture atlas uses ClampToEdgeWrapping
 * since it must not tile.
 *
 * ## Phase 8 Enhancements
 *
 * - **3 Variants per block type**: Each block type (GRASS_TOP, GRASS_SIDE,
 *   DIRT, STONE, SAND, WOOD, LEAVES, BEDROCK) gets 3 distinct variants
 *   (index 0, 1, 2). Variants differ in noise pattern, speckle placement,
 *   and detail features. The variant is selected deterministically from
 *   the block position hash, so adjacent blocks show visible variation.
 * - **Seeded PRNG (mulberry32)**: All texture generation uses a seeded
 *   random number generator for deterministic output. The seed is derived
 *   from the variant index, ensuring each variant is unique but stable.
 * - **Enhanced texture details**: Grass has blade-like streaks, stone has
 *   crack lines, wood has growth rings, sand has horizontal banding, etc.
 * - **12×2 texture atlas**: The atlas now contains 24 cells (8 texture
 *   types × 3 variants) for the ChunkMeshBuilder's merged geometry.
 */
import * as THREE from 'three';
import { BlockType } from '../world/World';

/** Base seed for variant texture generation. */
const BASE_SEED = 1337;

/** Number of variants per block type. */
const VARIANT_COUNT = 3;

/** Canvas size for individual block textures (16×16 pixels). */
const TEXTURE_SIZE = 16;

/** Atlas dimensions: 12 columns × 2 rows = 24 cells. */
const ATLAS_COLS = 12;
const ATLAS_ROWS = 2;

/** Atlas canvas dimensions: 192×32 pixels. */
const ATLAS_WIDTH = ATLAS_COLS * TEXTURE_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * TEXTURE_SIZE;

/** RGB color interface for color manipulation. */
interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Seeded random number generator function type. */
type RNG = () => number;

/**
 * TextureGenerator — Static utility class for procedural texture generation.
 *
 * All methods are static and self-contained. Each method creates a fresh
 * canvas and returns a configured THREE.CanvasTexture. The class has no
 * instance state and no dependencies beyond THREE.js and the BlockType enum.
 */
export class TextureGenerator {
  /**
   * Generates a specific variant texture for a block type.
   *
   * Each block type has 3 distinct variants (index 0-2) that differ in
   * noise pattern, speckle placement, and detail features. The variant
   * is generated deterministically using a seeded PRNG (mulberry32) with
   * seed = BASE_SEED + variantIndex * 1000.
   *
   * GRASS returns the SIDE texture (matching existing behavior) — the
   * dominant visual of a placed grass block is the brown side with a
   * green top edge, not the all-green top surface.
   *
   * @param type - The BlockType to generate a texture for.
   * @param variantIndex - The variant index (0-2). Clamped to valid range.
   * @returns A configured THREE.CanvasTexture ready for use as a material map.
   */
  public static generateVariantTexture(type: BlockType, variantIndex: number): THREE.CanvasTexture {
    // Clamp the variant index to the valid range [0, 2].
    const variant = Math.max(0, Math.min(VARIANT_COUNT - 1, variantIndex));

    // Create a seeded RNG for this variant.
    const rng = TextureGenerator.mulberry32(BASE_SEED + variant * 1000);

    // Generate the texture based on the block type.
    switch (type) {
      case BlockType.GRASS:
        return TextureGenerator._generateGrassSideTexture(rng);
      case BlockType.DIRT:
        return TextureGenerator._generateDirtTexture(rng);
      case BlockType.STONE:
        return TextureGenerator._generateStoneTexture(rng);
      case BlockType.SAND:
        return TextureGenerator._generateSandTexture(rng);
      case BlockType.WOOD:
        return TextureGenerator._generateWoodTexture(rng);
      case BlockType.LEAVES:
        return TextureGenerator._generateLeavesTexture(rng);
      case BlockType.BEDROCK:
        return TextureGenerator._generateBedrockTexture(rng);
      case BlockType.WATER:
        return TextureGenerator._generateWaterTexture(rng);
      case BlockType.GLASS:
        return TextureGenerator._generateGlassTexture(rng);
      case BlockType.AIR:
      default:
        // AIR has no texture — return a transparent texture as fallback.
        return TextureGenerator._generateEmptyTexture();
    }
  }

  /**
   * Generates the 12×2 texture atlas used by ChunkMeshBuilder.
   *
   * The atlas combines all opaque block textures into a single canvas for
   * efficient rendering with merged geometry. Each cell is 16×16 pixels,
   * and the atlas is 192×32 pixels total.
   *
   * Cell layout (column, row):
   * Row 0: GRASS_TOP_0, GRASS_TOP_1, GRASS_TOP_2, GRASS_SIDE_0, GRASS_SIDE_1,
   *        GRASS_SIDE_2, DIRT_0, DIRT_1, DIRT_2, STONE_0, STONE_1, STONE_2
   * Row 1: SAND_0, SAND_1, SAND_2, WOOD_0, WOOD_1, WOOD_2, LEAVES_0, LEAVES_1,
   *        LEAVES_2, BEDROCK_0, BEDROCK_1, BEDROCK_2
   *
   * The atlas uses ClampToEdgeWrapping since it must not tile — the UV
   * coordinates from ChunkMeshBuilder reference specific cells within the
   * atlas, and tiling would cause texture bleeding between cells.
   *
   * @returns A configured THREE.CanvasTexture containing the full texture atlas.
   */
  public static generateTextureAtlas(): THREE.CanvasTexture {
    // --- Canvas Setup ---
    // 192×32 pixels: 12 cells wide × 2 cells tall, each cell 16×16.
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for texture atlas');
    }

    // --- Row 0: GRASS_TOP_0, GRASS_TOP_1, GRASS_TOP_2, GRASS_SIDE_0, GRASS_SIDE_1,
    //            GRASS_SIDE_2, DIRT_0, DIRT_1, DIRT_2, STONE_0, STONE_1, STONE_2 ---
    for (let v = 0; v < VARIANT_COUNT; v++) {
      // GRASS_TOP variants (cols 0-2)
      const grassTopRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawGrassTopTexture(ctx, v * TEXTURE_SIZE, 0, grassTopRng);

      // GRASS_SIDE variants (cols 3-5)
      const grassSideRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawGrassSideTexture(ctx, (3 + v) * TEXTURE_SIZE, 0, grassSideRng);

      // DIRT variants (cols 6-8)
      const dirtRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawDirtTexture(ctx, (6 + v) * TEXTURE_SIZE, 0, dirtRng);

      // STONE variants (cols 9-11)
      const stoneRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawStoneTexture(ctx, (9 + v) * TEXTURE_SIZE, 0, stoneRng);
    }

    // --- Row 1: SAND_0, SAND_1, SAND_2, WOOD_0, WOOD_1, WOOD_2, LEAVES_0, LEAVES_1,
    //            LEAVES_2, BEDROCK_0, BEDROCK_1, BEDROCK_2 ---
    for (let v = 0; v < VARIANT_COUNT; v++) {
      // SAND variants (cols 0-2)
      const sandRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawSandTexture(ctx, v * TEXTURE_SIZE, TEXTURE_SIZE, sandRng);

      // WOOD variants (cols 3-5)
      const woodRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawWoodTexture(ctx, (3 + v) * TEXTURE_SIZE, TEXTURE_SIZE, woodRng);

      // LEAVES variants (cols 6-8)
      const leavesRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawLeavesTexture(ctx, (6 + v) * TEXTURE_SIZE, TEXTURE_SIZE, leavesRng);

      // BEDROCK variants (cols 9-11)
      const bedrockRng = TextureGenerator.mulberry32(BASE_SEED + v * 1000);
      TextureGenerator._drawBedrockTexture(ctx, (9 + v) * TEXTURE_SIZE, TEXTURE_SIZE, bedrockRng);
    }

    // --- Texture Creation ---
    const texture = new THREE.CanvasTexture(canvas);

    // NearestFilter preserves the pixel-art look.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    // ClampToEdgeWrapping — the atlas must NOT tile.
    // UV coordinates reference specific cells, and tiling would cause
    // texture bleeding between adjacent cells.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }

  /**
   * Returns the appropriate texture for the given block type.
   *
   * This method provides a single entry point for retrieving block textures,
   * used by hotbar icons and UI elements. It returns variant 0 for each
   * block type, which is the default appearance.
   *
   * @param type - The BlockType to get a texture for.
   * @returns A configured THREE.CanvasTexture for the block type,
   *          or null for AIR (which has no texture).
   *
   * Note: GRASS returns the SIDE view texture (brown with green top strip)
   * rather than the top view (all green). This ensures the hotbar icon
   * matches the dominant appearance of a placed grass block.
   */
  public static getBlockTexture(type: BlockType): THREE.CanvasTexture | null {
    switch (type) {
      case BlockType.AIR:
        return null;
      default:
        return TextureGenerator.generateVariantTexture(type, 0);
    }
  }

  /**
   * Returns the variant index (0-2) for a block position.
   *
   * The variant is determined deterministically from the block's world
   * coordinates using a stable hash function. Adjacent blocks will have
   * different variants, creating visible texture variation across the
   * terrain while remaining stable across frames and sessions.
   *
   * @param x - World X coordinate of the block.
   * @param y - World Y coordinate of the block.
   * @param z - World Z coordinate of the block.
   * @returns The variant index in range [0, 2].
   */
  public static getVariantIndex(x: number, y: number, z: number): number {
    return TextureGenerator.hashBlockPosition(x, y, z) % VARIANT_COUNT;
  }

  /**
   * Returns the atlas cell coordinates for a block type, face direction,
   * and variant index.
   *
   * The atlas is a 12×2 grid where each cell is 1/12 wide × 1/2 tall in
   * UV space. The returned coordinates are the cell's grid position
   * (column, row).
   *
   * GRASS uses different cells for top (row 0, cols 0-2) vs side/bottom
   * (row 0, cols 3-5). All other block types use a single row of cells.
   *
   * @param type - The block type to look up.
   * @param face - The face direction (0-5, matching FaceDirection enum).
   * @param variant - The variant index (0-2).
   * @returns The atlas cell coordinates as [column, row].
   */
  public static getAtlasCellForBlock(
    type: BlockType,
    face: number,
    variant: number
  ): [number, number] {
    // Clamp the variant index to the valid range.
    const v = Math.max(0, Math.min(VARIANT_COUNT - 1, variant));

    switch (type) {
      case BlockType.GRASS:
        // Top face (face 2 / POS_Y) uses GRASS_TOP cells (row 0, cols 0-2).
        if (face === 2) {
          return [v, 0];
        }
        // Side and bottom faces use GRASS_SIDE cells (row 0, cols 3-5).
        return [3 + v, 0];

      case BlockType.DIRT:
        return [6 + v, 0];

      case BlockType.STONE:
        return [9 + v, 0];

      case BlockType.SAND:
        return [v, 1];

      case BlockType.WOOD:
        return [3 + v, 1];

      case BlockType.LEAVES:
        return [6 + v, 1];

      case BlockType.BEDROCK:
        return [9 + v, 1];

      case BlockType.GLASS:
      case BlockType.WATER:
      case BlockType.AIR:
      default:
        // These types are not in the atlas — return a fallback cell.
        return [0, 0];
    }
  }

  /**
   * Computes the 4 UV coordinates for an atlas cell.
   *
   * The atlas is a 12×2 grid where each cell is 1/12 wide × 1/2 tall.
   * The returned UVs are in counter-clockwise order matching the
   * face corner ordering.
   *
   * **Coordinate System Note**: Canvas 2D uses a top-left origin (y=0 at
   * the top), but Three.js UV coordinates use a bottom-left origin (v=0
   * at the bottom). This method accounts for this difference by flipping
   * the V coordinate — cell row 0 (canvas top) maps to UV v:[0.5, 1.0]
   * (top half in Three.js), and cell row 1 (canvas bottom) maps to
   * UV v:[0.0, 0.5] (bottom half in Three.js).
   *
   * @param cellX - The cell's column index (0-11).
   * @param cellY - The cell's row index (0-1).
   * @returns An array of 4 UV coordinate pairs.
   */
  public static getFaceUVs(cellX: number, cellY: number): [number, number][] {
    // Compute the UV boundaries for this cell.
    // IMPORTANT: Canvas 2D uses a top-left origin (y=0 at top), but Three.js
    // UV coordinates use a bottom-left origin (v=0 at bottom). This means the
    // V coordinate must be flipped when mapping atlas cells to UV space.
    //
    // For cell row 0 (canvas top): v0 = 1.0 - 0 - 0.5 = 0.5, v1 = 1.0
    //   → UV v:[0.5, 1.0] maps to the TOP half in Three.js (correct).
    // For cell row 1 (canvas bottom): v0 = 1.0 - 0.5 - 0.5 = 0.0, v1 = 0.5
    //   → UV v:[0.0, 0.5] maps to the BOTTOM half in Three.js (correct).
    const u0 = cellX / ATLAS_COLS;
    const v0 = 1.0 - (cellY / ATLAS_ROWS) - (1.0 / ATLAS_ROWS);
    const u1 = (cellX + 1) / ATLAS_COLS;
    const v1 = v0 + (1.0 / ATLAS_ROWS);

    // Return the 4 UV corners in CCW order.
    return [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
  }

    /**
   * Generates a water texture.
   *
   * Blue with per-pixel noise to simulate water surface ripples.
   * The texture itself is opaque — transparency is handled by the material.
   *
   * @returns A configured THREE.CanvasTexture.
   */
  public static generateWaterTexture(): THREE.CanvasTexture {
    const rng = TextureGenerator.mulberry32(BASE_SEED);
    return TextureGenerator._generateWaterTexture(rng);
  }

  /**
   * Generates a glass texture.
   *
   * Fully transparent center with a white border and subtle diagonal sheen.
   *
   * @returns A configured THREE.CanvasTexture.
   */
  public static generateGlassTexture(): THREE.CanvasTexture {
    const rng = TextureGenerator.mulberry32(BASE_SEED + 500);
    return TextureGenerator._generateGlassTexture(rng);
  }

  /**
   * Draws a noisy texture region onto a canvas context.
   *
   * This is the core helper used by all texture generation methods. It:
   * 1. Fills the region with the base color
   * 2. Applies per-pixel random brightness variation
   * 3. Adds a specified number of speckles (darker or lighter)
   *
   * The variation parameter controls the intensity of the per-pixel noise:
   * - 0.0: no variation (flat color)
   * - 0.1: subtle variation
   * - 0.2: strong variation
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param x - The X offset of the region in the canvas.
   * @param y - The Y offset of the region in the canvas.
   * @param width - The width of the region in pixels.
   * @param height - The height of the region in pixels.
   * @param baseColor - The base hex color string (e.g. '#7CB342').
   * @param variation - Brightness variation amount in range [0, 1].
   *                    Higher values produce more contrast. Clamped internally.
   * @param speckleCount - Number of speckle pixels to add.
   * @param speckleDarken - If true, speckles are darker than base; if false, lighter.
   * @param rng - Optional seeded random number generator. Defaults to Math.random.
   */
  private static drawNoiseTexture(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    baseColor: string,
    variation: number,
    speckleCount: number,
    speckleDarken: boolean,
    rng: RNG = Math.random
  ): void {
    // --- Base Color ---
    // Parse the hex color; fall back to a neutral gray if invalid.
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 128, g: 128, b: 128 };
    ctx.fillStyle = `rgb(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b})`;
    ctx.fillRect(x, y, width, height);

    // Clamp variation to a safe range [0, 1] to prevent extreme values.
    const clampedVariation = Math.max(0, Math.min(1, variation));

    // --- Per-Pixel Noise ---
    // Apply random brightness offsets scaled by the variation parameter.
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        // Random delta in range [-variation, +variation].
        const delta = (rng() * 2 - 1) * clampedVariation;

        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }

    // --- Speckles ---
    // Add randomly placed pixels that are darker or lighter than the base.
    const speckleFactor = speckleDarken ? 0.75 : 1.25;
    for (let i = 0; i < speckleCount; i++) {
      const sx = x + Math.floor(rng() * width);
      const sy = y + Math.floor(rng() * height);
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * speckleFactor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * speckleFactor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * speckleFactor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  /**
   * Converts a hex color string to an RGB object.
   *
   * Supports both 3-digit (#RGB) and 6-digit (#RRGGBB) formats.
   *
   * @param hex - The hex color string (e.g. '#7CB342' or '#7C3').
   * @returns An object with r, g, b channels (0-255), or null if invalid.
   */
  private static hexToRgb(hex: string): RGB | null {
    // Strip the leading '#' if present.
    let normalized = hex.replace('#', '');

    // Expand 3-digit shorthand (#RGB → #RRGGBB).
    if (normalized.length === 3) {
      normalized = normalized
        .split('')
        .map((char) => char + char)
        .join('');
    }

    // Validate: must be exactly 6 hex characters.
    if (normalized.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return null;
    }

    // Parse each channel pair as a base-16 integer.
    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);

    return { r, g, b };
  }

  /**
   * Creates a mulberry32 seeded random number generator.
   *
   * Mulberry32 is a fast, high-quality PRNG that produces deterministic
   * output for a given seed. It returns a function that generates
   * floating-point numbers in the range [0, 1).
   *
   * @param seed - The integer seed value.
   * @returns A function that returns a random number in [0, 1).
   */
  private static mulberry32(seed: number): RNG {
    let state = seed | 0;

    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Produces a stable integer hash from block coordinates.
   *
   * The hash combines the three coordinates using prime multipliers and
   * a final mixing step to ensure good distribution. The result is always
   * a non-negative integer, suitable for modulo operations.
   *
   * @param x - World X coordinate.
   * @param y - World Y coordinate.
   * @param z - World Z coordinate.
   * @returns A non-negative integer hash value.
   */
  private static hashBlockPosition(x: number, y: number, z: number): number {
    // Combine coordinates with prime multipliers.
    let hash = x * 374761393 + y * 668265263 + z * 2147483647;

    // Mix the hash to improve distribution.
    hash = (hash ^ (hash >> 13)) * 1274126177;
    hash = hash ^ (hash >> 16);

    // Return a non-negative value.
    return Math.abs(hash);
  }

  /**
   * Generates a grass top texture variant.
   *
   * Rich green with per-pixel noise, darker/lighter speckles, and subtle
   * blade-like vertical streaks for a natural grass appearance.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateGrassTopTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for grass top texture');
    }

    TextureGenerator._drawGrassTopTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a grass top texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawGrassTopTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: natural grass green.
    const baseColor = '#7CB342';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 124, g: 179, b: 66 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise with moderate variation.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.18;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Blade-like vertical streaks: slightly darker/lighter vertical lines.
    const streakCount = 4 + Math.floor(rng() * 3); // 4-6 streaks
    for (let i = 0; i < streakCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const streakLength = 4 + Math.floor(rng() * 8); // 4-11 pixels long
      const streakStart = Math.floor(rng() * (TEXTURE_SIZE - streakLength));
      const darken = rng() > 0.5;

      for (let j = 0; j < streakLength; j++) {
        const sy = streakStart + j;
        const factor = darken ? 0.85 : 1.15;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
      }
    }

    // Darker and lighter speckles.
    const speckleCount = 8 + Math.floor(rng() * 5); // 8-12 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = Math.floor(rng() * TEXTURE_SIZE);
      const darken = rng() > 0.4;
      const factor = darken ? 0.7 : 1.3;
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }
  }

  /**
   * Generates a grass side texture variant.
   *
   * Brown dirt base with a green top strip (8px), drooping grass blade
   * edges (green pixels extending 2-3px down from the top edge at random
   * x positions), and a transition row blending green to brown.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateGrassSideTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for grass side texture');
    }

    TextureGenerator._drawGrassSideTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a grass side texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawGrassSideTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Brown dirt base.
    const dirtColor = '#7A4E25';
    const dirtRgb = TextureGenerator.hexToRgb(dirtColor) ?? { r: 122, g: 78, b: 37 };
    ctx.fillStyle = dirtColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Green top strip (8px).
    const grassColor = '#7CB342';
    const grassRgb = TextureGenerator.hexToRgb(grassColor) ?? { r: 124, g: 179, b: 66 };
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.15;
        const r = Math.max(0, Math.min(255, Math.round(grassRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(grassRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(grassRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Drooping grass blade edges: green pixels extending 2-3px down from
    // the top edge at random x positions.
    const bladeCount = 3 + Math.floor(rng() * 4); // 3-6 blades
    for (let i = 0; i < bladeCount; i++) {
      const bx = Math.floor(rng() * TEXTURE_SIZE);
      const bladeLength = 2 + Math.floor(rng() * 2); // 2-3 pixels down
      for (let j = 0; j < bladeLength; j++) {
        const by = 8 + j; // Start just below the green strip
        if (by < TEXTURE_SIZE) {
          const delta = (rng() * 2 - 1) * 0.15;
          const r = Math.max(0, Math.min(255, Math.round(grassRgb.r * (1 + delta))));
          const g = Math.max(0, Math.min(255, Math.round(grassRgb.g * (1 + delta))));
          const b = Math.max(0, Math.min(255, Math.round(grassRgb.b * (1 + delta))));
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(offsetX + bx, offsetY + by, 1, 1);
        }
      }
    }

    // Transition row (row 6): blend green to brown.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const blend = 0.3 + rng() * 0.4;
      const r = Math.round(grassRgb.r * blend + dirtRgb.r * (1 - blend));
      const g = Math.round(grassRgb.g * blend + dirtRgb.g * (1 - blend));
      const b = Math.round(grassRgb.b * blend + dirtRgb.b * (1 - blend));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + x, offsetY + 6, 1, 1);
    }

    // Dirt region noise (rows 7-15).
    for (let y = 7; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.15;
        const r = Math.max(0, Math.min(255, Math.round(dirtRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(dirtRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(dirtRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Darker speckles in the dirt region.
    const speckleCount = 6 + Math.floor(rng() * 4); // 6-9 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = 7 + Math.floor(rng() * 9); // rows 7-15
      const r = Math.max(0, Math.round(dirtRgb.r * 0.75));
      const g = Math.max(0, Math.round(dirtRgb.g * 0.75));
      const b = Math.max(0, Math.round(dirtRgb.b * 0.75));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }
  }

  /**
   * Generates a dirt texture variant.
   *
   * Brown with per-pixel noise, darker organic speckles, and occasional
   * small pebbles (2×2 lighter patches).
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateDirtTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for dirt texture');
    }

    TextureGenerator._drawDirtTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a dirt texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawDirtTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: brown soil.
    const baseColor = '#8B5A2B';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 139, g: 90, b: 43 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.15;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Darker organic speckles.
    const speckleCount = 8 + Math.floor(rng() * 5); // 8-12 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = Math.floor(rng() * TEXTURE_SIZE);
      const factor = 0.7 + rng() * 0.15; // 0.70-0.85
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }

    // Occasional small pebbles (2×2 lighter patches).
    const pebbleCount = 1 + Math.floor(rng() * 3); // 1-3 pebbles
    for (let i = 0; i < pebbleCount; i++) {
      const px = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const py = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const factor = 1.2 + rng() * 0.2; // 1.20-1.40
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + px, offsetY + py, 2, 2);
    }
  }

  /**
   * Generates a stone texture variant.
   *
   * Gray with per-pixel noise, crack lines (dark gray/black 1px random-walk
   * lines), and mineral speckles.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateStoneTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for stone texture');
    }

    TextureGenerator._drawStoneTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a stone texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawStoneTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: gray rock.
    const baseColor = '#808080';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 128, g: 128, b: 128 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.12;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Crack lines: dark gray/black 1px random-walk lines.
    const crackCount = 1 + Math.floor(rng() * 3); // 1-3 cracks
    for (let i = 0; i < crackCount; i++) {
      // Random starting point.
      let cx = Math.floor(rng() * TEXTURE_SIZE);
      let cy = Math.floor(rng() * TEXTURE_SIZE);

      // Random walk length.
      const walkLength = 4 + Math.floor(rng() * 8); // 4-11 segments

      ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
      for (let j = 0; j < walkLength; j++) {
        // Draw the current pixel.
        ctx.fillRect(offsetX + cx, offsetY + cy, 1, 1);

        // Random step in one of 4 directions.
        const direction = Math.floor(rng() * 4);
        switch (direction) {
          case 0: cx = Math.min(TEXTURE_SIZE - 1, cx + 1); break;
          case 1: cx = Math.max(0, cx - 1); break;
          case 2: cy = Math.min(TEXTURE_SIZE - 1, cy + 1); break;
          case 3: cy = Math.max(0, cy - 1); break;
        }
      }
    }

    // Mineral speckles: lighter gray/white pixels.
    const speckleCount = 4 + Math.floor(rng() * 4); // 4-7 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = Math.floor(rng() * TEXTURE_SIZE);
      const factor = 1.3 + rng() * 0.3; // 1.30-1.60
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }
  }

  /**
   * Generates a sand texture variant.
   *
   * Light yellow with per-pixel noise, lighter grain speckles, and subtle
   * horizontal banding.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateSandTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for sand texture');
    }

    TextureGenerator._drawSandTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a sand texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawSandTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: light yellow sand.
    const baseColor = '#E8D58A';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 232, g: 213, b: 138 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise with subtle variation.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.08;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Subtle horizontal banding: slightly darker/lighter rows.
    const bandCount = 2 + Math.floor(rng() * 2); // 2-3 bands
    for (let i = 0; i < bandCount; i++) {
      const bandY = Math.floor(rng() * TEXTURE_SIZE);
      const bandWidth = 1 + Math.floor(rng() * 2); // 1-2 pixels tall
      const darken = rng() > 0.5;
      const factor = darken ? 0.92 : 1.08;

      for (let y = bandY; y < Math.min(TEXTURE_SIZE, bandY + bandWidth); y++) {
        for (let x = 0; x < TEXTURE_SIZE; x++) {
          const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
          const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
          const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
        }
      }
    }

    // Lighter grain speckles.
    const speckleCount = 10 + Math.floor(rng() * 5); // 10-14 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = Math.floor(rng() * TEXTURE_SIZE);
      const factor = 1.15 + rng() * 0.15; // 1.15-1.30
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }
  }

  /**
   * Generates a wood texture variant.
   *
   * Brown bark with vertical stripes, growth ring texture (horizontal
   * curved lines near top/bottom), and per-pixel noise.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateWoodTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for wood texture');
    }

    TextureGenerator._drawWoodTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a wood texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawWoodTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: brown bark.
    const baseColor = '#6B4226';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 107, g: 66, b: 38 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Vertical stripes: darker bark ridges.
    const stripeCount = 3 + Math.floor(rng() * 2); // 3-4 stripes
    const stripeColor = '#3A2010';
    for (let i = 0; i < stripeCount; i++) {
      const stripeX = 1 + Math.floor(rng() * 13);
      const stripeWidth = 2 + Math.floor(rng() * 2); // 2-3 pixels wide
      ctx.fillStyle = stripeColor;
      ctx.fillRect(offsetX + stripeX, offsetY, stripeWidth, TEXTURE_SIZE);
    }

    // Growth ring texture: horizontal curved lines near top/bottom.
    const ringCount = 1 + Math.floor(rng() * 2); // 1-2 rings
    for (let i = 0; i < ringCount; i++) {
      const ringY = i === 0 ? 1 + Math.floor(rng() * 3) : 12 + Math.floor(rng() * 3);
      const ringColor = 'rgba(58, 32, 16, 0.6)';
      ctx.fillStyle = ringColor;

      // Draw a slightly curved horizontal line.
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const curve = Math.sin(x / 3) * 0.5;
        const y = Math.round(ringY + curve);
        if (y >= 0 && y < TEXTURE_SIZE) {
          ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
        }
      }
    }

    // Per-pixel noise.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.1;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }
  }

  /**
   * Generates a leaves texture variant.
   *
   * Green with high noise variation, darker leaf cluster patches (2×2),
   * and lighter highlight speckles.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateLeavesTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for leaves texture');
    }

    TextureGenerator._drawLeavesTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a leaves texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawLeavesTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: dark green foliage.
    const baseColor = '#2E7D32';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 46, g: 125, b: 50 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise with high variation.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.2;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Darker leaf cluster patches (2×2).
    const clusterCount = 2 + Math.floor(rng() * 3); // 2-4 clusters
    for (let i = 0; i < clusterCount; i++) {
      const cx = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const cy = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const factor = 0.7 + rng() * 0.1; // 0.70-0.80
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + cx, offsetY + cy, 2, 2);
    }

    // Lighter highlight speckles.
    const speckleCount = 6 + Math.floor(rng() * 4); // 6-9 speckles
    for (let i = 0; i < speckleCount; i++) {
      const sx = Math.floor(rng() * TEXTURE_SIZE);
      const sy = Math.floor(rng() * TEXTURE_SIZE);
      const factor = 1.25 + rng() * 0.25; // 1.25-1.50
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + sx, offsetY + sy, 1, 1);
    }
  }

  /**
   * Generates a bedrock texture variant.
   *
   * Dark gray with high contrast noise, darker patches, and occasional
   * lighter mineral flecks.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateBedrockTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for bedrock texture');
    }

    TextureGenerator._drawBedrockTexture(ctx, 0, 0, rng);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Draws a bedrock texture variant onto a canvas context.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param offsetX - The X offset in the canvas.
   * @param offsetY - The Y offset in the canvas.
   * @param rng - The seeded random number generator.
   */
  private static _drawBedrockTexture(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    rng: RNG
  ): void {
    // Base color: dark gray.
    const baseColor = '#3E3E3E';
    const baseRgb = TextureGenerator.hexToRgb(baseColor) ?? { r: 62, g: 62, b: 62 };

    // Fill the base color.
    ctx.fillStyle = baseColor;
    ctx.fillRect(offsetX, offsetY, TEXTURE_SIZE, TEXTURE_SIZE);

    // Per-pixel noise with high contrast.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const delta = (rng() * 2 - 1) * 0.2;
        const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * (1 + delta))));
        const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * (1 + delta))));
        const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * (1 + delta))));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(offsetX + x, offsetY + y, 1, 1);
      }
    }

    // Darker patches.
    const patchCount = 2 + Math.floor(rng() * 3); // 2-4 patches
    for (let i = 0; i < patchCount; i++) {
      const px = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const py = Math.floor(rng() * (TEXTURE_SIZE - 1));
      const factor = 0.6 + rng() * 0.15; // 0.60-0.75
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + px, offsetY + py, 2, 2);
    }

    // Lighter mineral flecks.
    const fleckCount = 3 + Math.floor(rng() * 3); // 3-5 flecks
    for (let i = 0; i < fleckCount; i++) {
      const fx = Math.floor(rng() * TEXTURE_SIZE);
      const fy = Math.floor(rng() * TEXTURE_SIZE);
      const factor = 1.3 + rng() * 0.3; // 1.30-1.60
      const r = Math.max(0, Math.min(255, Math.round(baseRgb.r * factor)));
      const g = Math.max(0, Math.min(255, Math.round(baseRgb.g * factor)));
      const b = Math.max(0, Math.min(255, Math.round(baseRgb.b * factor)));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(offsetX + fx, offsetY + fy, 1, 1);
    }
  }

  /**
   * Generates a water texture variant.
   *
   * Blue with per-pixel noise to simulate water surface ripples. The
   * texture itself is opaque — transparency is handled by the material.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateWaterTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for water texture');
    }

    // Draw the noisy water texture: blue base, ±10% variation, 6 lighter speckles.
    TextureGenerator.drawNoiseTexture(
      ctx, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE,
      '#2196F3', 0.1, 6, false, rng
    );

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Generates a glass texture variant.
   *
   * Fully transparent center with a white border and subtle diagonal sheen.
   *
   * @param rng - The seeded random number generator.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateGlassTexture(rng: RNG): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for glass texture');
    }

    // Clear the entire canvas to fully transparent.
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

    // White border (2px thick on all edges).
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillRect(0, 0, TEXTURE_SIZE, 2); // Top
    ctx.fillRect(0, TEXTURE_SIZE - 2, TEXTURE_SIZE, 2); // Bottom
    ctx.fillRect(0, 2, 2, TEXTURE_SIZE - 4); // Left
    ctx.fillRect(TEXTURE_SIZE - 2, 2, 2, TEXTURE_SIZE - 4); // Right

    // Diagonal sheen.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let i = 2; i < TEXTURE_SIZE - 2; i++) {
      ctx.fillRect(i, i, 1, 1);
      ctx.fillRect(i + 1, i, 1, 1);
    }

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Generates an empty (transparent) texture.
   *
   * Used as a fallback for AIR blocks.
   *
   * @returns A configured THREE.CanvasTexture.
   */
  private static _generateEmptyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for empty texture');
    }

    // Clear the canvas to fully transparent.
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

    return TextureGenerator._createStandaloneTexture(canvas);
  }

  /**
   * Creates a standalone CanvasTexture with standard settings.
   *
   * Uses NearestFilter for pixel-art style and RepeatWrapping for tiling.
   *
   * @param canvas - The canvas to create the texture from.
   * @returns A configured THREE.CanvasTexture.
   */
  private static _createStandaloneTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);

    // NearestFilter preserves the pixel-art look.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    // RepeatWrapping allows the texture to tile seamlessly across blocks.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return texture;
  }
}