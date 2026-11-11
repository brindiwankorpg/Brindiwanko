/**
 * @file Extra objects appended to the B and C sheets of every default tileset.
 * They fill the free tiles in palette order (holes first, then the following
 * rows), and the tiles already drawn keep their ids, so existing maps are
 * unchanged. Each object carries its flags:
 * - `X`: blocks every direction; `PASS`: walkable;
 * - `STAR`: drawn above characters (tops of trees, wall decorations);
 * - `BUSH`: hides the feet; `LADDER`: climbable; `COUNTER`: talk across it;
 * - `DAMAGE`: hurts when walked on;
 * - edge bits (`EDGE_DOWN`, `EDGE_LEFT`): a railing blocks only that side.
 */
import { RAMPS } from '../../shared/art/palette.js';
import {
  FLAG_BLOCK_DOWN,
  FLAG_BLOCK_LEFT,
  FLAG_BUSH,
  FLAG_COUNTER,
  FLAG_DAMAGE,
  FLAG_IMPASSABLE,
  FLAG_LADDER,
  FLAG_STAR,
} from '../../shared/tiles.js';
import * as F from './furniture.js';
import * as B from './objects-biomes.js';
import * as E from './objects-extra.js';
import * as O from './objects.js';
import type { Draw } from './objects.js';
import type { TilesetBuilder } from './tileset-builder.js';

const PASS = 0;
const X = FLAG_IMPASSABLE;
const STAR = FLAG_STAR;
const BUSH = FLAG_BUSH;
const TALL = [[STAR], [X]];
const BIG = [[STAR, STAR], [X, X]];
const WIDE = { w: 2, h: 1 };
const TWO = { w: 1, h: 2 };
const SQUARE = { w: 2, h: 2 };

/** The black "void" tile of A5, which used to sit on its first cell (now kept blank). */
const VOID: Draw = (c, x, y) => c.fillRect(x, y, 16, 16, '#000000');

type Entry = [Draw, number | number[][], { w: number; h: number }?];

/**
 * Appends entries in palette order, big objects first so that the small ones fill the
 * holes they leave (and those of the original layout).
 */
function append(b: TilesetBuilder, sheet: 'B' | 'C', entries: Entry[]): void {
  const area = (e: Entry) => (e[2] ? e[2].w * e[2].h : 1);
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, z) => area(z.e) - area(a.e) || a.i - z.i);
  for (const { e } of sorted) b.appendNew(sheet, e[0], e[1], e[2]);
}

/** Outside: farm, village life, garden and winter pieces. */
export function extendOutside(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  // The wooden door used to sit on the first tile of sheet C, which must stay blank.
  b.relocate('C', 0, 0, O.door(), PASS);
  append(b, 'B', [
    [E.fruitTree(), BIG, SQUARE],
    [E.fruitTree(RAMPS.flowerYellow, 'pear-tree'), BIG, SQUARE],
    [E.fountain(), BIG, SQUARE],
    [E.marketStall(), [[STAR, STAR], [X | FLAG_COUNTER, X | FLAG_COUNTER]], SQUARE],
    [E.marketStall(RAMPS.roofBlue, RAMPS.flowerYellow), [[STAR, STAR], [X | FLAG_COUNTER, X | FLAG_COUNTER]], SQUARE],
    [O.roundTree(RAMPS.jungleLight, 'light-tree'), BIG, SQUARE],
    [E.snowyPine(), TALL, TWO],
    [E.bareTree(), TALL, TWO],
    [E.scarecrow(), TALL, TWO],
    [B.charredTree(), TALL, TWO],
    [E.cart(), X, WIDE],
    [E.noticeBoard(), X, WIDE],
    [B.mossyLog(), X, WIDE],
    [E.floweringBush(), X],
    [E.floweringBush(RAMPS.flowerBlue, 'blue-bush'), X],
    [E.hedge(), X],
    [E.pumpkin(), X],
    [E.beehive(), X],
    [E.mailbox(), X],
    [E.torchPost(), X],
    [E.doghouse(), X],
    [E.stoneWall(), X],
    [F.woodpile(), X],
    [F.sacks(), X],
    [E.crops(), PASS | BUSH],
    [E.crops(RAMPS.jungleLight), PASS | BUSH],
    [E.wheat(), PASS | BUSH],
    [E.reeds(), PASS | BUSH],
    [E.steppingStones(), PASS],
    [E.puddle(), PASS],
    [O.flowers(RAMPS.coral, 'f5'), PASS],
    [O.flowers(RAMPS.poison, 'f6'), PASS],
    [O.mushrooms(RAMPS.flowerYellow), PASS],
    [B.fern(), PASS | BUSH],
    [E.railing('h'), FLAG_BLOCK_DOWN],
    [E.railing('v'), FLAG_BLOCK_LEFT],
    [O.rock(RAMPS.grassDark), X],
    [B.rubble(RAMPS.stone, 'village-rubble'), PASS],
  ]);
  append(b, 'C', [
    [E.clothesline(), [[STAR, STAR]], WIDE],
    [E.produceCrate(), X | FLAG_COUNTER],
    [E.produceCrate(RAMPS.flowerYellow), X | FLAG_COUNTER],
    [E.produceCrate(RAMPS.roofGreen), X | FLAG_COUNTER],
    [E.ivy(), STAR],
    [E.wallLantern(), STAR],
    [E.ladder(), PASS | FLAG_LADDER],
    [O.door(RAMPS.roofRed), PASS],
    [O.door(RAMPS.roofGreen, false), PASS],
    [O.windowTile(RAMPS.roofGreen), X],
    [F.curtainWindow(RAMPS.carpetGreen), STAR],
    [E.bucket(), X],
    [E.ropeCoil(), PASS],
    [F.banner(RAMPS.roofBlue), [[STAR], [STAR]], TWO],
    [E.broom(), X],
  ]);
}

