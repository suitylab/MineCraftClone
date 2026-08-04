/**
 * TerrainGenerator.ts — Procedural terrain generation system for the Minecraft Clone.
 *
 * This class generates a complete 128×128 voxel world using multi-octave
 * Simplex noise (FBM). The terrain features:
 * - Rolling plains and hills from large-scale noise
 * - Mountain ranges from a lower-frequency noise layer
 * - Fine detail from a high-frequency noise layer
 * - Water bodies in low-lying areas (below sea level)
 * - Sand floors beneath water bodies
 * - Grass surfaces with dirt and stone beneath (above sea level)
 * - Stone surfaces at high elevations
 * - Scattered trees on grass surfaces using 3D noise clustering
 *
 * The generator is deterministic — the same seed always produces the
 * same world. Different seeds produce completely different terrain.
 *
 * The class is self-contained and has no dependency on Three.js.
 * It writes block data directly to a ChunkManager.
 */
import { SimplexNoise } from '../utils/Noise';
import { ChunkManager } from './ChunkManager';
import { BlockType } from './World';
import { CHUNK_SIZE } from './Chunk';

/**
 * TerrainGenerator — Generates procedural terrain for the voxel world.
 *
 * The generation algorithm works in two phases:
 * 1. **Terrain fill**: For each (x, z) column, compute the surface height
 *    using multi-octave FBM noise, then fill the column with appropriate
 *    block types based on the height relative to sea level.
 * 2. **Tree placement**: After terrain is generated, scatter trees on
 *    grass surfaces using 3D noise for natural clustering.
 *
 * The height computation combines three noise layers:
 * - **Main layer** (5 octaves, scale 0.008): Large-scale rolling terrain
 * - **Mountain layer** (3 octaves, scale 0.002): Broad mountain ranges
 * - **Detail layer** (2 octaves, scale 0.05): Fine surface variation
 *
 * Block type selection rules:
 * - y=0: Always BEDROCK (world floor)
 * - Below sea level (height < SEA_LEVEL):
 *   - Deep: STONE
 *   - Near surface (top 3 blocks): SAND
 *   - Above surface up to SEA_LEVEL: WATER
 * - Above sea level (height >= SEA_LEVEL):
 *   - Surface (y == height): GRASS
 *   - Below surface (3 blocks): DIRT
 *   - Deeper: STONE
 * - High elevation (height > 48): STONE surface (no grass)
 */
export class TerrainGenerator {
  /** World Y level where the water surface sits. */
  public static readonly SEA_LEVEL = 24;

  /** Base terrain height before noise modulation. */
  public static readonly BASE_HEIGHT = 32;

  /** Maximum height variation from the main noise layer. */
  public static readonly HEIGHT_AMPLITUDE = 24;

  /** Maximum tree height in blocks (trunk only, excluding leaves). */
  public static readonly MAX_TREE_HEIGHT = 6;

  /** The seed used for noise generation. Stored for reproducibility. */
  private readonly _seed: number;

  /** The Simplex noise instance used for all noise computations. */
  private readonly _noise: SimplexNoise;

  /**
   * Creates a new TerrainGenerator with the given seed.
   *
   * If no seed is provided, a random seed is generated. The same seed
   * always produces the same terrain, enabling reproducible worlds.
   *
   * @param seed - Optional integer seed for deterministic generation.
   *               If omitted or 0, a random seed is used.
   */
  constructor(seed?: number) {
    // If seed is 0 or undefined, generate a random one
    if (!seed || seed === 0) {
      this._seed = SimplexNoise.createRandomSeed();
    } else {
      this._seed = seed;
    }

    // Create the noise instance with the stored seed
    this._noise = new SimplexNoise(this._seed);
  }

