/**
 * @file Character sheets shipped with the engine, in the standard layout
 * (4 × 2 characters per sheet, 3 × 4 frames each), every slot filled:
 * - `Actor1`-`Actor3`: heroes (the four starting classes, then other looks, knights, thieves, nobles);
 * - `People1`-`People3`: village NPCs (villagers, merchants, guards, farmers, nobles, elders...);
 * - `Monster1`-`Monster3`: slimes, bats, wolves, goblin, skeleton, mushrooms, ghosts, spiders,
 *   snakes, golems, wisps, crab, floating eye, man-eater, imp;
 * - `$Boss1`: the raid boss (`$` = a single, larger character per sheet); `Boss2`-`Boss4`: 24 more
 *   bosses with 48 x 64 frames (dragons, king slimes, liches, titans, spider queens, treants,
 *   minotaurs, giant knights);
 * - `!Objects1`-`!Objects3`: animated objects (chests, flames, herb, camp fire, doors, lever,
 *   breakables, crystals, save point, coin, portals, cauldron, gems); `!` = no vertical offset;
 * - `faces/Actor1`-`3`, `faces/People1`-`3`: matching portraits (4 x 2 per sheet).
 */
import {
  assembleCharacterSheet,
  drawCharacterBlock,
  type CharacterAppearance,
} from '../../shared/art/character.js';
import { assembleFaceSheet, drawFace } from '../../shared/art/face.js';
import { RAMPS, type Ramp } from '../../shared/art/palette.js';
import { bossBlocks } from './bosses.js';
import type { GeneratedImage } from './build.js';
import { bat, chestAnimation, demonLord, flameAnimation, herbAnimation, mushroom, slime, wolf } from './monsters.js';
import {
  breakableAnimation,
  campfireAnimation,
  cauldronAnimation,
  coinAnimation,
  crab,
  crystalAnimation,
  doorAnimation,
  floatingEye,
  gemAnimation,
  ghost,
  golem,
  imp,
  leverAnimation,
  maneater,
  portalAnimation,
  savePointAnimation,
  snake,
  spider,
  wisp,
} from './monsters-extra.js';

const actor = (a: Partial<CharacterAppearance>): CharacterAppearance => ({
  body: 'male', skin: 0, hair: 'short', hairColor: 1, outfit: 'warrior', outfitColor: 0, ...a,
});

/** Default appearances of the starting classes, reused by the class seed data. */
export const CLASS_APPEARANCES: CharacterAppearance[] = [
  actor({ outfit: 'warrior', hair: 'spiky', hairColor: 1, outfitColor: 0 }),
  actor({ outfit: 'warrior', body: 'female', hair: 'ponytail', hairColor: 3, outfitColor: 0 }),
  actor({ outfit: 'mage', hair: 'short', hairColor: 5, outfitColor: 1, skin: 1 }),
  actor({ outfit: 'mage', body: 'female', hair: 'long', hairColor: 7, outfitColor: 3 }),
  actor({ outfit: 'archer', hair: 'short', hairColor: 2, outfitColor: 2 }),
  actor({ outfit: 'archer', body: 'female', hair: 'bun', hairColor: 1, outfitColor: 2, skin: 2 }),
  actor({ outfit: 'priest', hair: 'short', hairColor: 1, outfitColor: 7 }),
  actor({ outfit: 'priest', body: 'female', hair: 'long', hairColor: 2, outfitColor: 1 }),
];

