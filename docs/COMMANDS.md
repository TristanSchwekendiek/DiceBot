# DiceBot Command Manual

DiceBot uses the `!` prefix for Discord commands. Most character commands act on the active character for the Discord user who sent the command. Importing or switching a character changes that user's active character.

GM-only commands require the Discord role ID configured in `index.js` as `GM_ROLE_ID`.

## Syntax Notes

- Required arguments are shown as `<value>`.
- Optional arguments are shown as `[value]`.
- Names can contain spaces unless the syntax says otherwise.
- Ability names use `str`, `dex`, `con`, `int`, `wis`, or `cha`.
- Spell commands that include `<class>` expect the class name at the end, such as `cleric`, `wizard`, or `warlock`.
- Dice expressions support dice and flat numbers joined by `+` or `-`, such as `d20`, `2d6+3`, `1d8-1`, or `2d6+1d4+2`.

## Quick Reference

| Category | Commands |
| --- | --- |
| Help | `!help` |
| Rolling | `!d20`, `!2d6+3`, `!save str`, `!check stealth` |
| Characters | `!import`, `!portrait`, `!profile`, `!characters`, `!switchcharacter`, `!deletecharacter` |
| Stats | `!setstr`, `!setdex`, `!setcon`, `!setint`, `!setwis`, `!setcha`, `!modstat` |
| Health | `!hp`, `!heal`, `!take`, `!shortrest`, `!longrest` |
| Inventory | `!inventory`, `!add`, `!toss` |
| Spells | `!spell`, `!availablespells`, `!prepare`, `!unprepare`, `!spellbook`, `!spellslots`, `!cast`, `!scroll` |
| Spell Loadouts | `!createloadout`, `!loadspellbook`, `!loadout`, `!learnspell`, `!unlearnspell` |
| Features and Progression | `!feats`, `!feat`, `!exp`, `!gainexp`, `!asi`, `!subclass`, `!choosesubclass` |
| Combat | `!rollinitiative`, `!initiative`, `!startcombat`, `!next`, `!turnorder`, `!removecombatant`, `!endcombat` |
| Death Saves | `!deathsave`, `!res`, `!faildeathsave` |
| Class Resources | `!resources`, plus class resource commands like `!rage`, `!ki`, `!layonhands` |

## Help

| Command | Usage | What It Does |
| --- | --- | --- |
| `!help` | `!help` | Shows the built-in command summary inside Discord. |

## Dice, Saves, and Checks

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| Raw dice roll | `!<dice expression>` | Rolls any supported dice expression. This is not `!roll`; the dice expression itself is the command. | `!d20`, `!2d6+3`, `!1d8-1`, `!2d6+1d4+2` |
| Saving throw | `!save <ability>` | Rolls `d20` plus the active character's saving throw bonus for that ability. | `!save dex`, `!save wis` |
| Skill check | `!check <skill>` | Rolls `d20` plus the active character's skill bonus. Spaces, hyphens, and underscores are normalized. | `!check stealth`, `!check sleight of hand`, `!check animal handling` |

Valid skills are `acrobatics`, `animal handling`, `arcana`, `athletics`, `deception`, `history`, `insight`, `intimidation`, `investigation`, `medicine`, `nature`, `perception`, `performance`, `persuasion`, `religion`, `sleight of hand`, `stealth`, and `survival`.

## Character Management

| Command | Usage | What It Does | Notes |
| --- | --- | --- | --- |
| Import character | `!import` with a `.json` attachment | Imports a character JSON file and makes it the active character. | Accepts the DiceBot builder JSON format and the DMV import format supported by the project. |
| Add portrait | `!portrait` with an image attachment | Saves a portrait for the active character. | Supported extensions are `.png`, `.jpg`, `.jpeg`, and `.webp`. |
| View profile | `!profile` | Shows the active character's race, class levels, HP, AC, stats, saving throws, portrait, and other core data. | Recalculates derived stats before showing the profile. |
| List characters | `!characters` | Lists all saved characters for the Discord user. | The active character is marked in the list. |
| Switch character | `!switchcharacter <character name>` | Sets an existing saved character as active. | Name matching is case-insensitive. |
| Delete character | `!deletecharacter <character name>` | Starts a reaction confirmation flow, then deletes the saved character if confirmed. | The confirmation times out after 30 seconds. |

Imported profiles are saved under `profiles/<discord-user-id>/<character-name>/profile.json`. Portraits are saved in the same character folder.