  /**
   * Generates the entire 128×128 world into the given ChunkManager.
   *
   * The generation process:
   * 1. Iterate over all world X/Z coordinates
   * 2. For each column, compute the surface height using computeHeight()
   * 3. Fill the column from y=0 to the surface height with appropriate
   *    block types based on the height relative to sea level
   * 4. After all terrain is filled, scatter trees on grass surfaces
   *
   * This method is idempotent — calling it multiple times with the same
   * ChunkManager will overwrite existing blocks with the same result.
   *
   * @param chunkManager - The ChunkManager to write block data into.
   */
  public generate(chunkManager: ChunkManager): void {
    // Iterate over all world X coordinates
    for (let x = ChunkManager.WORLD_MIN_X; x <= ChunkManager.WORLD_MAX_X; x++) {
      // Iterate over all world Z coordinates
      for (let z = ChunkManager.WORLD_MIN_Z; z <= ChunkManager.WORLD_MAX_Z; z++) {
        // Compute the surface height for this column
        const height = this.computeHeight(x, z);

        // Fill the column from y=0 to the surface height
        this.fillColumn(chunkManager, x, z, height);
      }
    }

    // After terrain is generated, scatter trees on grass surfaces
    this.generateTrees(chunkManager);
  }

  /**
   * Computes the terrain surface height at the given world coordinates.
   *
   * The height is computed by combining three noise layers:
   * 1. **Main layer**: 5-octave FBM at scale 0.008 — produces large-scale
   *    rolling terrain with hills and valleys
   * 2. **Mountain layer**: 3-octave FBM at scale 0.002 — produces broad
   *    mountain ranges with significant height variation
   * 3. **Detail layer**: 2-octave FBM at scale 0.05 — adds fine surface
   *    detail for natural-looking variation
   *
   * The final height is:
   *   height = BASE_HEIGHT + mainNoise * HEIGHT_AMPLITUDE + mountainNoise + detailNoise
   *
   * The result is clamped to [2, WORLD_MAX_Y - 10] to keep the terrain
   * within world bounds (bedrock at y=0, and at least 10 blocks of
   * headroom above the highest point).
   *
   * @param x - World X coordinate.
   * @param z - World Z coordinate.
   * @returns The surface height (Y coordinate) at the given position.
   */
  public computeHeight(x: number, z: number): number {
    // --- Main noise layer ---
    // Large-scale features: rolling hills and valleys
    // Scale 0.008 means features span roughly 125 blocks
    const mainNoise = this._noise.fbm2D(
      x * 0.008,
      z * 0.008,
      5,        // octaves
      2.0,      // lacunarity
      0.5       // gain
    );

    // --- Mountain noise layer ---
    // Broad mountain ranges: significant height variation
    // Scale 0.002 means features span roughly 500 blocks
    // Amplified by 12 for dramatic mountain peaks
    const mountainNoise = this._noise.fbm2D(
      x * 0.002,
      z * 0.002,
      3,        // octaves
      2.0,      // lacunarity
      0.5       // gain
    ) * 12;

    // --- Detail noise layer ---
    // Fine surface detail: small bumps and dips
    // Scale 0.05 means features span roughly 20 blocks
    // Amplified by 2 for subtle variation
    const detailNoise = this._noise.fbm2D(
      x * 0.05,
      z * 0.05,
      2,        // octaves
      2.0,      // lacunarity
      0.5       // gain
    ) * 2;

    // Combine all layers to get the final height
    let height = TerrainGenerator.BASE_HEIGHT +
      mainNoise * TerrainGenerator.HEIGHT_AMPLITUDE +
      mountainNoise +
      detailNoise;

    // Clamp to keep within world bounds:
    // - Minimum 2 (above bedrock at y=0)
    // - Maximum WORLD_MAX_Y - 10 (leave headroom above highest terrain)
    height = Math.max(2, Math.min(ChunkManager.WORLD_MAX_Y - 10, height));

    // Round to nearest integer for block placement
    return Math.round(height);
  }