/** Extra heroes (sheets `Actor2`, `Actor3`): the classes in other looks, then knights, thieves and nobles. */
const ACTORS_2: CharacterAppearance[] = [
  actor({ outfit: 'warrior', hair: 'spiky', hairColor: 4, outfitColor: 1, skin: 1 }),
  actor({ outfit: 'warrior', body: 'female', hair: 'long', hairColor: 0, outfitColor: 2 }),
  actor({ outfit: 'mage', hair: 'bald', hairColor: 4, outfitColor: 3, beard: true, skin: 2 }),
  actor({ outfit: 'mage', body: 'female', hair: 'bun', hairColor: 3, outfitColor: 0 }),
  actor({ outfit: 'archer', hair: 'spiky', hairColor: 6, outfitColor: 4 }),
  actor({ outfit: 'archer', body: 'female', hair: 'ponytail', hairColor: 3, outfitColor: 1, skin: 1 }),
  actor({ outfit: 'priest', hair: 'short', hairColor: 2, outfitColor: 7, skin: 3 }),
  actor({ outfit: 'priest', body: 'female', hair: 'bun', hairColor: 4, outfitColor: 1 }),
];
const ACTORS_3: CharacterAppearance[] = [
  actor({ outfit: 'knight', outfitColor: 1 }),
  actor({ outfit: 'knight', body: 'female', outfitColor: 0 }),
  actor({ outfit: 'thief', hair: 'short', outfitColor: 5, skin: 1 }),
  actor({ outfit: 'thief', body: 'female', outfitColor: 3, skin: 2 }),
  actor({ outfit: 'noble', hair: 'short', hairColor: 2, outfitColor: 1 }),
  actor({ outfit: 'noble', body: 'female', hair: 'long', hairColor: 2, outfitColor: 3 }),
  actor({ outfit: 'warrior', hair: 'bald', hairColor: 3, outfitColor: 4, beard: true, skin: 3 }),
  actor({ outfit: 'mage', body: 'female', hair: 'long', hairColor: 8, outfitColor: 6 }),
];

const PEOPLE: CharacterAppearance[] = [
  actor({ outfit: 'villager', hair: 'short', hairColor: 1, outfitColor: 4 }),
  actor({ outfit: 'villager', body: 'female', hair: 'long', hairColor: 3, outfitColor: 2 }),
  actor({ outfit: 'merchant', hair: 'short', hairColor: 0, outfitColor: 7, beard: true, skin: 1 }),
  actor({ outfit: 'guard', outfitColor: 1 }),
  actor({ outfit: 'smith', hair: 'bald', hairColor: 3, outfitColor: 5, beard: true, skin: 2 }),
  actor({ outfit: 'innkeeper', body: 'female', hair: 'bun', hairColor: 1, outfitColor: 0 }),
  actor({ outfit: 'sage', hair: 'bald', hairColor: 4, beard: true, outfitColor: 3 }),
  actor({ outfit: 'villager', body: 'female', hair: 'ponytail', hairColor: 2, outfitColor: 6, skin: 3 }),
];

/** More villagers (sheets `People2`, `People3`): farmers, nobles, guards, elders and the village youth. */
const PEOPLE_2: CharacterAppearance[] = [
  actor({ outfit: 'farmer', hair: 'short', hairColor: 1, outfitColor: 4, skin: 1 }),
  actor({ outfit: 'farmer', body: 'female', hair: 'ponytail', hairColor: 2, outfitColor: 2 }),
  actor({ outfit: 'noble', hair: 'short', hairColor: 4, outfitColor: 3, beard: true }),
  actor({ outfit: 'noble', body: 'female', hair: 'bun', hairColor: 3, outfitColor: 0 }),
  actor({ outfit: 'guard', body: 'female', outfitColor: 0, skin: 1 }),
  actor({ outfit: 'merchant', body: 'female', hair: 'long', hairColor: 1, outfitColor: 2, skin: 2 }),
  actor({ outfit: 'smith', hair: 'short', hairColor: 0, outfitColor: 5, skin: 3 }),
  actor({ outfit: 'innkeeper', hair: 'short', hairColor: 3, outfitColor: 1, beard: true }),
];
const PEOPLE_3: CharacterAppearance[] = [
  actor({ outfit: 'thief', outfitColor: 4, skin: 2 }),
  actor({ outfit: 'knight', outfitColor: 7 }),
  actor({ outfit: 'villager', hair: 'bald', hairColor: 4, outfitColor: 5, beard: true }),
  actor({ outfit: 'villager', body: 'female', hair: 'bun', hairColor: 4, outfitColor: 3, skin: 1 }),
  actor({ outfit: 'villager', hair: 'spiky', hairColor: 2, outfitColor: 1 }),
  actor({ outfit: 'villager', body: 'female', hair: 'ponytail', hairColor: 8, outfitColor: 7 }),
  actor({ outfit: 'priest', hair: 'bald', hairColor: 1, outfitColor: 3, skin: 1 }),
  actor({ outfit: 'mage', hair: 'long', hairColor: 4, outfitColor: 5, beard: true }),
];

