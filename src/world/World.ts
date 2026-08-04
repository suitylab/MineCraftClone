/**
 * World.ts — World data model and generation entry point for the Minecraft Clone.
 *
 * This module defines:
 * - BlockType: an enum of all block types with NUMERIC values (required by
 *   Chunk.ts's Uint8Array storage)
 * - World: a container class that holds a ChunkManager and provides
 *   generation/query methods
 *
 * The World class is a data model + generation orchestrator — it does NOT
 * create meshes or textures. Rendering is handled separately by ChunkMesh.
 *
 * ## World Generation Flow
 *
 * 1. A World is constructed with an empty ChunkManager (no chunks loaded).
 * 2. `generateWorld()` is called to create a new TerrainGenerator with a
 *    random seed and generate the full 128×128 terrain into the ChunkManager.
 * 3. The ChunkManager now contains all block data for the world.
 * 4. Rendering systems (ChunkMesh) read block data from the ChunkManager
 *    to build meshes.
 * 5. `dispose()` clears all data, returning the World to its initial state.
 */
import { ChunkManager } from './ChunkManager';
import { TerrainGenerator } from './TerrainGenerator';

/**
 * BlockType — enum of all block types available in the game.
 *
  * Values are NUMERIC (0-9) to match the Uint8Array storage format used by
 * Chunk.ts. Each byte in the chunk's block array stores one of these values.
 *
 * The numeric values are stable and must not be changed, as they are
 * persisted in the chunk data structure.
 */
export enum BlockType {
  /** Empty space — represents no block. Value: 0 */
  AIR = 0,
  /** Grass block — green top surface, found on the ground layer. Value: 1 */
  GRASS = 1,
  /** Dirt block — brown soil, found beneath grass. Value: 2 */
  DIRT = 2,
  /** Stone block — gray rock, found deeper underground. Value: 3 */
  STONE = 3,
  /** Sand block — light yellow, found near water bodies. Value: 4 */
  SAND = 4,
  /** Wood block — brown bark, used for tree trunks. Value: 5 */
  WOOD = 5,
  /** Leaves block — green foliage, used for tree canopies. Value: 6 */
  LEAVES = 6,
  /** Water block — blue semi-transparent, fills low-lying areas. Value: 7 */
  WATER = 7,
    /** Bedrock block — dark gray, world floor, indestructible. Value: 8 */
  BEDROCK = 8,
  /** Glass block — transparent, can be seen through. Value: 9 */
  GLASS = 9,
}

/**
 * World — container for all block data and generation orchestrator.
 *
 * The World class holds a ChunkManager (the actual block data container)
 * and a TerrainGenerator (the procedural generation system). It provides
 * a clean interface for:
 * - Generating a new world with a random seed
 * - Querying and modifying blocks at world coordinates
 * - Accessing the underlying ChunkManager for rendering
 * - Cleaning up all resources
 *
 * The World is a pure data model — it does NOT create meshes, textures,
 * or any Three.js objects. Rendering is handled separately by ChunkMesh.
 */
export class World {
  /** The chunk data container holding all block data. */
  public chunkManager: ChunkManager;

  /** The terrain generator used for the current world, or null if not generated. */
  public terrainGenerator: TerrainGenerator | null;

  /** The seed used for the current world generation. 0 if no world generated. */
  public seed: number;

  /**
   * Creates a new World with an empty ChunkManager.
   *
   * No chunks are loaded initially. Call `generateWorld()` to populate
   * the world with procedural terrain.
   */
  constructor() {
    // Initialize an empty chunk manager — no chunks loaded yet.
    this.chunkManager = new ChunkManager();

    // No terrain generator until generateWorld() is called.
    this.terrainGenerator = null;

    // Seed is 0 until a world is generated.
    this.seed = 0;
  }