  /**
   * Fills a single column of blocks from y=0 to the surface height.
   *
   * Block type selection rules:
   * - y=0: Always BEDROCK (world floor, prevents falling out of world)
   * - Below sea level (height < SEA_LEVEL):
   *   - y < height-3: STONE (deep underground)
   *   - y >= height-3: SAND (sand floor under water)
   *   - Water fills from height+1 to SEA_LEVEL (inclusive)
   * - Above sea level (height >= SEA_LEVEL):
   *   - y == height: GRASS (surface block)
   *   - y > height-4: DIRT (3 blocks below surface)
   *   - y <= height-4: STONE (deeper underground)
   * - High elevation (height > 48): STONE surface instead of grass
   *
   * @param chunkManager - The ChunkManager to write blocks into.
   * @param x - World X coordinate of the column.
   * @param z - World Z coordinate of the column.
   * @param height - The surface height (Y coordinate) of the column.
   */
  private fillColumn(
    chunkManager: ChunkManager,
    x: number,
    z: number,
    height: number
  ): void {
    // --- Bedrock layer ---
    // Always place bedrock at y=0 to prevent falling out of the world
    chunkManager.setBlock(x, 0, z, BlockType.BEDROCK);

    // --- Determine if this column is below sea level ---
    const belowSeaLevel = height < TerrainGenerator.SEA_LEVEL;

    // --- Determine if this is a high elevation (stone surface) ---
    const highElevation = height > 48;

    // --- Fill the column from y=1 to the surface height ---
    for (let y = 1; y <= height; y++) {
      // Determine the block type for this position
      let blockType: BlockType;

      if (belowSeaLevel) {
        // --- Below sea level: underwater terrain ---
        if (y < height - 3) {
          // Deep underground: stone
          blockType = BlockType.STONE;
        } else {
          // Near the surface: sand floor under water
          blockType = BlockType.SAND;
        }
      } else if (highElevation) {
        // --- High elevation: stone surface ---
        blockType = BlockType.STONE;
      } else {
        // --- Above sea level: grass surface with dirt and stone below ---
        if (y === height) {
          // Surface block: grass
          blockType = BlockType.GRASS;
        } else if (y > height - 4) {
          // 3 blocks below surface: dirt
          blockType = BlockType.DIRT;
        } else {
          // Deeper underground: stone
          blockType = BlockType.STONE;
        }
      }

      // Set the block at this position
      chunkManager.setBlock(x, y, z, blockType);
    }

    // --- Water filling ---
    // If below sea level, fill water from height+1 to SEA_LEVEL (inclusive)
    if (belowSeaLevel) {
      for (let y = height + 1; y <= TerrainGenerator.SEA_LEVEL; y++) {
        chunkManager.setBlock(x, y, z, BlockType.WATER);
      }
    }
  }

  /**
   * Scatters trees on grass surfaces throughout the world.
   *
   * Tree placement uses 3D noise to create natural clustering:
   * - Trees tend to grow in groups rather than uniformly scattered
   * - The noise value at each position determines tree density
   *
   * Placement conditions:
   * - 3D noise value > 0.35 (creates clusters)
   * - Surface block at (x, height, z) is GRASS
   * - Surface height >= SEA_LEVEL (trees don't grow underwater)
   * - Random check: Math.random() < 0.3 (sparse distribution)
   *
   * @param chunkManager - The ChunkManager to write tree blocks into.
   */
  private generateTrees(chunkManager: ChunkManager): void {
    // Iterate over all world X/Z coordinates
    for (let x = ChunkManager.WORLD_MIN_X; x <= ChunkManager.WORLD_MAX_X; x++) {
      for (let z = ChunkManager.WORLD_MIN_Z; z <= ChunkManager.WORLD_MAX_Z; z++) {
        // Compute 3D noise for tree clustering
        // The y-coordinate is fixed at 0 to create a 2D distribution
        // that varies smoothly across the XZ plane
        const treeNoise = this._noise.noise3D(x * 0.1, 0, z * 0.1);

        // Check if tree placement conditions are met
        if (treeNoise <= 0.35) {
          continue; // Not in a tree cluster
        }

        // Find the surface height at this position
        const surfaceY = this.computeHeight(x, z);

        // Check if the surface is grass and above sea level
        const surfaceBlock = chunkManager.getBlock(x, surfaceY, z);
        if (surfaceBlock !== BlockType.GRASS) {
          continue; // Not on grass surface
        }

        if (surfaceY < TerrainGenerator.SEA_LEVEL) {
          continue; // Below sea level (underwater)
        }

        // Random check for sparse distribution
        if (Math.random() >= 0.3) {
          continue; // Skip this position
        }

        // Place a tree at this position
        // The tree trunk starts at surfaceY + 1 (above the grass block)
        this.placeTree(chunkManager, x, surfaceY + 1, z);
      }
    }
  }