/** Returns every generated character sheet. */
export function characterSheets(): GeneratedImage[] {
  const goblin = drawCharacterBlock(actor({ outfit: 'goblin', hair: 'bald' }));
  const skeleton = drawCharacterBlock(actor({ outfit: 'skeleton', hair: 'bald' }));
  const bosses = bossBlocks();
  const frost: Ramp = ['#4a5a78', '#7a8eae', '#b4c6e0', '#eef6ff'];
  return [
    { path: 'characters/Actor1', canvas: assembleCharacterSheet(CLASS_APPEARANCES.map(drawCharacterBlock)) },
    { path: 'characters/Actor2', canvas: assembleCharacterSheet(ACTORS_2.map(drawCharacterBlock)) },
    { path: 'characters/Actor3', canvas: assembleCharacterSheet(ACTORS_3.map(drawCharacterBlock)) },
    { path: 'faces/Actor1', canvas: assembleFaceSheet(CLASS_APPEARANCES.map(drawFace)) },
    { path: 'faces/Actor2', canvas: assembleFaceSheet(ACTORS_2.map(drawFace)) },
    { path: 'faces/Actor3', canvas: assembleFaceSheet(ACTORS_3.map(drawFace)) },
    { path: 'faces/People1', canvas: assembleFaceSheet(PEOPLE.map(drawFace)) },
    { path: 'faces/People2', canvas: assembleFaceSheet(PEOPLE_2.map(drawFace)) },
    { path: 'faces/People3', canvas: assembleFaceSheet(PEOPLE_3.map(drawFace)) },
    { path: 'characters/People1', canvas: assembleCharacterSheet(PEOPLE.map(drawCharacterBlock)) },
    { path: 'characters/People2', canvas: assembleCharacterSheet(PEOPLE_2.map(drawCharacterBlock)) },
    { path: 'characters/People3', canvas: assembleCharacterSheet(PEOPLE_3.map(drawCharacterBlock)) },
    {
      path: 'characters/Monster1',
      canvas: assembleCharacterSheet([slime(), bat(), wolf(), goblin, skeleton, mushroom(), slime(RAMPS.roofRed), bat(RAMPS.roofBrown)]),
    },
    {
      path: 'characters/Monster2',
      canvas: assembleCharacterSheet([ghost(), spider(), snake(), golem(), wisp(), crab(), floatingEye(), maneater()]),
    },
    {
      path: 'characters/Monster3',
      canvas: assembleCharacterSheet([
        imp(),
        slime(RAMPS.roofGreen),
        wolf(frost),
        mushroom(RAMPS.poison),
        ghost(RAMPS.cloth),
        spider(RAMPS.ice, RAMPS.roofBlue),
        snake(RAMPS.sand, RAMPS.plaster),
        golem(RAMPS.basalt, RAMPS.lava),
      ]),
    },
    { path: 'characters/$Boss1', canvas: demonLord() },
    { path: 'characters/Boss2', canvas: assembleCharacterSheet(bosses.slice(0, 8)) },
    { path: 'characters/Boss3', canvas: assembleCharacterSheet(bosses.slice(8, 16)) },
    { path: 'characters/Boss4', canvas: assembleCharacterSheet(bosses.slice(16, 24)) },
    {
      path: 'characters/!Objects1',
      canvas: assembleCharacterSheet([
        chestAnimation(),
        chestAnimation(RAMPS.roofRed),
        flameAnimation(),
        flameAnimation(),
        herbAnimation(),
        chestAnimation(RAMPS.gold),
        chestAnimation(RAMPS.roofBlue),
        campfireAnimation(),
      ]),
    },
    {
      path: 'characters/!Objects2',
      canvas: assembleCharacterSheet([
        doorAnimation(),
        doorAnimation(RAMPS.iron, true),
        leverAnimation(),
        breakableAnimation('pot'),
        breakableAnimation('crate'),
        crystalAnimation(),
        savePointAnimation(),
        coinAnimation(),
      ]),
    },
    {
      path: 'characters/!Objects3',
      canvas: assembleCharacterSheet([
        portalAnimation(),
        cauldronAnimation(),
        gemAnimation(),
        gemAnimation(RAMPS.flowerRed),
        flameAnimation(RAMPS.glow),
        flameAnimation(RAMPS.roofGreen),
        crystalAnimation(RAMPS.flowerRed),
        portalAnimation(RAMPS.glow),
      ]),
    },
  ];
}
