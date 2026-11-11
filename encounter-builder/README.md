# Encounter Builder (Foundry VTT v13–v14, Castles & Crusades)

Builds encounters by **Hit Dice vs Average Party Level (APL)**, filtered by biome, creature type and HD range, at four challenge levels: Easy, Fair, Hard and Deadly.

## Install
1. Unzip so the folder is `Data/modules/encounter-builder/` (it must contain `module.json`).
2. Restart Foundry, open your world, **Manage Modules → Encounter Builder → enable**.
3. Open it with the **Encounter Builder** button at the top of the Actors sidebar, or a macro:
   ```js
   game.modules.get("encounter-builder").api.open();
   ```

## The benchmarks
| | Easy | Fair | Hard | Deadly |
|---|---|---|---|---|
| **Groups**: effective HD as % of party's total levels | 25–50% | 50–100% | 100–150% | 150–200% |
| **Solo boss**: effective HD vs APL | APL −2 to +0 | +1 to +2 | +3 to +4 | +5 to +7 |

- **Dangerous abilities** (level drain, paralysis, breath weapon, magic resistance, petrification, death gaze, poison…) are found in the monster's special-ability Items and its SPECIAL line. One counts as **+2 effective HD**, two or more as **+3**.
- **Action economy**: when monsters outnumber the party, the total is multiplied: up to 2 per PC ×1.25, up to 3 per PC ×1.5, more than 3 per PC ×2.
- **Encounter styles**
  - *Mixed group*: any mix of up to N monster kinds.
  - *Solo boss*: one monster judged against APL.
  - *Boss + minions*: a leader scaled to the challenge level, plus minions of HD ≤ half APL.
  - *Horde*: only low-HD creatures (HD ≤ half APL, minimum 1), many of them.
- **Total XP** is shown for every encounter, using C&C "XP: base + per HP" with average HP (actual XP depends on rolled HP).

Each challenge level can be rerolled, placed on the scene as tokens (hidden by default), saved as a journal entry in an `Encounters` folder, or whispered to the GM.

## Checking a monster
```js
game.modules.get("encounter-builder").api.inspect("Wight");
game.modules.get("encounter-builder").api.setBiomes("Orc", ["hills", "mountains"]);
```
Biome ids: arctic, desert, forest, grassland, hills, mountains, swamp, jungle, subterranean, aquatic, urban, any.

## Settings
Monster and party folders, challenge level ranges, the dangerous-ability word list, the +2/+3 bonuses, the action economy multiplier on/off, and the maximum number of creatures.