  /**
   * Generates a new procedural world with a random seed.
   *
   * This method:
   * 1. Creates a NEW TerrainGenerator with a random seed (each call
   *    produces different terrain)
   * 2. Stores the seed for reproducibility
   * 3. Calls `terrainGenerator.generate(this.chunkManager)` to fill the
   *    ChunkManager with block data
   * 4. Logs the seed and chunk count for debugging
   *
   * Calling this method multiple times will regenerate the world with a
   * new random seed, overwriting any existing block data.
   */
  public generateWorld(): void {
    // Create a new TerrainGenerator with a random seed.
    // Each call produces a different seed, resulting in different terrain.
    this.terrainGenerator = new TerrainGenerator();

    // Store the seed for reproducibility and display.
    this.seed = this.terrainGenerator.getSeed();

    // Generate the terrain into the chunk manager.
    // This fills all 128×128 columns with appropriate block types.
    this.terrainGenerator.generate(this.chunkManager);

        // Generation complete — the chunk manager now holds all block data.
  }

  /**
   * Returns the block type at the given world coordinates.
   *
   * Delegates to the ChunkManager's getBlock method. Returns AIR if the
   * coordinates are out of world bounds or the containing chunk is not
   * loaded.
   *
   * @param x - World X coordinate.
   * @param y - World Y coordinate (vertical).
   * @param z - World Z coordinate.
   * @returns The BlockType at the given position, or AIR if invalid/unloaded.
   */
  public getBlock(x: number, y: number, z: number): BlockType {
    // Delegate to the chunk manager for coordinate conversion and lookup.
    return this.chunkManager.getBlock(x, y, z);
  }

  /**
   * Sets the block type at the given world coordinates.
   *
   * Delegates to the ChunkManager's setBlock method. Creates the containing
   * chunk if it does not exist. If the coordinates are out of world bounds,
   * the operation is silently ignored.
   *
   * @param x - World X coordinate.
   * @param y - World Y coordinate (vertical).
   * @param z - World Z coordinate.
   * @param type - The BlockType to set at the given position.
   */
    public setBlock(x: number, y: number, z: number, type: BlockType): void {
    // Delegate to the chunk manager for coordinate conversion and storage.
    this.chunkManager.setBlock(x, y, z, type);

    // Trigger mesh rebuilds for the affected chunk(s).
    // This ensures the rendering layer updates immediately after
    // block data changes (e.g., breaking or placing a block).
    this.chunkManager.rebuildChunksAroundBlock(x, y, z);
  }

    /**
   * Registers a callback to be invoked when a chunk needs its mesh rebuilt.
   *
   * This delegates to the ChunkManager's callback registration, allowing
   * the rendering layer (ChunkMesh) to rebuild chunk meshes when block
   * data changes.
   *
   * @param callback - The callback function receiving chunk coordinates.
   */
  public setChunkRebuildCallback(
    callback: (chunkX: number, chunkY: number, chunkZ: number) => void
  ): void {
    this.chunkManager.setChunkRebuildCallback(callback);
  }

  /**
   * Returns the ChunkManager used by this world.
   *
   * This is used by rendering systems (ChunkMesh) to read block data
   * and build merged geometries.
   *
   * @returns The ChunkManager instance holding all block data.
   */
  public getChunkManager(): ChunkManager {
    return this.chunkManager;
  }

  /**
   * Returns the seed used for the current world generation.
   *
   * @returns The integer seed, or 0 if no world has been generated yet.
   */
  public getSeed(): number {
    return this.seed;
  }

  /**
   * Cleans up all resources held by the world.
   *
   * This method:
   * 1. Clears the ChunkManager (removes all chunk data)
   * 2. Resets the terrain generator to null
   * 3. Resets the seed to 0
   *
   * After calling dispose(), the World returns to its initial empty state
   * and can be regenerated with generateWorld().
   */
  public dispose(): void {
    // Clear the chunk manager by creating a fresh instance.
    // This releases all chunk data and block arrays.
    this.chunkManager = new ChunkManager();

    // Reset the terrain generator reference.
    this.terrainGenerator = null;

    // Reset the seed to its initial value.
    this.seed = 0;

        // World resources released — ready for regeneration.
  }
}