/** Inside: storage, alchemy, nobility and kitchen. */
export function extendInside(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  // The red armchair used to sit on the first tile of sheet C, which must stay blank.
  b.relocate('C', 0, 0, F.armchair(), PASS);
  append(b, 'B', [
    [E.potionShelf(), TALL, TWO],
    [E.wineRack(), TALL, TWO],
    [E.crateStack(), TALL, TWO],
    [E.bunkBed(), [[X], [X]], TWO],
    [O.chest(false, RAMPS.roofBlue), X],
    [O.chest(true, RAMPS.roofRed), X],
    [O.pot(RAMPS.roofGreen), X],
    [O.barrel(), X],
    [E.bucket(), X],
    [E.broom(), X],
    [E.trapdoor(), PASS],
    [E.ladder(), PASS | FLAG_LADDER],
    [O.rug(RAMPS.carpetGreen), PASS],
    [E.ottoman(), PASS],
    [E.pottedFern(), X],
    [E.floorCandles(), X],
    [E.sink(), X | FLAG_COUNTER],
    [E.ropeCoil(), PASS],
    [F.stool(), PASS],
    [F.sacks(), X],
  ]);
  append(b, 'C', [
    [E.tapestry(), [[STAR, STAR], [STAR, STAR]], SQUARE],
    [E.tapestry(RAMPS.carpetRed), [[STAR, STAR], [STAR, STAR]], SQUARE],
    [E.throne(), TALL, TWO],
    [E.throne(RAMPS.carpetBlue), TALL, TWO],
    [E.alchemyTable(), X, WIDE],
    [E.chandelier(), [[STAR, STAR]], WIDE],
    [F.sofa(RAMPS.cloth), X, WIDE],
    [E.wallTrophy(), STAR],
    [E.wallLantern(), STAR],
    [E.ottoman(RAMPS.carpetRed), PASS],
    [F.flowerVase(RAMPS.flowerYellow), X],
    [F.armchair(RAMPS.cloth), PASS],
    [E.treasurePile(), X],
    [E.fruitBasket(), X],
  ]);
}

/** Dungeon: prison, crypt, traps and magic. */
export function extendDungeon(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  append(b, 'B', [
    [E.runeCircle(), PASS, SQUARE],
    [E.runeCircle(RAMPS.lava), PASS, SQUARE],
    [B.ribcage(), BIG, SQUARE],
    [E.coffin(), [[X], [X]], TWO],
    [E.coffin(RAMPS.dark), [[X], [X]], TWO],
    [E.cage(), TALL, TWO],
    [B.ruinPillar(RAMPS.stone), TALL, TWO],
    [E.sarcophagus(), X, WIDE],
    [E.jailBars(), X],
    [E.chains(), STAR],
    [E.skullPile(), X],
    [E.spikeTrap(true), PASS | FLAG_DAMAGE],
    [E.spikeTrap(false), PASS],
    [E.pressurePlate(), PASS],
    [E.wallLever(false), STAR],
    [E.wallLever(true), STAR],
    [E.brazier(), X],
    [E.brazier(RAMPS.glow), X],
    [E.orbPedestal(), X],
    [E.brokenPillar(), X],
    [E.treasurePile(), X],
    [E.floorCandles(), X],
    [B.rubble(RAMPS.stone, 'dungeon-rubble'), PASS],
    [E.puddle(RAMPS.swamp), PASS],
    [B.lantern(), X],
    [O.chest(false, RAMPS.gold), X],
  ]);
}