## Stats

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| Set STR | `!setstr <score>` | Sets Strength directly. | `!setstr 18` |
| Set DEX | `!setdex <score>` | Sets Dexterity directly. | `!setdex 14` |
| Set CON | `!setcon <score>` | Sets Constitution directly. | `!setcon 16` |
| Set INT | `!setint <score>` | Sets Intelligence directly. | `!setint 12` |
| Set WIS | `!setwis <score>` | Sets Wisdom directly. | `!setwis 15` |
| Set CHA | `!setcha <score>` | Sets Charisma directly. | `!setcha 20` |
| Modify stat | `!modstat <ability> <amount>` | Adds or subtracts from an ability score. | `!modstat wis 2`, `!modstat con -1` |

Ability scores must stay between `1` and `30`. After a stat change, DiceBot recalculates derived stats.

## Health and Rest

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| View HP | `!hp` | Shows current and maximum HP for the active character. | `!hp` |
| View another user's HP | `!hp @player` | Shows HP for the mentioned user's active character. | `!hp @Aria` |
| Heal | `!heal <number or dice>` | Restores HP up to the character's maximum. | `!heal 5`, `!heal 2d4+2` |
| Take damage | `!take <number or dice>` | Subtracts HP. HP can drop below 0. | `!take 7`, `!take 1d8+3` |
| Short rest | `!shortrest <hit dice count> [dX]` | Spends hit dice, heals by each die plus CON modifier, and resets short-rest resources. | `!shortrest 2`, `!shortrest 1 d10` |
| Long rest | `!longrest` | Restores HP, resets death saves, restores spell slots, restores long-rest resources, and refreshes hit dice pools. | `!longrest` |

If a multiclass character has more than one hit die pool, `!shortrest` requires the die size, such as `!shortrest 2 d8`.

## Death Saves

| Command | Usage | What It Does | Notes |
| --- | --- | --- | --- |
| Roll death save | `!deathsave` | Rolls and tracks a death saving throw for the active character. | Only works when current HP is 0 or lower. A natural 1 adds two failures, and a natural 20 adds two successes. |
| Stabilize player | `!res @player` | GM-only. Clears the mentioned user's death saves and brings them to at least 1 HP. | Requires the GM role. |
| Force failed save | `!faildeathsave @player` | GM-only. Adds one failed death save to a downed character. | Requires the GM role. |

When a character reaches three death save successes, DiceBot resets the track and sets them to 1 HP.

## Inventory

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| View inventory | `!inventory` | Shows the active character's inventory. | `!inventory` |
| Add item | `!add <item name> <amount>` | Adds an item or increases its quantity. | `!add torch 3`, `!add healing potion 2` |
| Toss item | `!toss <item name> <amount>` | Removes quantity from an item, deleting it when quantity reaches 0. | `!toss torch 1`, `!toss healing potion 1` |

Custom item names are stored in normalized lower-case form with spaces changed to hyphens, but the display name is cleaned up in Discord.

## Spell Lookup and Spellcasting

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| Spell lookup | `!spell <spell name>` | Looks up spell details from `spells.json`. | `!spell fireball`, `!spell cure wounds` |
| Available spell summary | `!availablespells` | Shows each spellcasting class on the character and how many spells are available to that class. | `!availablespells` |
| Available class spells | `!availablespells <class>` | Lists spells available to that class up to the character's highest slot level, including cantrips. | `!availablespells cleric` |
| Prepare spell | `!prepare <spell name> <class>` | Adds a spell to a prepared caster's prepared list. Also works for spellbook casters using known spellbook entries. | `!prepare bless cleric`, `!prepare shield wizard` |
| Unprepare spell | `!unprepare <spell name> <class>` | Removes one prepared spell from that class. | `!unprepare bless cleric` |
| Unprepare all | `!unprepare all` | Clears prepared spells for every prepared or spellbook class on the character. | `!unprepare all` |
| Spellbook summary | `!spellbook` | Shows spellcasting classes and prepared, known, or stored spell counts. | `!spellbook` |
| Class spellbook | `!spellbook <class>` | Lists prepared, known, or spellbook spells for one class. | `!spellbook wizard`, `!spellbook bard` |
| Spell slots | `!spellslots` | Shows remaining spell slots by level. | `!spellslots` |
| Cast spell | `!cast <spell name> [class] [slot]` | Casts an active prepared or known spell, spends a slot when needed, and rolls detected damage dice. | `!cast guiding bolt`, `!cast guiding bolt 3`, `!cast guiding bolt cleric 3` |
| Use scroll | `!scroll <spell name> [slot]` | Casts a spell as a scroll without spending slots, optionally upcasting. | `!scroll fireball`, `!scroll scorching ray 4` |

Spellcasting notes:

- `!prepare`, `!unprepare`, `!learnspell`, `!unlearnspell`, `!createloadout`, and `!loadspellbook` require the class name at the end.
- `!cast` can infer the class if only one active class can cast the spell. Add the class before the slot level when you need to be explicit, such as `!cast cure wounds cleric 2`.
- Cantrips cannot be upcast.
- Warlocks default to Pact Magic slots for leveled spells when possible.
- Damage rolling is best-effort. DiceBot extracts dice expressions from the spell text and has special handling for multi-beam spells such as `magic missile`, `scorching ray`, and `eldritch blast`.