  /**
   * Places a single tree at the given world coordinates.
   *
   * Tree structure:
   * - **Trunk**: WOOD blocks from y to y + treeHeight - 1
   *   - Tree height is random: 4-6 blocks
   * - **Canopy**: LEAVES blocks arranged in layers:
   *   - Top layer (y + treeHeight): radius 2 (5×5 cross pattern)
   *   - Middle layer (y + treeHeight - 1): radius 1 (3×3 cross pattern)
   *   - Lower layer (y + treeHeight - 2): radius 1 (3×3 cross pattern)
   *
   * Leaves are only placed where the block is AIR, so the trunk is
   * never overwritten by leaves.
   *
   * @param chunkManager - The ChunkManager to write tree blocks into.
   * @param x - World X coordinate of the tree base.
   * @param y - World Y coordinate of the tree base (above the surface).
   * @param z - World Z coordinate of the tree base.
   */
  private placeTree(
    chunkManager: ChunkManager,
    x: number,
    y: number,
    z: number
  ): void {
    // Random tree height: 4-6 blocks
    const treeHeight = Math.floor(Math.random() * 3) + 4;

    // --- Place the trunk ---
    // WOOD blocks from y to y + treeHeight - 1
    for (let i = 0; i < treeHeight; i++) {
      chunkManager.setBlock(x, y + i, z, BlockType.WOOD);
    }

    // --- Place the canopy ---
    // Top layer: radius 2 at y + treeHeight
    this.placeLeafLayer(chunkManager, x, y + treeHeight, z, 2);

    // Middle layer: radius 1 at y + treeHeight - 1
    this.placeLeafLayer(chunkManager, x, y + treeHeight - 1, z, 1);

    // Lower layer: radius 1 at y + treeHeight - 2 (fuller canopy)
    this.placeLeafLayer(chunkManager, x, y + treeHeight - 2, z, 1);
  }

  /**
   * Places a single layer of leaves in a cross pattern.
   *
   * The leaf layer is a cross-shaped pattern:
   * - Radius 2: 5×5 cross (center + 4 arms of length 2)
   * - Radius 1: 3×3 cross (center + 4 arms of length 1)
   *
   * Leaves are only placed where the block is AIR, so the trunk
   * is never overwritten by leaves.
   *
   * @param chunkManager - The ChunkManager to write leaf blocks into.
   * @param centerX - World X coordinate of the layer center.
   * @param y - World Y coordinate of the layer.
   * @param centerZ - World Z coordinate of the layer center.
   * @param radius - The radius of the cross pattern (1 or 2).
   */
  private placeLeafLayer(
    chunkManager: ChunkManager,
    centerX: number,
    y: number,
    centerZ: number,
    radius: number
  ): void {
    // Place the center leaf
    this.setLeafIfAir(chunkManager, centerX, y, centerZ);

    // Place the four arms of the cross
    for (let i = 1; i <= radius; i++) {
      // North arm (+Z)
      this.setLeafIfAir(chunkManager, centerX, y, centerZ + i);
      // South arm (-Z)
      this.setLeafIfAir(chunkManager, centerX, y, centerZ - i);
      // East arm (+X)
      this.setLeafIfAir(chunkManager, centerX + i, y, centerZ);
      // West arm (-X)
      this.setLeafIfAir(chunkManager, centerX - i, y, centerZ);
    }
  }

  /**
   * Sets a leaf block at the given position if the current block is AIR.
   *
   * This prevents leaves from overwriting the tree trunk or other
   * non-air blocks.
   *
   * @param chunkManager - The ChunkManager to write the leaf block into.
   * @param x - World X coordinate.
   * @param y - World Y coordinate.
   * @param z - World Z coordinate.
   */
  private setLeafIfAir(
    chunkManager: ChunkManager,
    x: number,
    y: number,
    z: number
  ): void {
    // Only place leaves where the block is AIR
    if (chunkManager.getBlock(x, y, z) === BlockType.AIR) {
      chunkManager.setBlock(x, y, z, BlockType.LEAVES);
    }
  }

  /**
   * Returns the seed used for terrain generation.
   *
   * This allows the seed to be displayed or saved for reproducibility.
   *
   * @returns The integer seed used for noise generation.
   */
  public getSeed(): number {
    return this._seed;
  }
}