/** Cavern: mining camp, giant mushrooms and gems. */
export function extendCavern(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  append(b, 'B', [
    [E.giantMushroom(), TALL, TWO],
    [E.giantMushroom(RAMPS.poison), TALL, TWO],
    [B.bigCrystal(RAMPS.gold), TALL, TWO],
    [B.bigCrystal(RAMPS.flowerRed), TALL, TWO],
    [B.tallStalagmite(RAMPS.stone), TALL, TWO],
    [O.crystal(RAMPS.gold), X],
    [O.crystal(RAMPS.flowerRed), X],
    [B.oreRock(RAMPS.silver), X],
    [B.oreRock(RAMPS.flowerRed), X],
    [B.stalagmite(RAMPS.ice), X],
    [E.campfire(), X],
    [E.bedroll(), PASS],
    [E.bedroll(RAMPS.roofRed), PASS],
    [E.pickaxeRock(), X],
    [E.bucket(), X],
    [E.ropeCoil(), PASS],
    [E.puddle(RAMPS.glow), PASS],
    [O.bones(true), PASS],
    [B.glowMushrooms(RAMPS.poison), PASS],
    [E.brokenPillar(RAMPS.rock), X],
  ]);
}

/** Jungle: tribe village, ruins and fruit. */
export function extendJungle(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  append(b, 'B', [
    [E.strawHut(), BIG, SQUARE],
    [B.palmTree(RAMPS.jungle), BIG, SQUARE],
    [E.totem(), TALL, TWO],
    [B.stoneIdol(RAMPS.gold), TALL, TWO],
    [B.ruinPillar(), TALL, TWO],
    [E.giantFlower(), X],
    [E.giantFlower(RAMPS.poison), X],
    [E.fruitBasket(), X],
    [E.campfire(), X],
    [E.torchPost(), X],
    [E.brokenPillar(RAMPS.stoneWarm), X],
    [E.coconuts(), X],
    [B.tropicalFlowers(RAMPS.flowerYellow), PASS],
    [B.tropicalFlowers(RAMPS.poison), PASS],
    [B.fern(RAMPS.jungle), PASS | BUSH],
    [E.reeds(), PASS | BUSH],
    [E.steppingStones(RAMPS.stoneWarm), PASS],
    [E.puddle(RAMPS.swamp), PASS],
    [B.hangingVines(RAMPS.jungle), STAR],
    [E.spikeTrap(true), PASS | FLAG_DAMAGE],
  ]);
}

/** Volcano: fire cult, dragon remains and lava. */
export function extendVolcano(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  append(b, 'B', [
    [E.dragonSkull(), BIG, SQUARE],
    [E.runeCircle(RAMPS.lava), PASS, SQUARE],
    [E.demonStatue(), TALL, TWO],
    [E.obelisk(), TALL, TWO],
    [E.fireAltar(), X, WIDE],
    [E.lavaPool(), PASS | FLAG_DAMAGE],
    [E.scorchMark(), PASS],
    [E.brazier(), X],
    [E.brazier(RAMPS.poison), X],
    [E.skullPile(), X],
    [E.treasurePile(), X],
    [E.brokenPillar(RAMPS.basalt), X],
    [E.chains(), STAR],
    [E.cage(), TALL, TWO],
    [E.orbPedestal(RAMPS.lava), X],
    [O.crystal(RAMPS.lava), X],
    [B.oreRock(RAMPS.lava, RAMPS.basalt), X],
    [B.rubble(RAMPS.basalt, 'volcano-rubble'), PASS],
  ]);
}

/** Sea: beach leisure, port and treasure. */
export function extendSea(b: TilesetBuilder): void {
  b.relocateA5(0, 0, VOID, X);
  append(b, 'B', [
    [B.palmTree(RAMPS.jungle), BIG, SQUARE],
    [E.parasol(), TALL, TWO],
    [E.parasol(RAMPS.roofBlue), TALL, TWO],
    [B.wreckMast(), TALL, TWO],
    [E.beachTowel(), PASS],
    [E.beachTowel(RAMPS.roofRed), PASS],
    [E.cannon(), X],
    [E.seaUrchin(), PASS | FLAG_DAMAGE],
    [E.rockPool(), X],
    [E.coconuts(), X],
    [E.fishingRods(), X],
    [E.ropeCoil(), PASS],
    [E.lifebuoy(), STAR],
    [E.treasurePile(), X],
    [E.produceCrate(RAMPS.lagoon), X | FLAG_COUNTER],
    [E.railing('h'), FLAG_BLOCK_DOWN],
    [E.railing('v'), FLAG_BLOCK_LEFT],
    [B.coral(RAMPS.flowerBlue), X],
    [B.shell(RAMPS.flowerWhite), PASS],
    [B.starfish(RAMPS.flowerRed), PASS],
  ]);
}