## Spell Loadouts and Learned Spells

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| Save loadout | `!createloadout <loadout name> <class>` | Saves the current prepared spell list for a prepared or spellbook caster. | `!createloadout dungeon cleric` |
| Load spellbook | `!loadspellbook <loadout name> <class>` | Replaces the current prepared list with a saved loadout. | `!loadspellbook dungeon cleric` |
| List all loadouts | `!loadout` | Lists saved loadouts across all spellcasting classes. | `!loadout` |
| List class loadouts | `!loadout <class>` | Lists saved loadouts for one class. | `!loadout cleric` |
| View loadout | `!loadout <loadout name> <class>` | Shows the spells saved in a specific loadout. | `!loadout dungeon cleric` |
| Learn spell | `!learnspell <spell name> <class>` | Adds a spell to a known-spells or spellbook caster. | `!learnspell fireball wizard` |
| Unlearn spell | `!unlearnspell <spell name> <class>` | Removes a spell from a known-spells or spellbook caster. | `!unlearnspell fireball wizard` |

Prepared casters should use `!prepare` and `!unprepare`. Known-spell casters and spellbook casters use `!learnspell` and `!unlearnspell`.

## Features and Progression

| Command | Usage | What It Does | Examples |
| --- | --- | --- | --- |
| List features | `!feats` | Shows class features, racial features, and selected feat features. | `!feats` |
| View feature | `!feat <feature name>` | Shows details for a class, racial, or selected feat feature. | `!feat sneak attack`, `!feat darkvision` |
| View XP | `!exp` | Shows current XP, level, next threshold, pending subclass choices, and pending ASI points. | `!exp` |
| Gain XP | `!gainexp <amount>` | Adds XP and applies any automatic level-up summaries that are available. | `!gainexp 300` |
| View ASI | `!asi` | Shows pending ASI points and current ability scores. | `!asi` |
| Spend ASI on stats | `!asi <ability> <amount> [ability amount]` | Spends pending ASI points on ability score increases. | `!asi str 2`, `!asi str 1 dex 1` |
| Spend ASI on feat | `!asi feat <feat name> [chosen ability]` | Selects a feat using pending ASI points. Some feats require an ability choice. | `!asi feat Fey Touched wis` |
| View subclasses | `!subclass` | Shows pending subclass choices or already chosen subclasses. | `!subclass` |
| Choose subclass | `!choosesubclass <subclass name>` | Applies a pending subclass choice and adds any gained subclass features. | `!choosesubclass Battle Master` |

Progression notes:

- Ability Score Improvement features are handled by `!asi`, not `!feat ability score improvement`.
- `!gainexp` can report a blocked reason when the character cannot be automatically leveled, such as when manual multiclass decisions are needed.
- `!choosesubclass` only works when the character has a pending subclass selection.

## Combat and Initiative

Combat state is tracked per Discord channel.

| Command | Usage | Who Can Use It | What It Does |
| --- | --- | --- | --- |
| Start initiative setup | `!rollinitiative` | GM | Clears and starts an initiative setup for the channel. |
| Player initiative | `!initiative` | Player | Rolls initiative for the active character and adds or updates that player in the list. |
| Enemy initiative | `!initiative <enemy name> <modifier>` | GM | Rolls initiative for an enemy using the given modifier. |
| Start combat | `!startcombat` | GM | Sorts initiative, starts round 1, and announces the first turn. |
| Next turn | `!next` | GM | Advances to the next combatant and starts a new round when needed. |
| Turn order | `!turnorder` | Anyone | Shows the initiative list and marks the current turn. |
| Remove combatant | `!removecombatant <name>` | GM | Removes a combatant by name from the current initiative list. |
| End combat | `!endcombat` | GM | Clears the channel's combat state. |

Example combat flow:

```text
!rollinitiative
!initiative
!initiative Goblin 3
!initiative Bandit Captain 2
!startcombat
!turnorder
!next
!endcombat
```

The enemy initiative number is a modifier, not a fixed initiative total. For example, `!initiative Goblin 3` rolls `d20+3`.

## Class Resources

| Command | Usage | What It Does |
| --- | --- | --- |
| View resources | `!resources` | Shows tracked class resources for the active character. |
| Spend resource | `!<resource-command> [amount] [class]` | Spends a class resource and shows the updated resource display. |

Class resource commands are generated from the active character's class resources, so the exact set depends on class, subclass, and level. The amount defaults to `1`.

Common examples:

| Example | What It Does |
| --- | --- |
| `!rage` | Spends 1 Rage. |
| `!wildshape` | Spends 1 Wild Shape. |
| `!secondwind` | Spends 1 Second Wind. |
| `!actionsurge` | Spends 1 Action Surge. |
| `!ki 2` | Spends 2 Ki points. |
| `!layonhands 10` | Spends 10 Lay on Hands points. |
| `!sorcerypoints 3` | Spends 3 Sorcery Points. |
| `!channeldivinity cleric` | Spends 1 Channel Divinity from Cleric. |
| `!channeldivinity 1 paladin` | Spends 1 Channel Divinity from Paladin. |
| `!mysticarcanum6` | Spends the tracked Mystic Arcanum level 6 resource. |

Use the optional class name when multiple classes expose a resource command with the same name.

## Character Builder Website

The project includes a polished character builder that exports the exact JSON shape that `!import` can consume.

| Location | Purpose |
| --- | --- |
| `public/builder/index.html` | Local Express-served builder page. |
| `public/builder/builder.css` | Local builder styles. |
| `public/builder/builder.js` | Local builder behavior. |
| `docs/index.html` | Static GitHub Pages builder page. |
| `docs/builder.css` | Static GitHub Pages builder styles. |
| `docs/builder.js` | Static GitHub Pages builder behavior. |
| `docs/builder-data.json` | Static builder data bundle used by GitHub Pages. |
| `docs/.nojekyll` | Keeps GitHub Pages from running Jekyll processing. |

Builder workflow:

1. Open the builder.
2. Choose character identity, race, class, level, subclass, background, alignment, abilities, skills, feats, spells, inventory, and starting feat setting.
3. Use `Export JSON`.
4. In Discord, send `!import` with the exported JSON file attached.

## Project and Website Commands

These are terminal commands for running and maintaining the repository.

### Install Dependencies

```powershell
npm install
```

Installs Node dependencies from `package.json`.

### Run Bot and Website

```powershell
npm start
```

Runs `node .`, which starts the Express website and logs the Discord bot in when `token` is set in `.env`.

### Run Website Only

```powershell
$env:NO_BOT_LOGIN = "1"
$env:PORT = "3001"
node .
```

Starts the Express website without logging into Discord. The builder will be available at:

```text
http://localhost:3001/builder/
```

If `PORT` is not set, the app uses port `3000`.

### Configure Discord Token

Create or update `.env`:

```text
token=YOUR_DISCORD_BOT_TOKEN
```

The code reads `process.env.token`. Keep the token private and do not commit `.env`.

### Run Import Smoke Test

```powershell
node tests/testImport.js
```

Runs the importer smoke test.

### Run Profile Storage Test

```powershell
node tests/testProfileStorage.js
```

Runs the profile storage test.

## Web Routes and API Endpoints

| Route | Method | What It Does |
| --- | --- | --- |
| `/` | `GET` | Redirects to `/builder`. |
| `/builder` | `GET` | Serves the local builder page from `public/builder/index.html`. |
| `/api/builder-data` | `GET` | Returns data used by the local builder, including classes, races, feats, spells, backgrounds, and items. |
| `/api/builder/normalize-profile` | `POST` | Accepts a profile JSON object, recalculates derived stats, ensures leveling state, and returns the normalized profile. |

The static `docs` version of the builder is for GitHub Pages and uses `docs/builder-data.json` instead of the local API.

## GitHub Pages Hosting

To host the builder as part of the DiceBot repository:

1. Keep the static site files in `docs/`.
2. Commit and push the `docs` folder.
3. Open the repository on GitHub.
4. Go to `Settings > Pages`.
5. Set the source to `Deploy from a branch`.
6. Choose the repository branch, then choose `/docs` as the folder.
7. Save the settings.

GitHub will publish the builder at a URL like:

```text
https://<github-user>.github.io/<repository-name>/
```

For this repository, the important files are already in `docs/`. If builder source data changes later, regenerate or update `docs/builder-data.json` before committing.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| A character command says no imported character exists. | The user has no active saved profile. | Use `!import` with a character JSON attachment, or use `!switchcharacter <name>`. |
| A spell command says the class was not found. | The class name is missing or does not match a spellcasting class on the profile. | Put the class name at the end, such as `!prepare bless cleric`. |
| `!cast` cannot find an active spell. | The spell is not currently prepared or known for that class. | Use `!prepare`, `!learnspell`, or check `!spellbook <class>`. |
| `!shortrest` asks for `dX`. | The character has multiple hit dice pools. | Include the die size, such as `!shortrest 2 d8`. |
| GM commands fail. | The sender does not have the configured GM role. | Add the correct role to the user or update `GM_ROLE_ID` in `index.js`. |
| The web app starts but the bot does not log in. | `NO_BOT_LOGIN=1` is set or `token` is missing. | Unset `NO_BOT_LOGIN` and add `token=...` to `.env`. |
