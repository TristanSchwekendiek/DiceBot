require("dotenv").config();

const express = require("express");
const Discord = require("discord.js");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const GM_ROLE_ID = "1491277829055316039";
const activeCombats = new Map();

const { importCharacterData } = require("./dmvImporter");
const { getBuilderData } = require("./utils/builderData");

const {
  recalculateDerivedStats,
  resetSpellSlots,
  resetLongRestResources,
  resetShortRestResources,
  getHighestSpellSlotLevel,
  getPrimaryClass,
  getTotalCharacterLevel,
} = require("./utils/profileMath");
const {
  getSubclassOptions,
  normalizeName: normalizeDataName,
} = require("./utils/classData");
const {
  addSelectedFeat,
  applyFeatAbilityBonuses,
  checkFeatPrerequisites,
  getFeatAbilityOptions,
  getFeatDefinition,
} = require("./utils/raceFeatData");
const {
  applyAbilityScoreImprovement,
  awardExperience,
  chooseSubclass,
  ensureLevelingState,
  getXpInfo,
} = require("./utils/leveling");
const {
  savePlayerProfile,
  loadPlayerProfile,
  profileExists,
  deletePlayerProfile,
  getPortraitPath,
  deleteExistingPortraits,
  getPortraitFile,
  listCharacterNames,
  setActiveCharacter,
  getActiveCharacterName,
} = require("./utils/profileStorage");



const SKILL_ALIASES = {
  acrobatics: "acrobatics",
  animalhandling: "animal-handling",
  arcana: "arcana",
  athletics: "athletics",
  deception: "deception",
  history: "history",
  insight: "insight",
  intimidation: "intimidation",
  investigation: "investigation",
  medicine: "medicine",
  nature: "nature",
  perception: "perception",
  performance: "performance",
  persuasion: "persuasion",
  religion: "religion",
  sleightofhand: "sleight-of-hand",
  stealth: "stealth",
  survival: "survival",
};

const SPELLS_FILE_PATH = path.join(__dirname, "spells.json");

const app = express();
const bot = new Discord.Client({
  intents: [
    "GUILDS",
    "GUILD_MESSAGES",
    "GUILD_MESSAGE_REACTIONS",
    "MESSAGE_CONTENT",
  ],
});

const PREFIX = "!";
const PORT = Number(process.env.PORT || 3000);

/* -------------------------------- App -------------------------------- */

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.redirect("/builder");
});

app.get("/builder", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "builder", "index.html"));
});

app.get("/api/builder-data", (req, res) => {
  try {
    res.json(getBuilderData());
  } catch (error) {
    console.error("Builder data failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/builder/normalize-profile", (req, res) => {
  try {
    const rawProfile = req.body?.profile || req.body;
    const profile = recalculateDerivedStats(rawProfile);
    ensureLevelingState(profile);
    res.json(profile);
  } catch (error) {
    console.error("Builder profile normalization failed:", error);
    res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Project is running on port ${PORT}!`);
});

/* ------------------------------ Bot Ready ----------------------------- */

bot.on("ready", () => {
  console.log(`Logged in as ${bot.user.tag}`);
});

/* ----------------------------- Commands ------------------------------- */

// Roll Command: !roll 2d6+3 or !roll d20-1
function handleRollCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  const command = message.content.substring(PREFIX.length).trim();
  const cleaned = command.toLowerCase().replace(/\s+/g, "");

  if (!/^(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(cleaned)) {
    return;
  }

  try {
    const result = rollDiceExpression(command);
    const total = result.total;
    const rollString = formatColoredRolls(result.rolledDice);
    const details = command;
    const coloredTotal = `\u001b[1;34m# ${total}\u001b[0m`;

    if (!isNaN(total)) {
      message.channel.send(
        `\`\`\`ansi\n${coloredTotal}\nDetails:[${details} ${rollString}]\`\`\``
      );
    }
  } catch (error) {
    message.channel.send("Invalid dice expression.");
  }
}

function userHasGmRole(message) {
  return message.member?.roles?.cache?.has(GM_ROLE_ID) ?? false;
}

function createEmptyCombat(channelId) {
  return {
    channelId,
    started: false,
    round: 1,
    currentTurnIndex: 0,
    entries: [],
  };
}

function getOrCreateCombat(channelId) {
  if (!activeCombats.has(channelId)) {
    activeCombats.set(channelId, createEmptyCombat(channelId));
  }

  return activeCombats.get(channelId);
}

function sortInitiativeEntries(entries) {
  entries.sort((a, b) => {
    if (a.natural20 && !b.natural20) return -1;
    if (!a.natural20 && b.natural20) return 1;

    if (a.natural1 && !b.natural1) return 1;
    if (!a.natural1 && b.natural1) return -1;

    if (b.total !== a.total) return b.total - a.total;

    if (b.modifier !== a.modifier) return b.modifier - a.modifier;

    return a.name.localeCompare(b.name);
  });
}

function formatInitiativeRoll(roll) {
  if (roll === 1) {
    return `\u001b[1;31m${roll}\u001b[0m`;
  }

  if (roll === 20) {
    return `\u001b[1;32m${roll}\u001b[0m`;
  }

  return `${roll}`;
}

function getCurrentCombatEntry(combat) {
  if (!combat.entries.length) return null;
  return combat.entries[combat.currentTurnIndex] || null;
}

function buildTurnOrderEmbed(combat) {
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle("Initiative Order")
    .setFooter({
      text: combat.started
        ? `Round ${combat.round} • ${combat.entries.length} combatants`
        : `Not started • ${combat.entries.length} combatants`,
    });

  if (!combat.entries.length) {
    embed.setDescription("No combatants have been added yet.");
    return embed;
  }

  const lines = combat.entries.map((entry, index) => {
    const turnMarker =
      combat.started && index === combat.currentTurnIndex ? " ⬅️" : "";
    const sideMarker = entry.type === "player" ? "🟢" : "🔴";
    const natMarker = entry.natural20
      ? " ⭐"
      : entry.natural1
      ? " 💀"
      : "";

    return `${sideMarker} **${entry.name}** — ${entry.total}${natMarker}${turnMarker}`;
  });

  embed.setDescription(lines.join("\n"));

  return embed;
}

async function handleRollInitiativeCommand(message) {
  if (message.content !== `${PREFIX}rollinitiative`) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to start initiative.");
    return;
  }

  const combat = createEmptyCombat(message.channel.id);
  activeCombats.set(message.channel.id, combat);

  await message.channel.send(
    "Combat setup started. Players can now roll with `!initiative`. The GM can add enemies with `!initiative Enemy Name 3`."
  );
}

// Initiative Command: !initiative to roll initiative for the player's character, or !initiative Enemy Name 14 to add an enemy with a specified initiative score
async function handleInitiativeCommand(message) {
  if (!message.content.startsWith(`${PREFIX}initiative`)) return;

  const combat = activeCombats.get(message.channel.id);

  if (!combat) {
    await message.channel.send(
      "No combat setup is active. The GM must use !rollinitiative first."
    );
    return;
  }

  const args = message.content.slice(`${PREFIX}initiative`.length).trim();

  // Player self-roll: !initiative
  if (!args) {
    const profile = loadPlayerProfile(message.author.id);

    if (!profile) {
      await message.channel.send(
        "You do not have an imported character yet. Use !import first."
      );
      return;
    }

    const existingIndex = combat.entries.findIndex(
      (entry) => entry.type === "player" && entry.userId === message.author.id
    );

    const initiativeMod = Number(profile.initiative ?? 0);
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + initiativeMod;

    const entry = {
      type: "player",
      userId: message.author.id,
      name: profile.characterName || message.author.username,
      total,
      roll,
      modifier: initiativeMod,
      natural20: roll === 20,
      natural1: roll === 1,
    };

    if (existingIndex >= 0) {
      combat.entries[existingIndex] = entry;
    } else {
      combat.entries.push(entry);
    }

    sortInitiativeEntries(combat.entries);

    const coloredTotal = `\u001b[1;34m# ${total}\u001b[0m`;
    const coloredRoll = formatInitiativeRoll(roll);

    await message.channel.send(
      `\`\`\`ansi\n${coloredTotal}\nDetails:[${entry.name} initiative (${coloredRoll} ${formatModifier(initiativeMod)})]\`\`\``
    );

    return;
  }

  // GM enemy roll: !initiative Goblin 3
  if (!userHasGmRole(message)) {
    await message.channel.send(
      "Only the GM can use the enemy version of !initiative."
    );
    return;
  }

  const parts = args.split(/\s+/);
  const maybeModifier = parts[parts.length - 1];
  const initiativeMod = parseInt(maybeModifier, 10);
  const enemyName = parts.slice(0, -1).join(" ").trim();

  if (!enemyName || isNaN(initiativeMod)) {
    await message.channel.send(
      "GM usage: !initiative Enemy Name 3"
    );
    return;
  }

  const roll = Math.floor(Math.random() * 20) + 1;
  const total = roll + initiativeMod;

  combat.entries.push({
    type: "enemy",
    userId: null,
    name: enemyName,
    total,
    roll,
    modifier: initiativeMod,
    natural20: roll === 20,
    natural1: roll === 1,
  });

  sortInitiativeEntries(combat.entries);

  const coloredTotal = `\u001b[1;34m# ${total}\u001b[0m`;
  const coloredRoll = formatInitiativeRoll(roll);

  await message.channel.send(
    `\`\`\`ansi\n${coloredTotal}\nDetails:[${enemyName} initiative (${coloredRoll} ${formatModifier(initiativeMod)})]\`\`\``
  );
}

// Start Combat Command: !startcombat to begin the combat after players have rolled initiative and enemies have been added
async function handleStartCombatCommand(message) {
  if (message.content !== `${PREFIX}startcombat`) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to start combat.");
    return;
  }

  const combat = activeCombats.get(message.channel.id);

  if (!combat || combat.entries.length === 0) {
    await message.channel.send("There is no initiative list to start.");
    return;
  }

  sortInitiativeEntries(combat.entries);
  combat.started = true;
  combat.round = 1;
  combat.currentTurnIndex = 0;

  const current = getCurrentCombatEntry(combat);

  await message.channel.send(
    `Top of Round 1.\nIt is now **${current.name}**'s turn.`
  );
}

// Next Turn Command: !next to advance to the next turn in the initiative order
async function handleNextTurnCommand(message) {
  if (message.content !== `${PREFIX}next`) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to advance turns.");
    return;
  }

  const combat = activeCombats.get(message.channel.id);

  if (!combat || !combat.started || combat.entries.length === 0) {
    await message.channel.send("Combat has not started.");
    return;
  }

  combat.currentTurnIndex += 1;

  if (combat.currentTurnIndex >= combat.entries.length) {
    combat.currentTurnIndex = 0;
    combat.round += 1;

    const current = getCurrentCombatEntry(combat);

    await message.channel.send(
      `Top of Round ${combat.round}.\nIt is now **${current.name}**'s turn.`
    );
    return;
  }

  const current = getCurrentCombatEntry(combat);

  await message.channel.send(`It is now **${current.name}**'s turn.`);
}

// Handle turn order command: !turnorder to display the current initiative list and highlight whose turn it is, with initiative rolls colored and natural 20s and 1s specially marked
async function handleTurnOrderCommand(message) {
  if (message.content !== `${PREFIX}turnorder`) return;

  const combat = activeCombats.get(message.channel.id);

  if (!combat) {
    await message.channel.send("There is no active initiative list in this channel.");
    return;
  }

  const embed = buildTurnOrderEmbed(combat);
  await message.channel.send({ embeds: [embed] });
}

function isValidAbility(ability) {
  return ["str", "dex", "con", "int", "wis", "cha"].includes(ability);
}

function getAbilityDisplayName(ability) {
  return ability.toUpperCase();
}

// Set Stat Command: !setstr 18 to set the character's strength score to 18, with similar commands for dex, con, int, wis, and cha
async function handleSetStatCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  const commandBody = message.content.slice(PREFIX.length).trim().toLowerCase();
  const parts = commandBody.split(/\s+/);

  if (parts.length !== 2) return;

  const commandName = parts[0];
  const newValue = parseInt(parts[1], 10);

  const setCommands = {
    setstr: "str",
    setdex: "dex",
    setcon: "con",
    setint: "int",
    setwis: "wis",
    setcha: "cha",
  };

  const ability = setCommands[commandName];

  if (!ability) return;

  if (isNaN(newValue)) {
    await message.channel.send("Please provide a valid number.");
    return;
  }

  if (newValue < 1 || newValue > 30) {
    await message.channel.send("Ability scores must be between 1 and 30.");
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  const oldValue = profile.abilities?.[ability] ?? 10;

  profile.abilities[ability] = newValue;
  profile = recalculateDerivedStats(profile);

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `Set ${profile.characterName}'s ${getAbilityDisplayName(ability)} from ${oldValue} to ${newValue}.`
  );
}

// Mod Stat Command: !modstr 2 to increase the character's strength score by 2, with similar commands for dex, con, int, wis, and cha and negative numbers to decrease the score
async function handleModStatCommand(message) {
  if (!message.content.startsWith(`${PREFIX}modstat`)) return;

  const parts = message.content.trim().split(/\s+/);

  if (parts.length !== 3) {
    await message.channel.send("Usage: !modstat str 2");
    return;
  }

  const ability = parts[1].toLowerCase();
  const amount = parseInt(parts[2], 10);

  if (!isValidAbility(ability)) {
    await message.channel.send("Invalid ability. Use str, dex, con, int, wis, or cha.");
    return;
  }

  if (isNaN(amount)) {
    await message.channel.send("Please provide a valid number.");
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  const oldValue = profile.abilities?.[ability] ?? 10;
  const newValue = oldValue + amount;

  if (newValue < 1 || newValue > 30) {
    await message.channel.send("That change would put the ability score outside the allowed range of 1 to 30.");
    return;
  }

  profile.abilities[ability] = newValue;
  profile = recalculateDerivedStats(profile);

  savePlayerProfile(message.author.id, profile);

  const sign = amount >= 0 ? `+${amount}` : `${amount}`;

  await message.channel.send(
    `Modified ${profile.characterName}'s ${getAbilityDisplayName(ability)} by ${sign}. ${oldValue} -> ${newValue}`
  );
}

// Import Command: !import with attached .json character file
async function handleImportCommand(message) {
  if (message.content !== `${PREFIX}import`) return;

  if (message.attachments.size === 0) {
    await message.channel.send("Please attach a .json character file with !import.");
    return;
  }

  const attachment = message.attachments.first();

  if (!attachment.name.toLowerCase().endsWith(".json")) {
    await message.channel.send("The attached file must be a .json file.");
    return;
  }

  try {
    const response = await fetch(attachment.url);

    if (!response.ok) {
      throw new Error("Could not download the attached file.");
    }

    const rawText = await response.text();
    const rawData = JSON.parse(rawText);

    const profile = importCharacterData(rawData);

    savePlayerProfile(message.author.id, profile);

    await message.channel.send(
      `Imported character: ${profile.characterName}`
    );
  } catch (error) {
    console.error("Import failed:", error);
    await message.channel.send(
      `Import failed: ${error.message}`
    );
  }
}

// Portrait Command: !portrait with attached image file to set character portrait
async function handlePortraitCommand(message) {
  if (message.content !== `${PREFIX}portrait`) return;

  if (!profileExists(message.author.id)) {
    await message.channel.send(
      "You need to import a character first with !import."
    );
    return;
  }

  if (message.attachments.size === 0) {
    await message.channel.send(
      "Please attach an image file with !portrait."
    );
    return;
  }

  const attachment = message.attachments.first();
  const fileName = attachment.name.toLowerCase();

  const validExtensions = [".png", ".jpg", ".jpeg", ".webp"];
  const hasValidExtension = validExtensions.some((ext) => fileName.endsWith(ext));

  if (!hasValidExtension) {
    await message.channel.send(
      "The attached file must be a .png, .jpg, .jpeg, or .webp image."
    );
    return;
  }

  try {
    const response = await fetch(attachment.url);

    if (!response.ok) {
      throw new Error("Could not download the attached image.");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    deleteExistingPortraits(message.author.id);

    const portraitPath = getPortraitPath(message.author.id, attachment.name);
    fs.writeFileSync(portraitPath, buffer);

    await message.channel.send("Character portrait saved.");
  } catch (error) {
    console.error("Portrait upload failed:", error);
    await message.channel.send(`Portrait upload failed: ${error.message}`);
  }
}

// Format modifier
function formatModifier(value) {
  if (value >= 0) {
    return `+${value}`;
  }

  return `${value}`;
}

function handleCheckCommand(message) {
  if (!message.content.startsWith(`${PREFIX}check`)) return;

  const parts = message.content.trim().split(/\s+/);

  if (parts.length < 2) {
    message.channel.send("Usage: !check stealth, !check perception, !check sleight of hand, etc.");
    return;
  }

  const skillInput = parts.slice(1).join("");
  const normalizedSkill = normalizeSkillName(skillInput);
  const skillKey = SKILL_ALIASES[normalizedSkill];

  if (!skillKey) {
    message.channel.send("Invalid skill name.");
    return;
  }

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  const rawBonus = profile.skills?.[skillKey];

  if (rawBonus === undefined || rawBonus === null) {
    message.channel.send("That skill could not be found on your profile.");
    return;
  }

  const skillBonus = parseInt(rawBonus, 10);

  if (isNaN(skillBonus)) {
    message.channel.send("That skill bonus is invalid on your profile.");
    return;
  }

  const roll = Math.floor(Math.random() * 20) + 1;
  const total = roll + skillBonus;

  let coloredRoll = `${roll}`;
  if (roll === 1) {
    coloredRoll = `\u001b[1;31m${roll}\u001b[0m`;
  } else if (roll === 20) {
    coloredRoll = `\u001b[1;32m${roll}\u001b[0m`;
  }

  const coloredTotal = `\u001b[1;34m# ${total}\u001b[0m`;

  message.channel.send(
    `\`\`\`ansi\n${coloredTotal}\nDetails:[${profile.characterName} ${skillKey} check (${coloredRoll} ${formatModifier(skillBonus)})]\`\`\``
  );
}

function rollDiceExpression(expression) {
  const cleaned = expression.toLowerCase().replace(/\s+/g, "");

  if (!/^(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(cleaned)) {
    throw new Error("Invalid dice expression.");
  }

  const parts = cleaned.split(/(?=[+-])/);

  let total = 0;
  let operators = [];
  let values = [];
  let rolledDice = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("+")) operators.push("+");
    if (parts[i].startsWith("-")) operators.push("-");
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].replace(/^[+-]/, "");

    if (!part.includes("d")) {
      values.push(parseInt(part, 10));
      continue;
    }

    let numDice = 1;
    let numSides = 0;

    if (part.startsWith("d")) {
      numSides = parseInt(part.slice(1), 10);
    } else {
      const split = part.split("d");
      numDice = parseInt(split[0], 10);
      numSides = parseInt(split[1], 10);
    }

    let subtotal = 0;

    for (let j = 0; j < numDice; j++) {
      const roll = Math.floor(Math.random() * numSides) + 1;
      rolledDice.push({ value: roll, max: numSides });
      subtotal += roll;
    }

    values.push(subtotal);
  }

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      total += values[i];
    } else {
      if (operators[i - 1] === "+") total += values[i];
      if (operators[i - 1] === "-") total -= values[i];
    }
  }

  return {
    total,
    rolledDice,
    expression: cleaned,
  };
}

function formatColoredRolls(rolledDice) {
  if (!rolledDice.length) return "";

  const colored = rolledDice.map((roll) => {
    if (roll.value === 1) {
      return `\u001b[1;31m${roll.value}\u001b[0m`;
    }
    if (roll.value === roll.max) {
      return `\u001b[1;32m${roll.value}\u001b[0m`;
    }
    return `${roll.value}`;
  });

  return `(${colored.join(" ")})`;
}

function normalizeSkillName(skillText) {
  return skillText.toLowerCase().replace(/[\s_-]/g, "");
}

//Profile Command: !profile to display character info and portrait if uploaded
async function handleProfileCommand(message) {
  if (message.content !== `${PREFIX}profile`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send(
      "You do not have an imported character yet. Use !import with your character JSON first."
    );
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);
  savePlayerProfile(message.author.id, profile);

  const portraitPath = getPortraitFile(message.author.id);

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(profile.characterName || "Unnamed Character")
    .setDescription(
        `**${profile.race || "Unknown Race"}**` +
        `${profile.subrace ? ` (${profile.subrace})` : ""}`
      )
    .addFields(
      {
        name: "Core",
        value:
          `**AC:** ${profile.ac}\n` +
          `**HP:** ${profile.hp.current}/${profile.hp.max}\n` +
          `**Initiative:** +${profile.initiative}\n` +
          `**Passive Perception:** ${profile.passivePerception}\n` +
          `**Proficiency Bonus:** +${profile.proficiencyBonus}`,
        inline: true,
      },
      {
        name: "Identity",
        value:
          `**Player:** ${profile.playerName || "Unknown"}\n` +
          `**Classes (Total Level ${profile.totalLevel || profile.level || 1}):**\n${formatClassList(profile)}\n` +
          `**Alignment:** ${profile.alignment || "Unknown"}\n` +
          `**Background:** ${profile.background || "Unknown"}\n` +
          `**Experience:** ${profile.experience ?? 0}`,
        inline: true,
      },
      {
        name: "Abilities",
        value:
          `**STR** ${profile.abilities.str} (${formatModifier(profile.abilityModifiers.str)})\n` +
          `**DEX** ${profile.abilities.dex} (${formatModifier(profile.abilityModifiers.dex)})\n` +
          `**CON** ${profile.abilities.con} (${formatModifier(profile.abilityModifiers.con)})\n` +
          `**INT** ${profile.abilities.int} (${formatModifier(profile.abilityModifiers.int)})\n` +
          `**WIS** ${profile.abilities.wis} (${formatModifier(profile.abilityModifiers.wis)})\n` +
          `**CHA** ${profile.abilities.cha} (${formatModifier(profile.abilityModifiers.cha)})`,
        inline: true,
      },
      {
        name: "Saving Throws",
        value:
          `**STR** ${formatModifier(profile.savingThrows.str)}\n` +
          `**DEX** ${formatModifier(profile.savingThrows.dex)}\n` +
          `**CON** ${formatModifier(profile.savingThrows.con)}\n` +
          `**INT** ${formatModifier(profile.savingThrows.int)}\n` +
          `**WIS** ${formatModifier(profile.savingThrows.wis)}\n` +
          `**CHA** ${formatModifier(profile.savingThrows.cha)}`,
        inline: true,
      }
    )
    .setFooter({ text: `Character Profile • ${message.author.username}` })
    .setTimestamp();

  if (portraitPath) {
    embed.setThumbnail("attachment://portrait" + require("path").extname(portraitPath));
    await message.channel.send({
      embeds: [embed],
      files: [
        {
          attachment: portraitPath,
          name: "portrait" + require("path").extname(portraitPath),
        },
      ],
    });
  } else {
    await message.channel.send({ embeds: [embed] });
  }
}

// Save Command: !save str/dex/con/int/wis/cha to roll a saving throw using the character's profile
function handleSaveCommand(message) {
  if (!message.content.startsWith(`${PREFIX}save`)) return;

  const parts = message.content.trim().split(/\s+/);
  if (parts.length < 2) {
    message.channel.send("Usage: !save str, !save dex, !save con, !save int, !save wis, or !save cha");
    return;
  }

  const saveType = parts[1].toLowerCase();
  const validSaves = ["str", "dex", "con", "int", "wis", "cha"];

  if (!validSaves.includes(saveType)) {
    message.channel.send("Invalid save type. Use str, dex, con, int, wis, or cha.");
    return;
  }

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  const saveBonus = profile.savingThrows?.[saveType];

  if (typeof saveBonus !== "number") {
    message.channel.send("That saving throw could not be found on your profile.");
    return;
  }

  const roll = Math.floor(Math.random() * 20) + 1;
  const total = roll + saveBonus;

  let coloredRoll = `${roll}`;
  if (roll === 1) {
    coloredRoll = `\u001b[1;31m${roll}\u001b[0m`;
  } else if (roll === 20) {
    coloredRoll = `\u001b[1;32m${roll}\u001b[0m`;
  }

  const coloredTotal = `\u001b[1;34m# ${total}\u001b[0m`;

  message.channel.send(
    `\`\`\`ansi\n${coloredTotal}\nDetails:[${profile.characterName} ${saveType.toUpperCase()} save (${coloredRoll} ${formatModifier(saveBonus)})]\`\`\``
  );
}

// HP Modify Command: !heal or !damage followed by a number or dice expression to modify current HP
function handleHpModifyCommand(message) {
  if (
    !message.content.startsWith(`${PREFIX}heal`) &&
    !message.content.startsWith(`${PREFIX}take`)
  ) {
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  if (parts.length < 2) {
    message.channel.send("Usage: !heal 5, !heal 2d4+2, !damage 7, or !damage 1d8+3");
    return;
  }

  const commandName = parts[0].toLowerCase();
  const amountText = parts.slice(1).join("");
  const isHealing = commandName === `${PREFIX}heal`;

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  try {
    const result = rollDiceExpression(amountText);
    const amount = result.total;

    if (isNaN(amount) || amount < 0) {
      message.channel.send("Invalid amount.");
      return;
    }

    const oldHp = profile.hp.current;

    if (isHealing) {
      profile.hp.current = Math.min(profile.hp.current + amount, profile.hp.max);
    } else {
      profile.hp.current = profile.hp.current - amount;
    }

    savePlayerProfile(message.author.id, profile);

    const coloredTotal = `\u001b[1;34m# ${profile.hp.current}/${profile.hp.max}\u001b[0m`;
    const rollString = formatColoredRolls(result.rolledDice);
    const actionWord = isHealing ? "healed" : "took damage";

    message.channel.send(
      `\`\`\`ansi\n${coloredTotal}\nDetails:[${profile.characterName} ${actionWord} for ${amount} (${amountText}) ${rollString} | HP ${oldHp} -> ${profile.hp.current}]\`\`\``
    );
  } catch (error) {
    message.channel.send("Invalid amount. Use a number or dice expression like 2d4+2.");
  }
}

async function handleEndCombatCommand(message) {
  if (message.content !== `${PREFIX}endcombat`) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to end combat.");
    return;
  }

  if (!activeCombats.has(message.channel.id)) {
    await message.channel.send("There is no active combat in this channel.");
    return;
  }

  activeCombats.delete(message.channel.id);

  await message.channel.send("Combat ended and initiative order cleared.");
}

async function handleRemoveCombatantCommand(message) {
  if (!message.content.startsWith(`${PREFIX}removecombatant`)) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to remove combatants.");
    return;
  }

  const combat = activeCombats.get(message.channel.id);

  if (!combat) {
    await message.channel.send("There is no active combat in this channel.");
    return;
  }

  const targetName = message.content
    .slice(`${PREFIX}removecombatant`.length)
    .trim();

  if (!targetName) {
    await message.channel.send("Usage: !removecombatant name");
    return;
  }

  const indexToRemove = combat.entries.findIndex(
    (entry) => entry.name.toLowerCase() === targetName.toLowerCase()
  );

  if (indexToRemove === -1) {
    await message.channel.send(`Could not find combatant: ${targetName}`);
    return;
  }

  const removedEntry = combat.entries[indexToRemove];

  combat.entries.splice(indexToRemove, 1);

  if (combat.entries.length === 0) {
    activeCombats.delete(message.channel.id);
    await message.channel.send(
      `Removed **${removedEntry.name}**. No combatants remain, so combat has ended.`
    );
    return;
  }

  if (combat.started) {
    if (indexToRemove < combat.currentTurnIndex) {
      combat.currentTurnIndex -= 1;
    } else if (indexToRemove === combat.currentTurnIndex) {
      if (combat.currentTurnIndex >= combat.entries.length) {
        combat.currentTurnIndex = 0;
      }
    }
  } else {
    combat.currentTurnIndex = 0;
  }

  await message.channel.send(`Removed **${removedEntry.name}** from initiative.`);
}

function formatItemName(name) {
  return name
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeItemName(name) {
  return name.toLowerCase().replace(/[\s_-]/g, "");
}

function findInventoryItem(inventory, itemName) {
  const normalizedTarget = normalizeItemName(itemName);

  return inventory.find(
    (item) => normalizeItemName(item.name) === normalizedTarget
  );
}

// Inventory Command: !add item name amount to add items to the character's inventory, creating the inventory if it doesn't exist and incrementing quantity if the item already exists in the inventory
async function handleAddItemCommand(message) {
  if (!message.content.startsWith(`${PREFIX}add`)) return;

  const parts = message.content.trim().split(/\s+/);

  if (parts.length < 3) {
    await message.channel.send("Usage: !add item name amount");
    return;
  }

  const amount = parseInt(parts[parts.length - 1], 10);
  const itemName = parts.slice(1, parts.length - 1).join(" ").trim();

  if (!itemName) {
    await message.channel.send("Please provide an item name.");
    return;
  }

  if (isNaN(amount) || amount <= 0) {
    await message.channel.send("Please provide a valid positive amount.");
    return;
  }

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  if (!Array.isArray(profile.inventory)) {
    profile.inventory = [];
  }

  const existingItem = findInventoryItem(profile.inventory, itemName);

  if (existingItem) {
    existingItem.quantity += amount;
  } else {
    profile.inventory.push({
      name: itemName.toLowerCase().replace(/\s+/g, "-"),
      quantity: amount,
      equipped: false,
      category: "custom",
    });
  }

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `Added ${amount} ${formatItemName(itemName)} to ${profile.characterName}'s inventory.`
  );
}

// Inventory Command: !toss item name amount to remove items from the character's inventory, removing the item entirely if quantity goes to 0 or below
async function handleTossItemCommand(message) {
  if (!message.content.startsWith(`${PREFIX}toss`)) return;

  const parts = message.content.trim().split(/\s+/);

  if (parts.length < 3) {
    await message.channel.send("Usage: !toss item name amount");
    return;
  }

  const amount = parseInt(parts[parts.length - 1], 10);
  const itemName = parts.slice(1, parts.length - 1).join(" ").trim();

  if (!itemName) {
    await message.channel.send("Please provide an item name.");
    return;
  }

  if (isNaN(amount) || amount <= 0) {
    await message.channel.send("Please provide a valid positive amount.");
    return;
  }

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  if (!Array.isArray(profile.inventory)) {
    profile.inventory = [];
  }

  const existingItem = findInventoryItem(profile.inventory, itemName);

  if (!existingItem) {
    await message.channel.send(`${formatItemName(itemName)} was not found in your inventory.`);
    return;
  }

  if (existingItem.quantity < amount) {
    await message.channel.send(
      `${profile.characterName} only has ${existingItem.quantity} ${formatItemName(existingItem.name)}.`
    );
    return;
  }

  existingItem.quantity -= amount;

  if (existingItem.quantity <= 0) {
    profile.inventory = profile.inventory.filter(
      (item) => normalizeItemName(item.name) !== normalizeItemName(itemName)
    );
  }

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `Removed ${amount} ${formatItemName(itemName)} from ${profile.characterName}'s inventory.`
  );
}

// Inventory Command: !inventory to display a list of items in the character's inventory, if any
async function handleInventoryCommand(message) {
  if (message.content !== `${PREFIX}inventory`) return;

  const profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  const inventory = Array.isArray(profile.inventory) ? profile.inventory : [];

  if (inventory.length === 0) {
    await message.channel.send(`${profile.characterName} has no inventory items saved.`);
    return;
  }

  const lines = inventory.map((item) => {
    const equippedText = item.equipped ? " [Equipped]" : "";
    return `${formatItemName(item.name)} x${item.quantity}${equippedText}`;
  });

  const chunks = [];
  const chunkSize = 20;

  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize).join("\n"));
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`${profile.characterName} Inventory`)
    .setDescription("Carried items and equipment")
    .setFooter({ text: `Total Items: ${inventory.length}` });

  chunks.forEach((chunk, index) => {
    embed.addField(
      index === 0 ? "Items" : `Items (${index + 1})`,
      `\`\`\`\n${chunk}\n\`\`\``
    );
  });

  await message.channel.send({ embeds: [embed] });
}

// HP View Command: !hp to display current and max HP, optionally mentioning another user to view their HP if they have a profile
function handleHpViewCommand(message) {
  if (!message.content.startsWith(`${PREFIX}hp`)) return;

  let targetUser = message.author;

  if (message.mentions.users.size > 0) {
    targetUser = message.mentions.users.first();
  }

  const profile = loadPlayerProfile(targetUser.id);

  if (!profile) {
    if (targetUser.id === message.author.id) {
      message.channel.send("You do not have an imported character yet. Use !import first.");
    } else {
      message.channel.send(`${targetUser.username} does not have an imported character.`);
    }
    return;
  }

  const currentHp = profile.hp?.current ?? 0;
  const maxHp = profile.hp?.max ?? 0;
  const coloredTotal = `\u001b[1;34m# ${currentHp}/${maxHp}\u001b[0m`;

  message.channel.send(
    `\`\`\`ansi\n${coloredTotal}\nDetails:[${profile.characterName} HP]\`\`\``
  );
}

function loadSpellsDatabase() {
  const rawText = fs.readFileSync(SPELLS_FILE_PATH, "utf8");
  const data = JSON.parse(rawText);

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.spell)) {
    return data.spell;
  }

  return [];
}

function normalizeSpellName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function formatSpellLevel(level) {
  if (level === 0) return "Cantrip";
  if (level === 1) return "1st Level";
  if (level === 2) return "2nd Level";
  if (level === 3) return "3rd Level";
  return `${level}th Level`;
}

function capitalizeWords(text) {
  return text
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Spell Command: !spell spell name to look up a spell from the spells.json database and display its details in an embed
async function handleSpellCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  const parts = message.content.trim().split(/\s+/);
  const commandName = parts[0].toLowerCase();

  if (commandName !== `${PREFIX}spell`) return;

  const spellName = message.content.slice(`${PREFIX}spell`.length).trim();

  if (!spellName) {
    await message.channel.send("Usage: !spell spell name");
    return;
  }

  try {
    const spells = loadSpellsDatabase();

    const spell = spells.find(
      (s) => normalizeSpellName(s.name) === normalizeSpellName(spellName)
    );

    if (!spell) {
      await message.channel.send(`Spell not found: ${spellName}`);
      return;
    }

    const descriptionText = flattenSpellEntries(spell.entries);
    const descriptionChunks = splitTextIntoChunks(descriptionText);

    const classes = getSpellClasses(spell);
    const concentration = isConcentrationSpell(spell.duration);

    const embed = new Discord.MessageEmbed()
      .setColor("#8B5CF6")
      .setTitle(`✨ ${spell.name}`)
      .setDescription(
        `**${formatSpellLevel(spell.level)} ${capitalizeWords(String(spell.school || "Unknown"))}**`
      )
      .addFields(
        {
          name: "📚 Basics",
          value:
            `**School:** ${capitalizeWords(String(spell.school || "Unknown"))}\n` +
            `**Level:** ${formatSpellLevel(spell.level)}\n` +
            `**Classes:** ${classes.length ? classes.join(", ") : "Unknown"}\n` +
            `**Source:** ${spell.source || "Unknown"}`,
          inline: false,
        },
        {
          name: "⚔️ Casting",
          value:
            `**Casting Time:** ${formatSpellTime(spell.time)}\n` +
            `**Range:** ${formatSpellRange(spell.range)}\n` +
            `**Duration:** ${formatSpellDuration(spell.duration)}\n` +
            `**Components:** ${formatSpellComponents(spell.components)}`,
          inline: false,
        },
        {
          name: "🧠 Properties",
          value:
            `**Concentration:** ${concentration ? "Yes" : "No"}\n` +
            `**Ritual:** ${spell.meta?.ritual ? "Yes" : "No"}`,
          inline: true,
        }
      )
      .setFooter({ text: "Spell Lookup" });

    descriptionChunks.forEach((chunk, index) => {
      embed.addField(
        index === 0 ? "📝 Description" : " ",
        chunk,
        false
      );
    });

    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Spell lookup failed:", error);
    await message.channel.send(`Spell lookup failed: ${error.message}`);
  }
}

function splitTextIntoChunks(text, maxLength = 1024) {
  if (!text) return ["No description available."];

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(" ", maxLength);

    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// Utility function to build the death saving throw track display based on number of successes and failures
function buildDeathSaveTrack(successes, failures) {
  const successIcons = [];
  const failureIcons = [];

  for (let i = 0; i < 3; i++) {
    successIcons.push(i < successes ? "❤️" : "⬛");
  }

  for (let i = 0; i < 3; i++) {
    failureIcons.push(i < failures ? "💀" : "⬛");
  }

  return {
    successes: successIcons.join(" "),
    failures: failureIcons.join(" "),
  };
}

// Death Save Command: !deathsave to roll a death saving throw, tracking successes and failures on the character's profile and displaying results with colored rolls and a visual track of successes and failures
async function handleDeathSaveCommand(message) {
  if (message.content !== `${PREFIX}deathsave`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send(
      "You do not have an imported character yet. Use !import first."
    );
    return;
  }

  if ((profile.hp?.current ?? 0) > 0) {
    await message.channel.send(
      "You can only roll death saves when your HP is 0 or lower."
    );
    return;
  }

  if (!profile.deathSaves) {
    profile.deathSaves = {
      successes: 0,
      failures: 0,
    };
  }

  if (
    profile.deathSaves.successes >= 3 ||
    profile.deathSaves.failures >= 3
  ) {
    await message.channel.send(
      "Your death saves are already complete. Reset them before rolling again."
    );
    return;
  }

  const roll = Math.floor(Math.random() * 20) + 1;

  if (roll === 1) {
    profile.deathSaves.failures = Math.min(profile.deathSaves.failures + 2, 3);
  } else if (roll === 20) {
    profile.deathSaves.successes = Math.min(profile.deathSaves.successes + 2, 3);
  } else if (roll >= 10) {
    profile.deathSaves.successes = Math.min(profile.deathSaves.successes + 1, 3);
  } else {
    profile.deathSaves.failures = Math.min(profile.deathSaves.failures + 1, 3);
  }

  let resultText = "Failure";
  if (roll === 1) {
    resultText = "Natural 1 — two failures";
  } else if (roll === 20) {
    resultText = "Natural 20 — two successes";
  } else if (roll >= 10) {
    resultText = "Success";
  }

  const failedOut = profile.deathSaves.failures >= 3;

  if (profile.deathSaves.successes >= 3) {
    profile.hp.current = 1;
    profile.deathSaves.successes = 0;
    profile.deathSaves.failures = 0;
    resultText += " — stabilized at 1 HP";
  }

  savePlayerProfile(message.author.id, profile);

  const coloredTotal = `\u001b[1;34m# ${roll}\u001b[0m`;
  const coloredRoll = formatInitiativeRoll(roll);
  const track = buildDeathSaveTrack(
    profile.deathSaves.successes,
    profile.deathSaves.failures
  );

  const sentMessage = await message.channel.send(
    `\`\`\`ansi\n${coloredTotal}\nDetails:[${profile.characterName} death save (${coloredRoll}) - ${resultText}]\`\`\`\n` +
      `**Successes:** ${track.successes}\n` +
      `**Failures:** ${track.failures}\n` +
      `**HP:** ${profile.hp.current}/${profile.hp.max}`
  );

  if (failedOut) {
    await sentMessage.react("🇷");
    await sentMessage.react("🇮");
    await sentMessage.react("🇵");
  }
}

// Res Command: !res @player to reset a downed character's death saves and stabilize them at 1 HP, requires GM role
async function handleResCommand(message) {
  if (!message.content.startsWith(`${PREFIX}res`)) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to use this command.");
    return;
  }

  if (message.mentions.users.size === 0) {
    await message.channel.send("Usage: !res @player");
    return;
  }

  const targetUser = message.mentions.users.first();
  let profile = loadPlayerProfile(targetUser.id);

  if (!profile) {
    await message.channel.send(`${targetUser.username} does not have an imported character.`);
    return;
  }

  if (!profile.deathSaves) {
    profile.deathSaves = {
      successes: 0,
      failures: 0,
    };
  }

  profile.deathSaves.successes = 0;
  profile.deathSaves.failures = 0;
  profile.hp.current = Math.max(profile.hp.current, 1);

  savePlayerProfile(targetUser.id, profile);

  await message.channel.send(
    `${profile.characterName} has been stabilized at 1 HP.`
  );
}

// Fail Death Save Command: !faildeathsave @player to apply a failed death save to a downed character, requires GM role
async function handleFailDeathSaveCommand(message) {
  if (!message.content.startsWith(`${PREFIX}faildeathsave`)) return;

  if (!userHasGmRole(message)) {
    await message.channel.send("You do not have permission to use this command.");
    return;
  }

  if (message.mentions.users.size === 0) {
    await message.channel.send("Usage: !faildeathsave @player");
    return;
  }

  const targetUser = message.mentions.users.first();
  let profile = loadPlayerProfile(targetUser.id);

  if (!profile) {
    await message.channel.send(`${targetUser.username} does not have an imported character.`);
    return;
  }

  if ((profile.hp?.current ?? 0) > 0) {
    await message.channel.send(
      `${profile.characterName} is above 0 HP and cannot fail a death save.`
    );
    return;
  }

  if (!profile.deathSaves) {
    profile.deathSaves = {
      successes: 0,
      failures: 0,
    };
  }

  if (profile.deathSaves.failures >= 3) {
    await message.channel.send(`${profile.characterName} already has 3 failed death saves.`);
    return;
  }

  profile.deathSaves.failures = Math.min(profile.deathSaves.failures + 1, 3);

  savePlayerProfile(targetUser.id, profile);

  const track = buildDeathSaveTrack(
    profile.deathSaves.successes,
    profile.deathSaves.failures
  );

  const sentMessage = await message.channel.send(
    `${profile.characterName} failed 1 death save.\n` +
    `**Successes:** ${track.successes}\n` +
    `**Failures:** ${track.failures}\n` +
    `**HP:** ${profile.hp.current}/${profile.hp.max}`
  );

  if (profile.deathSaves.failures >= 3) {
    await sentMessage.react("🇷");
    await sentMessage.react("🇮");
    await sentMessage.react("🇵");
  }
}

function buildSpellSlotLine(current, max) {
  const greenSquares = Array.from({ length: current }, () => "🟩");
  const blackSquares = Array.from({ length: Math.max(max - current, 0) }, () => "⬛");
  return [...greenSquares, ...blackSquares].join(" ");
}

function buildSpellSlotsEmbed(profile, titleText = null) {
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(titleText || `${profile.characterName} Spell Slots`)
    .setDescription(
      `**${profile.class || "Unknown Class"}** • Level ${profile.level || 1}`
    );

  const maxSlots = profile.spellSlots?.max || {};
  const currentSlots = profile.spellSlots?.current || {};
  const slotLevels = Object.keys(maxSlots)
    .map(Number)
    .sort((a, b) => a - b);

  if (slotLevels.length === 0) {
    embed.addField("Spell Slots", "This character has no spell slots.", false);
    return embed;
  }

  for (const slotLevel of slotLevels) {
    const max = Number(maxSlots[slotLevel] ?? 0);
    const current = Number(currentSlots[slotLevel] ?? 0);

    embed.addField(
      `Level ${slotLevel}`,
      `${buildSpellSlotLine(current, max)}\n${current}/${max}`,
      false
    );
  }

  return embed;
}


async function handleLongRestCommand(message) {
  if (message.content !== `${PREFIX}longrest`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile.hp.current = profile.hp.max;

  if (!profile.deathSaves) {
    profile.deathSaves = { successes: 0, failures: 0 };
  } else {
    profile.deathSaves.successes = 0;
    profile.deathSaves.failures = 0;
  }

  profile = resetSpellSlots(profile);
  profile = resetLongRestResources(profile);
  profile = recalculateDerivedStats(profile);
  const recovered = Math.max(1, Math.floor(profile.hitDice.max / 2));
    profile.hitDice.current = Math.min(
    profile.hitDice.current + recovered,
    profile.hitDice.max
    );

      if (Array.isArray(profile.hitDice?.pools)) {
    profile.hitDice.pools = profile.hitDice.pools.map((pool) => ({
      ...pool,
      current: pool.max,
    }));
  }

  savePlayerProfile(message.author.id, profile);

  const spellEmbed = buildSpellSlotsEmbed(
    profile,
    `${profile.characterName} Finished a Long Rest`
  ).addField("Health", `${profile.hp.current}/${profile.hp.max}`, false);

  const resourceEntries = Object.entries(profile.classResources || {});
  if (resourceEntries.length) {
    spellEmbed.addField(
      "Class Resources",
      resourceEntries
        .map(([, resource]) => `${resource.emoji} ${resource.label}: ${resource.current}/${resource.max}`)
        .join("\n"),
      false
    );
  }

  await message.channel.send({ embeds: [spellEmbed] });
}

function buildResourceBar(current, max) {
  const safeMax = Math.max(0, Number(max ?? 0));
  const safeCurrent = Math.max(0, Number(current ?? 0));

  const filled = Array.from({ length: safeCurrent }, () => "🟩");
  const empty = Array.from({ length: Math.max(safeMax - safeCurrent, 0) }, () => "⬛");

  if (safeMax === 0) return "None";

  return [...filled, ...empty].join(" ");
}

function buildClassResourcesEmbed(profile, titleText = null) {
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(titleText || `${profile.characterName} Class Resources`)
    .setDescription(`Total Level ${profile.totalLevel || profile.level || 1}`);

  const classBlocks = Object.values(profile.classResourcesByClass || {});

  if (!classBlocks.length) {
    embed.addField("Resources", "This character has no tracked class resources.", false);
    return embed;
  }

  let foundAny = false;

  for (const classBlock of classBlocks) {
    const resourceEntries = Object.values(classBlock.resources || {});

    if (!resourceEntries.length) continue;

    foundAny = true;

    const lines = resourceEntries.map(
      (resource) =>
        `${resource.emoji} **${resource.label}**\n${buildResourceBar(resource.current, resource.max)}\n${resource.current}/${resource.max}`
    );

    embed.addField(classBlock.className, lines.join("\n\n"), false);
  }

  if (!foundAny) {
    embed.addField("Resources", "This character has no tracked class resources.", false);
  }

  return embed;
}

async function useClassResource(message, resourceCommand, amount = 1, specifiedClassName = null) {
  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const resolved = resolveResourceClass(profile, resourceCommand, specifiedClassName);

  if (!resolved) {
    await message.channel.send(
      `${profile.characterName} does not have that class resource.`
    );
    return;
  }

  const { className, resourceKey, resource } = resolved;
  const spendAmount = Number(amount ?? 1);

  if (isNaN(spendAmount) || spendAmount <= 0) {
    await message.channel.send("Please provide a valid positive amount.");
    return;
  }

  if (resource.current < spendAmount) {
    await message.channel.send(
      `${profile.characterName} only has ${resource.current}/${resource.max} ${resource.label} remaining for ${className}.`
    );
    return;
  }

  resource.current -= spendAmount;

  savePlayerProfile(message.author.id, profile);

  const embed = buildClassResourcesEmbed(
    profile,
    `${resource.emoji} ${profile.characterName} used ${spendAmount} ${resource.label} (${className})`
  );

  await message.channel.send({ embeds: [embed] });
}


async function handleResourcesCommand(message) {
  if (message.content !== `${PREFIX}resources`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const embed = buildClassResourcesEmbed(profile);
  await message.channel.send({ embeds: [embed] });
}

async function handleGenericClassResourceCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) return;

  profile = recalculateDerivedStats(profile);

  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = parts[0]?.toLowerCase();

  if (!commandName) return;

  const allEntries = getAllClassResourceEntries(profile);
  const matchingResources = allEntries.filter(
    (entry) => normalizeName(entry.resource.command) === normalizeName(commandName)
  );

  if (!matchingResources.length) return;

  const rawArgs = parts.slice(1).join(" ");
  const parsed = parseResourceAmountAndClass(rawArgs, profile);

  await useClassResource(
    message,
    commandName,
    parsed.amount,
    parsed.className
  );
}

function rollHitDice(dieSize, count, conMod) {
  let totalHealing = 0;
  const rolls = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.floor(Math.random() * dieSize) + 1;
    const heal = Math.max(roll + conMod, 0);

    rolls.push({
      roll,
      heal,
      max: dieSize,
    });

    totalHealing += heal;
  }

  return {
    totalHealing,
    rolls,
  };
}

function formatHitDieRolls(rolls, conMod) {
  return rolls
    .map((entry) => {
      let coloredRoll = `${entry.roll}`;

      if (entry.roll === 1) {
        coloredRoll = `\u001b[1;31m${entry.roll}\u001b[0m`;
      } else if (entry.roll === entry.max) {
        coloredRoll = `\u001b[1;32m${entry.roll}\u001b[0m`;
      }

      return `${coloredRoll}${formatModifier(conMod)}`;
    })
    .join(", ");
}

// Short Rest Command: !shortrest amount to spend hit dice and heal, requires an imported character with hit dice, displays results with colored rolls and remaining hit dice
async function handleShortRestCommand(message) {
  if (!message.content.startsWith(`${PREFIX}shortrest`)) return;

  const parts = message.content.trim().split(/\s+/);

  if (parts.length < 2) {
    await message.channel.send("Usage: !shortrest 2 [d8]");
    return;
  }

  const amount = parseInt(parts[1], 10);
  const requestedDieArg = parts[2] ? parts[2].toLowerCase() : null;

  if (isNaN(amount) || amount <= 0) {
    await message.channel.send("Please provide a valid positive number of hit dice.");
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const pools = Array.isArray(profile.hitDice?.pools) ? profile.hitDice.pools : [];
  const conMod = Number(profile.abilityModifiers?.con ?? 0);

  if (!pools.length) {
    await message.channel.send(`${profile.characterName} has no tracked hit dice.`);
    return;
  }

  let targetPool = null;

  if (requestedDieArg) {
    const requestedDieSize = parseInt(requestedDieArg.replace(/^d/i, ""), 10);

    targetPool = pools.find(
      (pool) => Number(pool.dieSize) === requestedDieSize
    );

    if (!targetPool) {
      await message.channel.send(
        `${profile.characterName} does not have any d${requestedDieSize} hit dice.`
      );
      return;
    }
  } else {
    if (pools.length > 1) {
      const choices = pools
        .map((pool) => `d${pool.dieSize} (${pool.current}/${pool.max})`)
        .join(", ");

      await message.channel.send(
        `This character has multiple hit dice pools. Use !shortrest ${amount} dX\nAvailable: ${choices}`
      );
      return;
    }

    targetPool = pools[0];
  }

  const currentHitDice = Number(targetPool.current ?? 0);
  const dieSize = Number(targetPool.dieSize ?? 0);

  if (currentHitDice <= 0) {
    await message.channel.send(
      `${profile.characterName} has no d${dieSize} hit dice remaining.`
    );
    return;
  }

  if (amount > currentHitDice) {
    await message.channel.send(
      `${profile.characterName} only has ${currentHitDice} d${dieSize} hit dice remaining.`
    );
    return;
  }

  const oldHp = Number(profile.hp.current ?? 0);
  const maxHp = Number(profile.hp.max ?? 0);

  const result = rollHitDice(dieSize, amount, conMod);

  profile.hp.current = Math.min(profile.hp.current + result.totalHealing, maxHp);
  targetPool.current -= amount;

  profile = resetShortRestResources(profile);
  profile = recalculateDerivedStats(profile);

  const updatedPool = profile.hitDice.pools.find(
    (pool) => Number(pool.dieSize) === dieSize
  );

  savePlayerProfile(message.author.id, profile);

  const coloredTotal = `\u001b[1;34m# ${profile.hp.current}/${profile.hp.max}\u001b[0m`;
  const rollDetails = formatHitDieRolls(result.rolls, conMod);

  const embed = buildClassResourcesEmbed(
    profile,
    `${profile.characterName} Finished a Short Rest`
  )
    .addField(
      "Healing",
      `\`\`\`ansi\n${coloredTotal}\nDetails:[Spent ${amount}d${dieSize} | ${rollDetails} | HP ${oldHp} -> ${profile.hp.current}]\`\`\``,
      false
    )
    .addField(
      "Hit Dice",
      profile.hitDice.pools
        .map((pool) => `d${pool.dieSize}: ${pool.current}/${pool.max}`)
        .join("\n"),
      false
    );

  await message.channel.send({ embeds: [embed] });
}

function getProfileSpellClass(profile) {
  return String(profile.class || "").toLowerCase().trim();
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getAvailableSpellsForProfile(profile) {
  const spells = loadSpellsDatabase();
  const className = getProfileSpellClass(profile);
  const highestLevel = getHighestSpellSlotLevel(profile);

  return spells.filter((spell) => {
    const spellClasses = Array.isArray(spell.classes.fromClassList)
      ? spell.classes.fromClassList.map((c) => String(c.name).toLowerCase())
      : [];

    if (!spellClasses.includes(className)) {
      return false;
    }

    if (Number(spell.level ?? 0) === 0) {
      return true;
    }

    return Number(spell.level ?? 0) <= highestLevel;
  });
}

async function handleAvailableSpellsCommand(message) {
  if (!message.content.startsWith(`${PREFIX}availablespells`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const rawArg = message.content.slice(`${PREFIX}availablespells`.length).trim();

  if (!rawArg) {
    const entries = Object.values(profile.spellcastingByClass || {});
    const embed = new Discord.MessageEmbed()
      .setColor("#8B5CF6")
      .setTitle(`${profile.characterName} Available Spells`);

    if (!entries.length) {
      embed.setDescription("No spellcasting classes found.");
      await message.channel.send({ embeds: [embed] });
      return;
    }

    for (const entry of entries) {
      const availableSpells = getAvailableSpellsForClass(profile, entry.className);
      embed.addField(
        entry.className,
        `${availableSpells.length} available spells`,
        true
      );
    }

    embed.setFooter({ text: "Use !availablespells <class>" });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  const classEntry = resolveSpellcastingClass(profile, rawArg);

  if (!classEntry) {
    await message.channel.send(`No spellcasting class found matching **${rawArg}**.`);
    return;
  }

  const availableSpells = getAvailableSpellsForClass(profile, classEntry.className);

  if (!availableSpells.length) {
    await message.channel.send(
      `${profile.characterName} has no available spells for ${classEntry.className}.`
    );
    return;
  }

  const grouped = {};

  for (const spell of availableSpells) {
    const level = Number(spell.level ?? 0);
    if (!grouped[level]) grouped[level] = [];
    grouped[level].push(spell.name);
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#8B5CF6")
    .setTitle(`${profile.characterName} Available ${classEntry.className} Spells`);

  const levels = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  for (const level of levels) {
    const names = grouped[level].sort((a, b) => a.localeCompare(b));
    const label = level === 0 ? "Cantrips" : `Level ${level}`;
    const chunks = splitTextIntoChunks(names.join(", "), 1024);

    chunks.forEach((chunk, index) => {
      embed.addField(
        index === 0 ? label : `${label} (Cont.)`,
        chunk,
        false
      );
    });
  }

  await message.channel.send({ embeds: [embed] });
}


// Prepare Spell Command: !prepare spell name to prepare a spell for a character using the prepared spellcasting system, requires an imported character with prepared spellcasting, displays remaining prepared spells and total limit
async function handlePrepareSpellCommand(message) {
  if (!message.content.startsWith(`${PREFIX}prepare`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}prepare`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !prepare spell name class");
    return;
  }

  const { spellName, classEntry } = parseSpellAndClassFromEnd(rawArg, profile);

  if (!classEntry) {
    await message.channel.send("Usage: !prepare spell name class");
    return;
  }

  const classSpellcasting = getSpellcastingEntry(profile, classEntry.className);

  if (!classSpellcasting) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  if (classSpellcasting.mode !== "prepared" && classSpellcasting.mode !== "spellbook") {
    await message.channel.send(
      `${classEntry.className} is not using the prepared-spell system.`
    );
    return;
  }

  let availableSpells = [];

  if (classSpellcasting.mode === "prepared") {
    availableSpells = getAvailableSpellsForClass(profile, classEntry.className);
  } else {
    availableSpells = (classSpellcasting.knownSpells || [])
      .map((name) => getSpellByName(name))
      .filter(Boolean);
  }

  const match = availableSpells.find(
    (spell) => normalizeName(spell.name) === normalizeName(spellName)
  );

  if (!match) {
    await message.channel.send(
      `${spellName} is not available for ${classEntry.className}.`
    );
    return;
  }

  const prepared = classSpellcasting.preparedSpells || [];
  const alreadyPrepared = prepared.some(
    (name) => normalizeName(name) === normalizeName(match.name)
  );

  if (alreadyPrepared) {
    await message.channel.send(`${match.name} is already prepared for ${classEntry.className}.`);
    return;
  }

  const preparedLimit = Number(classSpellcasting.preparedLimit ?? 0);

  if (prepared.length >= preparedLimit) {
    await message.channel.send(
      `${classEntry.className} already has ${prepared.length}/${preparedLimit} spells prepared.`
    );
    return;
  }

  classSpellcasting.preparedSpells.push(match.name);
  classSpellcasting.preparedSpells = sortSpellNamesByLevel(classSpellcasting.preparedSpells);

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `${profile.characterName} prepared **${match.name}** for **${classEntry.className}**. (${classSpellcasting.preparedSpells.length}/${preparedLimit})`
  );
}

// Spellbook Command: !spellbook to display the character's spellbook or list of prepared/known spells based on their spellcasting mode, requires an imported character with spellcasting, displays spells in an embed with pagination if needed
async function handleSpellbookCommand(message) {
  if (!message.content.startsWith(`${PREFIX}spellbook`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const rawArg = message.content.slice(`${PREFIX}spellbook`.length).trim();

  if (!rawArg) {
    const embed = new Discord.MessageEmbed()
      .setColor("#8B5CF6")
      .setTitle(`📖 ${profile.characterName} Spellbooks`);

    const entries = Object.values(profile.spellcastingByClass || {});

    if (!entries.length) {
      embed.setDescription("No spellcasting classes found.");
      await message.channel.send({ embeds: [embed] });
      return;
    }

    for (const entry of entries) {
      let spellList = [];

      if (entry.mode === "prepared") {
        spellList = entry.preparedSpells || [];
      } else if (entry.mode === "known" || entry.mode === "spellbook") {
        spellList = entry.knownSpells || [];
      }

      const summary =
        entry.mode === "prepared"
          ? `Prepared ${spellList.length}/${entry.preparedLimit}`
          : `${spellList.length} stored spells`;

      embed.addField(entry.className, summary, true);
    }

    embed.setFooter({ text: "Use !spellbook <class>" });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  const classEntry = resolveSpellcastingClass(profile, rawArg);

  if (!classEntry) {
    await message.channel.send(`No spellcasting class found matching **${rawArg}**.`);
    return;
  }

  const spellcastingEntry = getSpellcastingEntry(profile, classEntry.className);

  if (!spellcastingEntry) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  let spellList = [];
  let subtitle = `Mode: ${spellcastingEntry.mode}`;

  if (spellcastingEntry.mode === "prepared") {
    spellList = spellcastingEntry.preparedSpells || [];
    subtitle += ` • Prepared ${spellList.length}/${spellcastingEntry.preparedLimit}`;
  } else if (spellcastingEntry.mode === "known") {
    spellList = spellcastingEntry.knownSpells || [];
    subtitle += " • Known Spells";
  } else if (spellcastingEntry.mode === "spellbook") {
    spellList = spellcastingEntry.knownSpells || [];
    subtitle += " • Wizard Spellbook";
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#8B5CF6")
    .setTitle(`📖 ${profile.characterName} ${classEntry.className} Spellbook`)
    .setDescription(subtitle);

  if (!spellList.length) {
    embed.addField("Spells", "No spells stored yet.", false);
    await message.channel.send({ embeds: [embed] });
    return;
  }

  const lines = buildSpellListLines(spellList);
  const chunks = splitTextIntoChunks(lines.join("\n"), 1024);

  chunks.forEach((chunk, index) => {
    embed.addField(index === 0 ? "Spells" : "Spells (Cont.)", chunk, false);
  });

  await message.channel.send({ embeds: [embed] });
}

function formatSpellTime(timeArray) {
  if (!Array.isArray(timeArray) || timeArray.length === 0) {
    return "Unknown";
  }

  return timeArray
    .map((entry) => {
      if (!entry) return "Unknown";
      const number = entry.number ?? "";
      const unit = entry.unit ?? "";
      return `${number} ${capitalizeWords(String(unit))}`.trim();
    })
    .join(", ");
}

function formatSpellRange(range) {
  if (!range) return "Unknown";

  if (typeof range === "string") return range;

  if (range.type === "point" && range.distance) {
    if (range.distance.type === "touch") return "Touch";
    if (range.distance.type === "self") return "Self";
    if (range.distance.type === "sight") return "Sight";
    if (range.distance.amount !== undefined && range.distance.type) {
      return `${range.distance.amount} ${capitalizeWords(String(range.distance.type))}`;
    }
  }

  if (range.type === "radius" && range.distance) {
    if (range.distance.amount !== undefined && range.distance.type) {
      return `${range.distance.amount}-foot radius`;
    }
  }

  if (range.type === "self") return "Self";

  return capitalizeWords(String(range.type || "Unknown"));
}

function formatSpellComponents(components) {
  if (!components || typeof components !== "object") {
    return "Unknown";
  }

  const result = [];

  if (components.v) result.push("V");
  if (components.s) result.push("S");
  if (components.m) {
    if (typeof components.m === "string") {
      result.push(`M (${components.m})`);
    } else {
      result.push("M");
    }
  }

  return result.length ? result.join(", ") : "None";
}

function formatSpellDuration(durationArray) {
  if (!Array.isArray(durationArray) || durationArray.length === 0) {
    return "Unknown";
  }

  return durationArray
    .map((entry) => {
      if (!entry) return "Unknown";

      if (entry.type === "instant") {
        return "Instantaneous";
      }

      if (entry.type === "permanent") {
        return "Permanent";
      }

      if (entry.type === "timed" && entry.duration) {
        const amount = entry.duration.amount ?? "";
        const unit = entry.duration.type ?? "";
        const base = `${amount} ${capitalizeWords(String(unit))}`.trim();

        if (entry.concentration) {
          return `Concentration, up to ${base}`;
        }

        return base;
      }

      return capitalizeWords(String(entry.type || "Unknown"));
    })
    .join(", ");
}

function isConcentrationSpell(durationArray) {
  if (!Array.isArray(durationArray)) return false;
  return durationArray.some((entry) => entry?.concentration === true);
}

function getSpellClasses(spell) {
  const classEntries = spell?.classes?.fromClassList || [];
  return classEntries.map((entry) => entry.name).filter(Boolean);
}

function flattenSpellEntries(entries) {
  if (!Array.isArray(entries)) {
    return "No description available.";
  }

  const lines = [];

  function walk(entry) {
    if (typeof entry === "string") {
        lines.push(cleanSpellText(entry));
        return;
    }

    if (entry && typeof entry === "object") {
      if (entry.name && Array.isArray(entry.entries)) {
        lines.push(`**${cleanSpellText(entry.name)}**`);
        entry.entries.forEach(walk);
        return;
      }

      if (Array.isArray(entry.entries)) {
        entry.entries.forEach(walk);
      }
    }
  }

  entries.forEach(walk);

  return lines.length ? lines.join("\n") : "No description available.";
}

function cleanSpellText(text) {
  if (!text) return "No description available.";

  return String(text)
    .replace(/\{@dice ([^}]+)\}/g, "**$1**")
    .replace(/\{@damage ([^}]+)\}/g, "**$1**")
    .replace(/\{@hit ([^}]+)\}/g, "$1")
    .replace(/\{@dc ([^}]+)\}/g, "$1")
    .replace(/\{@spell ([^}]+)\}/g, "$1")
    .replace(/\{@condition ([^}]+)\}/g, "$1")
    .replace(/\{@creature ([^}]+)\}/g, "$1")
    .replace(/\{@status ([^}]+)\}/g, "$1")
    .replace(/\{@item ([^}]+)\}/g, "$1")
    .replace(/\{@filter ([^|}]+)\|[^}]*\}/g, "$1")
    .replace(/\{@([^ }]+) ([^}]+)\}/g, "$2");
}

function getSpellLevelEmoji(level) {
  const emojis = {
    0: "🥫",
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣",
  };

  return emojis[level] || "❓";
}

function getSpellDetailsByName(spellName) {
  const spells = loadSpellsDatabase();
  return spells.find(
    (spell) => normalizeSpellName(spell.name) === normalizeSpellName(spellName)
  );
}

function sortSpellNamesByLevel(spellNames) {
  return [...spellNames].sort((a, b) => {
    const spellA = getSpellDetailsByName(a);
    const spellB = getSpellDetailsByName(b);

    const levelA = spellA ? Number(spellA.level ?? 0) : 99;
    const levelB = spellB ? Number(spellB.level ?? 0) : 99;

    if (levelA !== levelB) {
      return levelA - levelB;
    }

    return a.localeCompare(b);
  });
}

function buildSpellListLines(spellNames) {
  const sorted = sortSpellNamesByLevel(spellNames);

  return sorted.map((spellName) => {
    const spell = getSpellDetailsByName(spellName);
    const level = spell ? Number(spell.level ?? 0) : 99;
    return `${getSpellLevelEmoji(level)} ${spellName}`;
  });
}

function formatFeatureListLines(features) {
  return features.map((feature) =>
    Number(feature.level ?? 0) > 0
      ? `Level ${feature.level}: ${feature.name}`
      : feature.name
  );
}

function isAbilityScoreImprovementFeature(feature) {
  return normalizeDataName(feature?.name) === "ability score improvement";
}

function getClassDisplayFeatures(profile) {
  return (profile.characterFeatures || []).filter(
    (feature) => !isAbilityScoreImprovementFeature(feature)
  );
}

function getAllDisplayFeatures(profile) {
  return [
    ...getClassDisplayFeatures(profile),
    ...(profile.racialFeatures || []),
    ...(profile.selectedFeatFeatures || []),
  ];
}

function findCharacterFeature(profile, featureName) {
  const nonAsiFeatures = getAllDisplayFeatures(profile);
  const normalizedQuery = normalizeDataName(featureName);

  const exact = nonAsiFeatures.find(
    (feature) => normalizeDataName(feature.name) === normalizedQuery
  );

  if (exact) {
    return { feature: exact, matches: [exact] };
  }

  const partialMatches = nonAsiFeatures.filter((feature) =>
    normalizeDataName(feature.name).includes(normalizedQuery)
  );

  return {
    feature: partialMatches.length === 1 ? partialMatches[0] : null,
    matches: partialMatches,
  };
}

function buildLevelUpEmbed(profile, summary) {
  const embed = new Discord.MessageEmbed()
    .setColor("#22C55E")
    .setTitle(`${profile.characterName} reached Level ${summary.level} ${summary.className}`)
    .setDescription(`HP increased by ${summary.hpGain}.`);

  if (summary.proficiencyChanged) {
    embed.addField(
      "Proficiency Bonus",
      `Now +${summary.proficiencyBonus}`,
      false
    );
  }

  if (Array.isArray(summary.gainedFeatures) && summary.gainedFeatures.length) {
    embed.addField(
      "Gained Features",
      splitTextIntoChunks(
        summary.gainedFeatures.map((feature) => feature.name).join(", "),
        1024
      )[0],
      false
    );
  }

  if (Number(summary.gainedAsiCount ?? 0) > 0) {
    embed.addField(
      "Ability Score Improvement",
      `${summary.gainedAsiCount * 2} point(s) gained. Use \`!asi\` to assign them.`,
      false
    );
  }

  if (Array.isArray(summary.spellcastingChanges) && summary.spellcastingChanges.length) {
    embed.addField("Spellcasting", summary.spellcastingChanges.join("\n"), false);
  }

  if (summary.subclassPending) {
    const options = (summary.subclassOptions || []).map((option) => option.name);
    embed.addField(
      "Subclass Choice",
      options.length
        ? `Choose with \`!choosesubclass name\`.\n${splitTextIntoChunks(options.join(", "), 900)[0]}`
        : "Choose with `!choosesubclass name`.",
      false
    );
  }

  if (
    Number(summary.pendingAsiPoints ?? 0) >
    Number(summary.gainedAsiCount ?? 0) * 2
  ) {
    embed.addField(
      "Pending ASI",
      `${summary.pendingAsiPoints} point(s) pending. Use \`!asi\` to assign them.`,
      false
    );
  }

  return embed;
}

function parseAsiAdjustments(rawArgs) {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return {};
  }

  const adjustments = {};
  let index = 0;

  while (index < parts.length) {
    const ability = parts[index].toLowerCase();
    const nextPart = parts[index + 1];
    let amount = 1;

    if (nextPart && /^\d+$/.test(nextPart)) {
      amount = parseInt(nextPart, 10);
      index += 2;
    } else {
      index += 1;
    }

    adjustments[ability] = (adjustments[ability] || 0) + amount;
  }

  return adjustments;
}

function parseFeatSelectionArgs(rawArgs, featDefinition = null) {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return {
      featName: "",
      chosenAbility: null,
    };
  }

  const last = parts[parts.length - 1].toLowerCase();
  const isAbility = ["str", "dex", "con", "int", "wis", "cha"].includes(last);

  if (isAbility) {
    const fallbackFeatName = parts.slice(0, -1).join(" ").trim();
    const resolvedFeat = featDefinition || getFeatDefinition(fallbackFeatName);

    if (resolvedFeat) {
      const abilityOptions = getFeatAbilityOptions(resolvedFeat);
      if (abilityOptions.choose.length > 0) {
        return {
          featName: fallbackFeatName,
          chosenAbility: last,
        };
      }
    }
  }

  return {
    featName: rawArgs.trim(),
    chosenAbility: null,
  };
}

function applyFeatSelectionFromAsi(profile, rawArgs) {
  if (profile.pendingAsiPoints < 2) {
    return {
      success: false,
      message: `${profile.characterName} needs 2 pending ASI points to select a feat.`,
      profile,
    };
  }

  const initialDefinition = getFeatDefinition(rawArgs);
  const parsed = parseFeatSelectionArgs(rawArgs, initialDefinition);
  const feat = getFeatDefinition(parsed.featName);

  if (!feat) {
    return {
      success: false,
      message: `Feat not found: ${parsed.featName || rawArgs}`,
      profile,
    };
  }

  if (normalizeDataName(feat.name) === "ability score improvement") {
    return {
      success: false,
      message: "Use `!asi` with abilities directly for a normal Ability Score Improvement.",
      profile,
    };
  }

  const alreadySelected = (profile.selectedFeats || []).some(
    (selectedFeat) => normalizeDataName(selectedFeat.name) === normalizeDataName(feat.name)
  );

  if (alreadySelected) {
    return {
      success: false,
      message: `${profile.characterName} already has ${feat.name}.`,
      profile,
    };
  }

  const prerequisiteCheck = checkFeatPrerequisites(profile, feat);
  if (!prerequisiteCheck.eligible) {
    return {
      success: false,
      message: `${profile.characterName} does not meet the prerequisites for ${feat.name}.`,
      profile,
    };
  }

  const appliedAbilityResult = applyFeatAbilityBonuses(profile, feat, parsed.chosenAbility);
  if (!appliedAbilityResult.success) {
    return {
      success: false,
      message: appliedAbilityResult.message,
      profile,
    };
  }

  addSelectedFeat(profile, feat, {
    chosenAbility: parsed.chosenAbility,
  });

  profile.pendingAsiPoints -= 2;
  profile = recalculateDerivedStats(profile);

  return {
    success: true,
    message: `${profile.characterName} selected **${feat.name}**.`,
    profile,
    feat,
    chosenAbility: parsed.chosenAbility,
  };
}

async function handleUnprepareSpellCommand(message) {
  if (!message.content.startsWith(`${PREFIX}unprepare`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}unprepare`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !unprepare spell name class OR !unprepare all");
    return;
  }

  if (normalizeName(rawArg) === "all") {
    for (const entry of Object.values(profile.spellcastingByClass || {})) {
      if (entry.mode === "prepared" || entry.mode === "spellbook") {
        entry.preparedSpells = [];
      }
    }

    savePlayerProfile(message.author.id, profile);
    await message.channel.send(`${profile.characterName} unprepared all prepared spells.`);
    return;
  }

  const { spellName, classEntry } = parseSpellAndClassFromEnd(rawArg, profile);

  if (!classEntry) {
    await message.channel.send("Usage: !unprepare spell name class");
    return;
  }

  const classSpellcasting = getSpellcastingEntry(profile, classEntry.className);

  if (!classSpellcasting) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  const prepared = classSpellcasting.preparedSpells || [];
  const index = prepared.findIndex(
    (name) => normalizeName(name) === normalizeName(spellName)
  );

  if (index === -1) {
    await message.channel.send(
      `${spellName} is not currently prepared for ${classEntry.className}.`
    );
    return;
  }

  const removedSpell = prepared[index];
  prepared.splice(index, 1);

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `${profile.characterName} unprepared **${removedSpell}** for **${classEntry.className}**.`
  );
}

async function handleCreateLoadoutCommand(message) {
  if (!message.content.startsWith(`${PREFIX}createloadout`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}createloadout`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !createloadout name class");
    return;
  }

  const { loadoutName, classEntry } = parseLoadoutAndClassFromEnd(rawArg, profile);

  if (!classEntry || !loadoutName) {
    await message.channel.send("Usage: !createloadout name class");
    return;
  }

  const spellcastingEntry = getSpellcastingEntry(profile, classEntry.className);

  if (!spellcastingEntry) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  if (spellcastingEntry.mode !== "prepared" && spellcastingEntry.mode !== "spellbook") {
    await message.channel.send(
      `${classEntry.className} does not use spell loadouts in this way.`
    );
    return;
  }

  if (!spellcastingEntry.loadouts) {
    spellcastingEntry.loadouts = {};
  }

  spellcastingEntry.loadouts[loadoutName] = sortSpellNamesByLevel(
    spellcastingEntry.preparedSpells || []
  );

  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `Saved **${classEntry.className}** spell loadout **${loadoutName}** with ${spellcastingEntry.loadouts[loadoutName].length} spells.`
  );
}

async function handleLoadSpellbookCommand(message) {
  if (!message.content.startsWith(`${PREFIX}loadspellbook`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}loadspellbook`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !loadspellbook name class");
    return;
  }

  const { loadoutName, classEntry } = parseLoadoutAndClassFromEnd(rawArg, profile);

  if (!classEntry || !loadoutName) {
    await message.channel.send("Usage: !loadspellbook name class");
    return;
  }

  const spellcastingEntry = getSpellcastingEntry(profile, classEntry.className);

  if (!spellcastingEntry) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  if (spellcastingEntry.mode !== "prepared" && spellcastingEntry.mode !== "spellbook") {
    await message.channel.send(
      `${classEntry.className} does not use spell loadouts in this way.`
    );
    return;
  }

  const savedLoadout = spellcastingEntry.loadouts?.[loadoutName];

  if (!savedLoadout) {
    await message.channel.send(
      `No saved ${classEntry.className} loadout found with the name **${loadoutName}**.`
    );
    return;
  }

  const preparedLimit = Number(spellcastingEntry.preparedLimit ?? 0);

  if (savedLoadout.length > preparedLimit) {
    await message.channel.send(
      `That ${classEntry.className} loadout has ${savedLoadout.length} spells, but only ${preparedLimit} can be prepared.`
    );
    return;
  }

  let availableSpells = [];

  if (spellcastingEntry.mode === "prepared") {
    availableSpells = getAvailableSpellsForClass(profile, classEntry.className);
  } else if (spellcastingEntry.mode === "spellbook") {
    availableSpells = (spellcastingEntry.knownSpells || [])
      .map((name) => getSpellByName(name))
      .filter(Boolean);
  }

  const availableSpellNames = availableSpells.map((spell) => normalizeName(spell.name));

  const invalidSpells = savedLoadout.filter(
    (spellName) => !availableSpellNames.includes(normalizeName(spellName))
  );

  if (invalidSpells.length) {
    await message.channel.send(
      `This ${classEntry.className} loadout contains unavailable spells: ${invalidSpells.join(", ")}`
    );
    return;
  }

  spellcastingEntry.preparedSpells = [...savedLoadout];
  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `${profile.characterName} loaded **${classEntry.className}** spell loadout **${loadoutName}**.`
  );
}

async function handleLoadoutCommand(message) {
  if (!message.content.startsWith(`${PREFIX}loadout`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const rawArg = message.content.slice(`${PREFIX}loadout`.length).trim();

  if (!rawArg) {
    const embed = new Discord.MessageEmbed()
      .setColor("#8B5CF6")
      .setTitle(`📚 ${profile.characterName} Spell Loadouts`);

    const entries = Object.values(profile.spellcastingByClass || {});

    if (!entries.length) {
      embed.setDescription("No spellcasting classes found.");
      await message.channel.send({ embeds: [embed] });
      return;
    }

    let foundAny = false;

    for (const entry of entries) {
      const loadoutNames = Object.keys(entry.loadouts || {});
      if (!loadoutNames.length) continue;

      foundAny = true;
      embed.addField(entry.className, loadoutNames.map((name) => `• ${name}`).join("\n"), false);
    }

    if (!foundAny) {
      embed.setDescription("No saved spell loadouts.");
    }

    await message.channel.send({ embeds: [embed] });
    return;
  }

  const parsed = parseLoadoutAndClassFromEnd(rawArg, profile);

  // Case 1: !loadout cleric
  if (!parsed.classEntry && resolveSpellcastingClass(profile, rawArg)) {
    const classEntry = resolveSpellcastingClass(profile, rawArg);
    const spellcastingEntry = getSpellcastingEntry(profile, classEntry.className);
    const loadoutNames = Object.keys(spellcastingEntry?.loadouts || {});

    const embed = new Discord.MessageEmbed()
      .setColor("#8B5CF6")
      .setTitle(`📚 ${profile.characterName} ${classEntry.className} Loadouts`);

    if (!loadoutNames.length) {
      embed.setDescription("No saved loadouts.");
    } else {
      embed.setDescription(loadoutNames.map((name) => `• ${name}`).join("\n"));
    }

    await message.channel.send({ embeds: [embed] });
    return;
  }

  // Case 2: !loadout healing cleric
  const { loadoutName, classEntry } = parsed;

  if (!classEntry || !loadoutName) {
    await message.channel.send("Usage: !loadout OR !loadout class OR !loadout name class");
    return;
  }

  const spellcastingEntry = getSpellcastingEntry(profile, classEntry.className);
  const savedLoadout = spellcastingEntry?.loadouts?.[loadoutName];

  if (!savedLoadout) {
    await message.channel.send(
      `No saved ${classEntry.className} loadout found with the name **${loadoutName}**.`
    );
    return;
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#8B5CF6")
    .setTitle(`📖 ${profile.characterName} ${classEntry.className} Loadout: ${loadoutName}`)
    .setDescription(`Spells: ${savedLoadout.length}`);

  const lines = buildSpellListLines(savedLoadout);
  const chunks = splitTextIntoChunks(lines.join("\n"), 1024);

  chunks.forEach((chunk, index) => {
    embed.addField(index === 0 ? "Spells" : "Spells (Cont.)", chunk, false);
  });

  await message.channel.send({ embeds: [embed] });
}

function getCastableSpellNames(profile) {
  const mode = profile.spellcasting?.mode || "none";

  if (mode === "prepared") {
    return profile.spellcasting?.preparedSpells || [];
  }

  if (mode === "known" || mode === "spellbook") {
    return profile.spellcasting?.knownSpells || [];
  }

  return [];
}

function getSpellByName(spellName) {
  const spells = loadSpellsDatabase();
  return spells.find(
    (spell) => normalizeSpellName(spell.name) === normalizeSpellName(spellName)
  );
}

function getCantripBonusDice(characterLevel) {
  const level = Number(characterLevel ?? 1);

  if (level >= 17) return 3;
  if (level >= 11) return 2;
  if (level >= 5) return 1;
  return 0;
}

async function handleCastCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  const parts = message.content.trim().split(/\s+/);
  const commandName = parts[0].toLowerCase();

  if (commandName !== `${PREFIX}cast`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArgs = message.content.slice(`${PREFIX}cast`.length).trim();

  if (!rawArgs) {
    await message.channel.send("Usage: !cast spell name [class] [slot]");
    return;
  }

  const parsedArgs = parseSpellClassAndSlot(rawArgs, profile);
  let spellName = parsedArgs.spellName;
  let castLevel = parsedArgs.castLevel;
  let classEntry = parsedArgs.classEntry;

  const spell = getSpellByName(spellName);

  if (!spell) {
    await message.channel.send(`Spell not found: ${spellName}`);
    return;
  }

  if (!classEntry) {
    classEntry = resolveCastingClassForSpell(profile, spell.name, null);
  }

  if (!classEntry) {
    await message.channel.send(
      `${spell.name} is not currently available in any of ${profile.characterName}'s active class spell lists.`
    );
    return;
  }

  const classSpellcasting = getSpellcastingEntry(profile, classEntry.className);

  if (!classSpellcasting) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  const activeSpellList =
    classSpellcasting.mode === "prepared" || classSpellcasting.mode === "spellbook"
      ? classSpellcasting.preparedSpells || []
      : classSpellcasting.knownSpells || [];

  const canCastThisSpell = activeSpellList.some(
    (name) => normalizeSpellName(name) === normalizeSpellName(spell.name)
  );

  if (!canCastThisSpell) {
    await message.channel.send(
      `${spell.name} is not currently available for ${classEntry.className}.`
    );
    return;
  }

  const baseSpellLevel = Number(spell.level ?? 0);
  let slotSourceUsed = null;

  if (baseSpellLevel === 0) {
    if (castLevel !== null) {
      await message.channel.send("Cantrips cannot be upcast with spell slots.");
      return;
    }

    castLevel = 0;
  } else {
    if (castLevel === null) {
      if (normalizeName(classEntry.className) === "warlock") {
        const pactSlotLevel = Number(profile.pactMagicSlots?.slotLevel ?? 0);
        castLevel = pactSlotLevel > 0 ? pactSlotLevel : baseSpellLevel;
      } else {
        castLevel = baseSpellLevel;
      }
    }

    if (castLevel < baseSpellLevel) {
      await message.channel.send(
        `${spell.name} is a level ${baseSpellLevel} spell and cannot be cast at level ${castLevel}.`
      );
      return;
    }

    let spendResult = null;

    if (normalizeName(classEntry.className) === "warlock") {
      spendResult = spendPactMagicSlot(profile, castLevel);

      if (!spendResult.success) {
        spendResult = spendStandardSpellSlot(profile, castLevel);
      }
    } else {
      spendResult = spendStandardSpellSlot(profile, castLevel);
    }

    if (!spendResult.success) {
      await message.channel.send(spendResult.message);
      return;
    }

    slotSourceUsed = spendResult.source;
  }

  let damageInfo = rollMultiBeamSpell(
    spell,
    castLevel,
    profile.totalLevel || profile.level
  );

  if (!damageInfo) {
    const baseDamageExpressions = extractAllDamageDiceExpressions(spell);

    if (baseDamageExpressions.length) {
      const scaledExpressions = scaleDamageDiceExpressions(
        baseDamageExpressions,
        baseSpellLevel,
        castLevel,
        profile.totalLevel || profile.level
      );

      damageInfo = rollMultipleDiceExpressions(scaledExpressions);
    }
  }

  savePlayerProfile(message.author.id, profile);

  const embed = buildCastResultEmbed(profile, spell, castLevel, damageInfo)
    .setFooter({
      text:
        baseSpellLevel === 0
          ? `Cast via ${classEntry.className}`
          : `Cast via ${classEntry.className} • Slot source: ${slotSourceUsed || "standard"}`,
    });

  await message.channel.send({ embeds: [embed] });
}

function scaleDamageDiceExpression(baseExpression, spellLevel, castLevel, characterLevel) {
  const cleaned = String(baseExpression || "").replace(/\s+/g, "");
  const match = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/i);

  if (!match) {
    return cleaned;
  }

  let diceCount = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const modifier = match[3] || "";

  if (spellLevel === 0) {
    diceCount += getCantripBonusDice(characterLevel);
  } else if (castLevel > spellLevel) {
    diceCount += castLevel - spellLevel;
  }

  return `${diceCount}d${dieSize}${modifier}`;
}

function buildCastResultEmbed(profile, spell, castLevel, damageInfo = null) {
  const embed = new Discord.MessageEmbed()
    .setColor("#8B5CF6")
    .setTitle(`✨ ${profile.characterName} cast ${spell.name}`)
    .setDescription(
      spell.level === 0
        ? `**Cantrip • ${capitalizeWords(String(spell.school || "Unknown"))}**`
        : `**Cast at Level ${castLevel} • ${capitalizeWords(String(spell.school || "Unknown"))}**`
    );

  if (spell.level > 0) {
    const current = Number(profile.spellSlots?.current?.[castLevel] ?? 0);
    const max = Number(profile.spellSlots?.max?.[castLevel] ?? 0);

    embed.addField(
      "Spell Slot",
      `Level ${castLevel}\n${buildSpellSlotLine(current, max)}\n${current}/${max}`,
      false
    );
  }

  if (damageInfo && damageInfo.results.length) {
    const coloredTotal = `\u001b[1;34m# ${damageInfo.total}\u001b[0m`;

    const breakdownLines = damageInfo.results.map((entry) => {
      const rollString = formatColoredRolls(entry.result.rolledDice);
      return `${entry.expression}: ${entry.total} ${rollString}`.trim();
    });

    const fullDamageText =
      `${coloredTotal}\n` +
      breakdownLines.join("\n");

    const chunks = splitTextIntoChunks(fullDamageText, 900);

    chunks.forEach((chunk, index) => {
      embed.addField(
        index === 0 ? "Damage" : "Damage (Cont.)",
        `\`\`\`ansi\n${chunk}\`\`\``,
        false
      );
    });
  } else {
    embed.addField("Damage", "No damage dice detected.", false);
  }

  return embed;
}

function extractAllDamageDiceExpressions(spell) {
  const text = flattenSpellEntries(spell.entries);
  const cleaned = cleanSpellText(text);

  const matches = [...cleaned.matchAll(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/gi)];

  return matches.map((match) => match[1].replace(/\s+/g, ""));
}

function scaleDamageDiceExpressions(expressions, spellLevel, castLevel, characterLevel) {
  return expressions.map((expression) =>
    scaleDamageDiceExpression(expression, spellLevel, castLevel, characterLevel)
  );
}

function rollMultipleDiceExpressions(expressions) {
  const results = expressions.map((expression) => {
    const result = rollDiceExpression(expression);

    return {
      expression,
      total: result.total,
      result,
    };
  });

  const grandTotal = results.reduce((sum, entry) => sum + entry.total, 0);

  return {
    results,
    total: grandTotal,
  };
}

function getScrollCastLevel(spell, requestedLevel, characterLevel) {
  const baseSpellLevel = Number(spell.level ?? 0);

  if (baseSpellLevel === 0) {
    return 0;
  }

  if (requestedLevel === null || requestedLevel === undefined) {
    return baseSpellLevel;
  }

  return requestedLevel;
}

async function handleScrollCommand(message) {
  if (!message.content.startsWith(PREFIX)) return;

  const parts = message.content.trim().split(/\s+/);
  const commandName = parts[0].toLowerCase();

  if (commandName !== `${PREFIX}scroll`) return;

  const rawArgs = message.content.slice(`${PREFIX}scroll`.length).trim();

  if (!rawArgs) {
    await message.channel.send("Usage: !scroll spell name OR !scroll spell name 3");
    return;
  }

  let spellName = rawArgs;
  let castLevel = null;
  let profile = loadPlayerProfile(message.author.id);

  const splitArgs = rawArgs.split(/\s+/);
  const maybeLastPart = splitArgs[splitArgs.length - 1];
  const parsedLastNumber = parseInt(maybeLastPart, 10);

  if (
    !isNaN(parsedLastNumber) &&
    parsedLastNumber >= 1 &&
    parsedLastNumber <= 9 &&
    splitArgs.length > 1
  ) {
    castLevel = parsedLastNumber;
    spellName = splitArgs.slice(0, -1).join(" ");
  }

  const spell = getSpellByName(spellName);

  if (!spell) {
    await message.channel.send(`Spell not found: ${spellName}`);
    return;
  }

  const baseSpellLevel = Number(spell.level ?? 0);

  if (baseSpellLevel === 0 && castLevel !== null) {
    await message.channel.send("Cantrips cannot be upcast.");
    return;
  }

  if (baseSpellLevel > 0) {
    castLevel = getScrollCastLevel(spell, castLevel, null);

    if (castLevel < baseSpellLevel) {
      await message.channel.send(
        `${spell.name} is a level ${baseSpellLevel} spell and cannot be used at level ${castLevel}.`
      );
      return;
    }
  } else {
    castLevel = 0;
  }

  let damageInfo = rollMultiBeamSpell(
    spell,
    castLevel,
    1
  );

  if (!damageInfo) {
    const baseDamageExpressions = extractAllDamageDiceExpressions(spell);

    if (baseDamageExpressions.length) {
      const scaledExpressions = scaleDamageDiceExpressions(
        baseDamageExpressions,
        baseSpellLevel,
        castLevel,
        1
      );

      damageInfo = rollMultipleDiceExpressions(scaledExpressions);
    }
  }

  const fakeProfile = {
    characterName: `${profile.characterName}'s Scroll`,
    spellSlots: {
      current: {},
      max: {},
    },
  };

  const embed = buildCastResultEmbed(fakeProfile, spell, castLevel, damageInfo)
    .setTitle(`📜 ${profile.characterName} used a scroll of ${spell.name}`);

  if (baseSpellLevel > 0) {
    embed.setDescription(
      `**Scroll Cast at Level ${castLevel} • ${capitalizeWords(String(spell.school || "Unknown"))}**`
    );
  } else {
    embed.setDescription(
      `**Scroll Cantrip • ${capitalizeWords(String(spell.school || "Unknown"))}**`
    );
  }

  await message.channel.send({ embeds: [embed] });
}

function getEldritchBlastBeamCount(characterLevel) {
  const level = Number(characterLevel ?? 1);

  if (level >= 17) return 4;
  if (level >= 11) return 3;
  if (level >= 5) return 2;
  return 1;
}

function getMultiBeamSpellConfig(spell, castLevel, characterLevel) {
  const spellName = normalizeSpellName(spell.name);

  if (spellName === "magic missile") {
    return {
      beamName: "Dart",
      beamCount: 3 + Math.max(0, castLevel - 1),
      expression: "1d4+1",
    };
  }

  if (spellName === "jim's magic missile") {
    return {
      beamName: "Missile",
      beamCount: 3 + Math.max(0, castLevel - 1),
      expression: "2d4",
    };
  }

  if (spellName === "scorching ray") {
    return {
      beamName: "Ray",
      beamCount: 3 + Math.max(0, castLevel - 2),
      expression: "2d6",
    };
  }

  if (spellName === "eldritch blast") {
    return {
      beamName: "Beam",
      beamCount: getEldritchBlastBeamCount(characterLevel),
      expression: "1d10",
    };
  }

  if (spellName === "melf's minute meteors") {
    return {
      beamName: "Meteor",
      beamCount: 6 + Math.max(0, (castLevel - 3) * 2),
      expression: "2d6",
    };
  }

  if (spellName === "steel wind strike") {
    return {
      beamName: "Strike",
      beamCount: 5,
      expression: "6d10",
    };
  }

  if (spellName === "meteor swarm") {
    return {
      beamName: "Meteor",
      beamCount: 4,
      expression: "20d6+20d6",
    };
  }

  return null;
}

function rollMultiBeamSpell(spell, castLevel, characterLevel) {
  const config = getMultiBeamSpellConfig(spell, castLevel, characterLevel);

  if (!config) return null;

  const results = [];
  let total = 0;

  for (let i = 0; i < config.beamCount; i++) {
    const result = rollDiceExpression(config.expression);

    results.push({
      label: `${config.beamName} ${i + 1}`,
      expression: config.expression,
      total: result.total,
      result,
    });

    total += result.total;
  }

  return {
    results,
    total,
  };
}

function isSpellAvailableToProfile(profile, spell) {
  const availableSpells = getAvailableSpellsForProfile(profile);

  return availableSpells.some(
    (availableSpell) =>
      normalizeSpellName(availableSpell.name) === normalizeSpellName(spell.name)
  );
}

async function handleLearnSpellCommand(message) {
  if (!message.content.startsWith(`${PREFIX}learnspell`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send(
      "You do not have an imported character yet. Use !import first."
    );
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}learnspell`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !learnspell spell name class");
    return;
  }

  const { spellName, classEntry } = parseSpellAndClassFromEnd(rawArg, profile);

  if (!classEntry) {
    await message.channel.send("Usage: !learnspell spell name class");
    return;
  }

  const classSpellcasting = getSpellcastingEntry(profile, classEntry.className);

  if (!classSpellcasting) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  if (classSpellcasting.mode === "prepared") {
    await message.channel.send(
      `${classEntry.className} uses prepared casting. Use !prepare instead.`
    );
    return;
  }

  if (classSpellcasting.mode !== "known" && classSpellcasting.mode !== "spellbook") {
    await message.channel.send(
      `${classEntry.className} does not use a learnable spell system.`
    );
    return;
  }

  const spell = getSpellByName(spellName);

  if (!spell) {
    await message.channel.send(`Spell not found: ${spellName}`);
    return;
  }

  const availableSpells = getAvailableSpellsForClass(profile, classEntry.className);
  const available = availableSpells.some(
    (availableSpell) =>
      normalizeSpellName(availableSpell.name) === normalizeSpellName(spell.name)
  );

  if (!available) {
    await message.channel.send(
      `${spell.name} is not available to ${classEntry.className}.`
    );
    return;
  }

  const knownSpells = classSpellcasting.knownSpells || [];
  const alreadyKnown = knownSpells.some(
    (name) => normalizeSpellName(name) === normalizeSpellName(spell.name)
  );

  if (alreadyKnown) {
    await message.channel.send(`${spell.name} is already learned for ${classEntry.className}.`);
    return;
  }

  if (
    classSpellcasting.mode === "known" &&
    Number(classSpellcasting.knownSpellLimit ?? 0) > 0 &&
    knownSpells.length >= Number(classSpellcasting.knownSpellLimit)
  ) {
    await message.channel.send(
      `${profile.characterName} already knows the maximum number of spells for ${classEntry.className} (${classSpellcasting.knownSpellLimit}).`
    );
    return;
  }

  classSpellcasting.knownSpells.push(spell.name);
  classSpellcasting.knownSpells = sortSpellNamesByLevel(classSpellcasting.knownSpells);

  savePlayerProfile(message.author.id, profile);

  if (classSpellcasting.mode === "spellbook") {
    await message.channel.send(
      `${profile.characterName} added **${spell.name}** to the **${classEntry.className}** spellbook.`
    );
  } else {
    await message.channel.send(
      `${profile.characterName} learned **${spell.name}** for **${classEntry.className}**.`
    );
  }
}

async function handleUnlearnSpellCommand(message) {
  if (!message.content.startsWith(`${PREFIX}unlearnspell`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send(
      "You do not have an imported character yet. Use !import first."
    );
    return;
  }

  profile = recalculateDerivedStats(profile);

  const rawArg = message.content.slice(`${PREFIX}unlearnspell`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !unlearnspell spell name class");
    return;
  }

  const { spellName, classEntry } = parseSpellAndClassFromEnd(rawArg, profile);

  if (!classEntry) {
    await message.channel.send("Usage: !unlearnspell spell name class");
    return;
  }

  const classSpellcasting = getSpellcastingEntry(profile, classEntry.className);

  if (!classSpellcasting) {
    await message.channel.send("That class has no spellcasting entry.");
    return;
  }

  if (classSpellcasting.mode === "prepared") {
    await message.channel.send(
      `${classEntry.className} uses prepared casting. Use !unprepare instead.`
    );
    return;
  }

  const knownSpells = classSpellcasting.knownSpells || [];
  const index = knownSpells.findIndex(
    (name) => normalizeName(name) === normalizeName(spellName)
  );

  if (index === -1) {
    await message.channel.send(
      `${spellName} is not currently learned for ${classEntry.className}.`
    );
    return;
  }

  const removedSpell = knownSpells[index];
  knownSpells.splice(index, 1);

  if (classSpellcasting.mode === "spellbook") {
    classSpellcasting.preparedSpells = (classSpellcasting.preparedSpells || []).filter(
      (name) => normalizeName(name) !== normalizeName(removedSpell)
    );
  }

  savePlayerProfile(message.author.id, profile);

  if (classSpellcasting.mode === "spellbook") {
    await message.channel.send(
      `${profile.characterName} removed **${removedSpell}** from the **${classEntry.className}** spellbook.`
    );
  } else {
    await message.channel.send(
      `${profile.characterName} unlearned **${removedSpell}** for **${classEntry.className}**.`
    );
  }
}

async function handleFeatsCommand(message) {
  if (message.content !== `${PREFIX}feats`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);
  savePlayerProfile(message.author.id, profile);

  const classFeatureGroups = Object.values(profile.featuresByClass || {}).map((group) => ({
    ...group,
    features: (group.features || []).filter(
      (feature) => !isAbilityScoreImprovementFeature(feature)
    ),
  }));
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`${profile.characterName} Features`);

  let addedAny = false;

  for (const group of classFeatureGroups) {
    const lines = formatFeatureListLines(group.features || []);

    if (!lines.length) continue;
    addedAny = true;

    const title = group.subclass
      ? `Class Features: ${group.className} (${group.subclass})`
      : `Class Features: ${group.className}`;

    splitTextIntoChunks(lines.join("\n"), 1024).forEach((chunk, index) => {
      embed.addField(index === 0 ? title : `${title} (Cont.)`, chunk, false);
    });
  }

  const racialLines = formatFeatureListLines(profile.racialFeatures || []);
  if (racialLines.length) {
    addedAny = true;
    splitTextIntoChunks(racialLines.join("\n"), 1024).forEach((chunk, index) => {
      embed.addField(index === 0 ? "Racial Features" : "Racial Features (Cont.)", chunk, false);
    });
  }

  const selectedFeatLines = formatFeatureListLines(profile.selectedFeatFeatures || []);
  if (selectedFeatLines.length) {
    addedAny = true;
    splitTextIntoChunks(selectedFeatLines.join("\n"), 1024).forEach((chunk, index) => {
      embed.addField(index === 0 ? "Selected Feats" : "Selected Feats (Cont.)", chunk, false);
    });
  }

  if (!addedAny) {
    embed.setDescription("No class, racial, or selected feat features found for this character.");
  }

  await message.channel.send({ embeds: [embed] });
}

async function handleFeatCommand(message) {
  if (!message.content.startsWith(`${PREFIX}feat`)) return;
  if (message.content === `${PREFIX}feats`) return;

  const rawArg = message.content.slice(`${PREFIX}feat`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !feat feature name");
    return;
  }

  if (normalizeDataName(rawArg) === "ability score improvement") {
    await message.channel.send(
      "Ability Score Improvements are handled separately from feats. Use `!asi` to view or spend pending ASI points."
    );
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const { feature, matches } = findCharacterFeature(profile, rawArg);

  if (!feature) {
    const featDefinition = getFeatDefinition(rawArg);

    if (featDefinition) {
      const embed = new Discord.MessageEmbed()
        .setColor("#1F6FEB")
        .setTitle(featDefinition.name)
        .setDescription("Feat Reference");

      if (Array.isArray(featDefinition.prerequisite) && featDefinition.prerequisite.length) {
        embed.addField(
          "Prerequisites",
          splitTextIntoChunks(JSON.stringify(featDefinition.prerequisite), 1024)[0],
          false
        );
      }

      splitTextIntoChunks(
        flattenEntryText(featDefinition.entries || []),
        1024
      ).forEach((chunk, index) => {
        embed.addField(index === 0 ? "Details" : " ", chunk, false);
      });

      await message.channel.send({ embeds: [embed] });
      return;
    }

    if (matches.length > 1) {
      await message.channel.send(
        `Multiple features match **${rawArg}**: ${matches
          .slice(0, 8)
          .map((entry) => entry.name)
          .join(", ")}`
      );
    } else {
      await message.channel.send(`${profile.characterName} does not have a feature matching **${rawArg}**.`);
    }
    return;
  }

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(feature.name)
    .setDescription(
      feature.type === "racial"
        ? `**Category:** Racial Feature\n**Origin:** ${feature.group}`
        : feature.type === "selectedFeat"
        ? `**Category:** Selected Feat`
        : `**Class:** ${feature.className}${
            feature.subclassName ? `\n**Subclass:** ${feature.subclassName}` : ""
          }\n**Level Gained:** ${feature.level}`
    );

  splitTextIntoChunks(feature.description || "No description available.").forEach(
    (chunk, index) => {
      embed.addField(index === 0 ? "Details" : " ", chunk, false);
    }
  );

  await message.channel.send({ embeds: [embed] });
}

async function handleExpCommand(message) {
  if (message.content !== `${PREFIX}exp`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);
  savePlayerProfile(message.author.id, profile);

  const xpInfo = getXpInfo(getTotalCharacterLevel(profile), profile.experience);
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`${profile.characterName} Experience`)
    .addField("Current XP", String(xpInfo.currentXp), true)
    .addField("Current Level", String(xpInfo.level), true);

  if (xpInfo.nextLevel) {
    embed.addField("Next Level", `${xpInfo.nextLevel} at ${xpInfo.nextThreshold} XP`, false);
    embed.addField("Remaining", `${xpInfo.remainingToNext} XP to level up`, false);
  } else {
    embed.addField("Status", "This character is at the level cap.", false);
  }

  if ((profile.pendingSubclassSelections || []).length) {
    embed.addField(
      "Pending Subclass",
      `Choose with \`!subclass\` and \`!choosesubclass name\`.`,
      false
    );
  }

  if (Number(profile.pendingAsiPoints ?? 0) > 0) {
    embed.addField(
      "Pending ASI",
      `${profile.pendingAsiPoints} point(s) waiting. Use \`!asi\`.`,
      false
    );
  }

  await message.channel.send({ embeds: [embed] });
}

async function handleGainExpCommand(message) {
  if (!message.content.startsWith(`${PREFIX}gainexp`)) return;

  const rawArg = message.content.slice(`${PREFIX}gainexp`.length).trim();
  const amount = parseInt(rawArg, 10);

  if (!rawArg || isNaN(amount) || amount <= 0) {
    await message.channel.send("Usage: !gainexp number");
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);

  const result = awardExperience(profile, amount);
  profile = result.profile;
  savePlayerProfile(message.author.id, profile);

  const xpInfo = getXpInfo(getTotalCharacterLevel(profile), profile.experience);

  await message.channel.send(
    `${profile.characterName} gained **${amount} XP** and now has **${profile.experience} XP**.`
  );

  for (const summary of result.summaries || []) {
    const embed = buildLevelUpEmbed(profile, summary);
    await message.channel.send({ embeds: [embed] });
  }

  if (result.blockedReason) {
    await message.channel.send(result.blockedReason);
  } else if (!(result.summaries || []).length && xpInfo.nextLevel) {
    await message.channel.send(
      `${xpInfo.remainingToNext} XP remaining until level ${xpInfo.nextLevel}.`
    );
  }
}

async function handleAsiCommand(message) {
  if (!message.content.startsWith(`${PREFIX}asi`)) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);

  const rawArg = message.content.slice(`${PREFIX}asi`.length).trim();

  if (!rawArg) {
    const embed = new Discord.MessageEmbed()
      .setColor("#1F6FEB")
      .setTitle(`${profile.characterName} Ability Score Improvement`)
      .setDescription(
        profile.pendingAsiPoints > 0
          ? `${profile.pendingAsiPoints} point(s) available. Usage: \`!asi str 2\`, \`!asi str 1 dex 1\`, or \`!asi feat Fey Touched wis\``
          : "No ASI points are currently pending."
      )
      .addField(
        "Abilities",
        `STR ${profile.abilities.str}\nDEX ${profile.abilities.dex}\nCON ${profile.abilities.con}\nINT ${profile.abilities.int}\nWIS ${profile.abilities.wis}\nCHA ${profile.abilities.cha}`,
        true
      );

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (rawArg.toLowerCase().startsWith("feat ")) {
    const featSelection = applyFeatSelectionFromAsi(profile, rawArg.slice(5).trim());

    if (!featSelection.success) {
      await message.channel.send(featSelection.message);
      return;
    }

    profile = featSelection.profile;
    savePlayerProfile(message.author.id, profile);

    await message.channel.send(
      `${featSelection.message}\nPending ASI points: ${profile.pendingAsiPoints}`
    );
    return;
  }

  const adjustments = parseAsiAdjustments(rawArg);
  const result = applyAbilityScoreImprovement(profile, adjustments);

  if (!result.success) {
    await message.channel.send(result.message);
    return;
  }

  profile = result.profile;
  savePlayerProfile(message.author.id, profile);

  await message.channel.send(
    `${result.message}\nSTR ${profile.abilities.str} | DEX ${profile.abilities.dex} | CON ${profile.abilities.con} | INT ${profile.abilities.int} | WIS ${profile.abilities.wis} | CHA ${profile.abilities.cha}`
  );
}

async function handleSubclassCommand(message) {
  if (message.content !== `${PREFIX}subclass`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);
  savePlayerProfile(message.author.id, profile);

  const pendingClasses = profile.pendingSubclassSelections || [];
  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`${profile.characterName} Subclasses`);

  if (!pendingClasses.length) {
    const chosen = (profile.classes || [])
      .filter((entry) => entry.subclass)
      .map((entry) => `${entry.name}: ${entry.subclass}`);

    embed.setDescription(
      chosen.length
        ? chosen.join("\n")
        : "No subclass choice is currently pending."
    );

    await message.channel.send({ embeds: [embed] });
    return;
  }

  for (const className of pendingClasses) {
    const options = getSubclassOptions(className);
    if (!options.length) continue;

    splitTextIntoChunks(options.map((option) => option.name).join(", "), 1024).forEach(
      (chunk, index) => {
        embed.addField(
          index === 0 ? `${className} Options` : `${className} Options (Cont.)`,
          chunk,
          false
        );
      }
    );
  }

  embed.setFooter({ text: "Choose with !choosesubclass subclass name" });
  await message.channel.send({ embeds: [embed] });
}

async function handleChooseSubclassCommand(message) {
  if (!message.content.startsWith(`${PREFIX}choosesubclass`)) return;

  const rawArg = message.content.slice(`${PREFIX}choosesubclass`.length).trim();

  if (!rawArg) {
    await message.channel.send("Usage: !choosesubclass subclass name");
    return;
  }

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send("You do not have an imported character yet. Use !import first.");
    return;
  }

  profile = recalculateDerivedStats(profile);
  ensureLevelingState(profile);

  const result = chooseSubclass(profile, rawArg);

  if (!result.success) {
    await message.channel.send(result.message);
    return;
  }

  profile = result.profile;
  savePlayerProfile(message.author.id, profile);

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`${profile.characterName} chose ${result.subclassName}`)
    .setDescription(result.message);

  if (result.gainedFeatures.length) {
    embed.addField(
      "Subclass Features",
      splitTextIntoChunks(
        result.gainedFeatures.map((feature) => feature.name).join(", "),
        1024
      )[0],
      false
    );
  }

  await message.channel.send({ embeds: [embed] });
}

async function handleCharactersCommand(message) {
  if (message.content !== `${PREFIX}characters`) return;

  const characterNames = listCharacterNames(message.author.id);
  const activeCharacter = getActiveCharacterName(message.author.id);

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle(`🧙 ${message.author.username}'s Characters`);

  if (!characterNames.length) {
    embed.setDescription("No saved characters.");
    await message.channel.send({ embeds: [embed] });
    return;
  }

  const lines = characterNames.map((name) =>
    name === activeCharacter ? `➡️ **${name}**` : `• ${name}`
  );

  embed.setDescription(lines.join("\n"));
  embed.setFooter({ text: "Arrow indicates active character" });

  await message.channel.send({ embeds: [embed] });
}

async function handleSwitchCharacterCommand(message) {
  if (!message.content.startsWith(`${PREFIX}switchcharacter`)) return;

  const characterName = message.content
    .slice(`${PREFIX}switchcharacter`.length)
    .trim();

  if (!characterName) {
    await message.channel.send("Usage: !switchcharacter character name");
    return;
  }

  const characterNames = listCharacterNames(message.author.id);
  const match = characterNames.find(
    (name) => normalizeName(name) === normalizeName(characterName)
  );

  if (!match) {
    await message.channel.send(`No saved character found with the name **${characterName}**.`);
    return;
  }

  setActiveCharacter(message.author.id, match);

  await message.channel.send(`Active character set to **${match}**.`);
}

async function handleDeleteCharacterCommand(message) {
  if (!message.content.startsWith(`${PREFIX}deletecharacter`)) return;

  const characterName = message.content
    .slice(`${PREFIX}deletecharacter`.length)
    .trim();

  if (!characterName) {
    await message.channel.send("Usage: !deletecharacter character name");
    return;
  }

  const characterNames = listCharacterNames(message.author.id);
  const match = characterNames.find(
    (name) => normalizeName(name) === normalizeName(characterName)
  );

  if (!match) {
    await message.channel.send(`No saved character found with the name **${characterName}**.`);
    return;
  }

  const confirmMessage = await message.channel.send(
    `Are you sure you want to delete **${match}**?\nReact with ✅ to confirm or ❌ to cancel.`
  );

  await confirmMessage.react("✅");
  await confirmMessage.react("❌");

  const filter = (reaction, user) => {
    return (
      ["✅", "❌"].includes(reaction.emoji.name) &&
      user.id === message.author.id
    );
  };

  try {
    const collected = await confirmMessage.awaitReactions({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    const reaction = collected.first();

    if (reaction.emoji.name === "❌") {
      await message.channel.send(`Deletion of **${match}** cancelled.`);
      return;
    }

    const deleted = deletePlayerProfile(message.author.id, match);

    if (!deleted) {
      await message.channel.send(`Could not delete **${match}**.`);
      return;
    }

    const newActive = getActiveCharacterName(message.author.id);

    if (newActive) {
      await message.channel.send(
        `Deleted **${match}**. Active character is now **${newActive}**.`
      );
    } else {
      await message.channel.send(`Deleted **${match}**.`);
    }
  } catch (error) {
    await message.channel.send(`Deletion of **${match}** timed out.`);
  }
}

async function handleSpellSlotsCommand(message) {
  if (message.content !== `${PREFIX}spellslots`) return;

  let profile = loadPlayerProfile(message.author.id);

  if (!profile) {
    await message.channel.send(
      "You do not have an imported character yet. Use !import first."
    );
    return;
  }

  profile = recalculateDerivedStats(profile);
  savePlayerProfile(message.author.id, profile);

  const embed = buildSpellSlotsEmbed(profile, `${profile.characterName} Spell Slots`);
  await message.channel.send({ embeds: [embed] });
}

async function handleHelpCommand(message) {
  if (message.content !== `${PREFIX}help`) return;

  const embed = new Discord.MessageEmbed()
    .setColor("#1F6FEB")
    .setTitle("📘 DiceBot Commands")
    .setDescription("Here are the current commands grouped by category.")
    .addFields(
      {
        name: "🎲 Rolling",
        value:
          "`!d20`, `!2d6+3`\n" +
          "`!save str`\n" +
          "`!check stealth`\n" +
          "`!initiative`\n" +
          "`!deathsave`",
        inline: false,
      },
      {
        name: "❤️ Health & Rest",
        value:
          "`!hp`\n" +
          "`!hp @player`\n" +
          "`!heal 2d4+2`\n" +
          "`!take 7`\n" +
          "`!shortrest 2`\n" +
          "`!longrest`",
        inline: false,
      },
      {
        name: "🧙 Characters",
        value:
          "`!import` + attach JSON\n" +
          "`!portrait` + attach image\n" +
          "`!profile`\n" +
          "`!feats`\n" +
          "`!feat feature name`\n" +
          "`!characters`\n" +
          "`!switchcharacter name`\n" +
          "`!deletecharacter name`",
        inline: false,
      },
      {
        name: "✨ Spells",
        value:
          "`!spell fireball`\n" +
          "`!availablespells`\n" +
          "`!prepare bless`\n" +
          "`!unprepare bless`\n" +
          "`!unprepare all`\n" +
          "`!spellbook`\n" +
          "`!spellslots`\n" +
          "`!cast guiding bolt`\n" +
          "`!cast guiding bolt 3`\n" +
          "`!scroll fireball`\n" +
          "`!scroll scorching ray 4`",
        inline: false,
      },
      {
        name: "📚 Spell Loadouts",
        value:
          "`!createloadout name`\n" +
          "`!loadspellbook name`\n" +
          "`!loadout`\n" +
          "`!loadout name`\n" +
          "`!learnspell fireball`\n" +
          "`!unlearnspell fireball`",
        inline: false,
      },
      {
        name: "🎒 Inventory",
        value:
          "`!inventory`\n" +
          "`!add torch 3`\n" +
          "`!toss torch 1`",
        inline: false,
      },
      {
        name: "⭐ Progression",
        value:
          "`!exp`\n" +
          "`!gainexp 300`\n" +
          "`!asi`\n" +
          "`!asi str 2`\n" +
          "`!asi feat Fey Touched wis`\n" +
          "`!subclass`\n" +
          "`!choosesubclass name`",
        inline: false,
      },
      {
        name: "⚔️ Combat",
        value:
          "`!rollinitiative` *(GM)*\n" +
          "`!initiative` *(player roll)*\n" +
          "`!initiative Goblin 3` *(GM enemy roll)*\n" +
          "`!startcombat` *(GM)*\n" +
          "`!next` *(GM)*\n" +
          "`!turnorder`\n" +
          "`!removecombatant name` *(GM)*\n" +
          "`!endcombat` *(GM)*",
        inline: false,
      },
      {
        name: "💀 Death Saves",
        value:
          "`!deathsave`\n" +
          "`!res @player` *(GM)*\n" +
          "`!faildeathsave @player` *(GM)*",
        inline: false,
      },
      {
        name: "🔋 Class Resources",
        value:
          "`!resources`\n" +
          "`!channeldivinity`\n" +
          "`!secondwind`\n" +
          "`!actionsurge`\n" +
          "`!rage`\n" +
          "`!wildshape`\n" +
          "`!ki 2`\n" +
          "`!layonhands 10`\n" +
          "`!sorcerypoints 3`\n" +
          "`!mysticarcanum6`",
        inline: false,
      },
      {
        name: "📈 Stats",
        value:
          "`!setstr 18`\n" +
          "`!setdex 14`\n" +
          "`!modstat wis 2`\n" +
          "`!modstat con -1`",
        inline: false,
      }
    )
    .setFooter({ text: "GM = role-restricted commands" });

  await message.channel.send({ embeds: [embed] });
}

function formatClassList(profile) {
  if (Array.isArray(profile.classes) && profile.classes.length > 0) {
    return profile.classes
      .map((classEntry) => {
        const className = classEntry.name || "Unknown Class";
        const subclassText = classEntry.subclass ? ` (${classEntry.subclass})` : "";
        return `Level ${classEntry.level} ${className}${subclassText}`;
      })
      .join("\n");
  }

  return `Level ${profile.level || 1} ${profile.class || "Unknown Class"}${
    profile.subclass ? ` (${profile.subclass})` : ""
  }`;
}

function getSpellcastingEntry(profile, className) {
  const key = normalizeName(className);
  return profile.spellcastingByClass?.[key] || null;
}

function getSpellcastingClassNames(profile) {
  return Object.values(profile.spellcastingByClass || {}).map(
    (entry) => entry.className
  );
}

function resolveSpellcastingClass(profile, classNameText) {
  if (!classNameText) return null;

  const entries = Object.values(profile.spellcastingByClass || {});
  return (
    entries.find(
      (entry) => normalizeName(entry.className) === normalizeName(classNameText)
    ) || null
  );
}

function getAvailableSpellsForClass(profile, className) {
  const spells = loadSpellsDatabase();
  const classKey = normalizeName(className);
  const highestLevel = getHighestSpellSlotLevel(profile);

  return spells.filter((spell) => {
    const spellClasses = getSpellClasses(spell).map((c) => normalizeName(c));

    if (!spellClasses.includes(classKey)) {
      return false;
    }

    if (Number(spell.level ?? 0) === 0) {
      return true;
    }

    return Number(spell.level ?? 0) <= highestLevel;
  });
}

function getCastableSpellNames(profile) {
  const names = [];

  for (const entry of Object.values(profile.spellcastingByClass || {})) {
    if (entry.mode === "prepared" || entry.mode === "spellbook") {
      names.push(...(entry.preparedSpells || []));
    } else if (entry.mode === "known") {
      names.push(...(entry.knownSpells || []));
    }
  }

  return [...new Set(names)];
}

function parseSpellAndClassFromEnd(rawText, profile) {
  const parts = rawText.trim().split(/\s+/);

  if (parts.length < 2) {
    return { spellName: rawText.trim(), classEntry: null };
  }

  const possibleClassName = parts[parts.length - 1];
  const classEntry = resolveSpellcastingClass(profile, possibleClassName);

  if (!classEntry) {
    return { spellName: rawText.trim(), classEntry: null };
  }

  return {
    spellName: parts.slice(0, -1).join(" ").trim(),
    classEntry,
  };
}

function parseLoadoutAndClassFromEnd(rawText, profile) {
  const parts = rawText.trim().split(/\s+/);

  if (parts.length < 2) {
    return { loadoutName: rawText.trim(), classEntry: null };
  }

  const possibleClassName = parts[parts.length - 1];
  const classEntry = resolveSpellcastingClass(profile, possibleClassName);

  if (!classEntry) {
    return { loadoutName: rawText.trim(), classEntry: null };
  }

  return {
    loadoutName: parts.slice(0, -1).join(" ").trim(),
    classEntry,
  };
}

function parseCastArguments(rawArgs) {
  const parts = rawArgs.trim().split(/\s+/);

  let castLevel = null;
  let className = null;
  let workingParts = [...parts];

  // If final token is a slot level, pull it off first.
  const maybeLastNumber = parseInt(workingParts[workingParts.length - 1], 10);
  if (
    !isNaN(maybeLastNumber) &&
    maybeLastNumber >= 1 &&
    maybeLastNumber <= 9 &&
    workingParts.length > 1
  ) {
    castLevel = maybeLastNumber;
    workingParts.pop();
  }

  return {
    remainingText: workingParts.join(" ").trim(),
    castLevel,
  };
}

function resolveCastingClassForSpell(profile, spellName, specifiedClassName = null) {
  const castableNames = getCastableSpellNames(profile);

  const allEntries = Object.values(profile.spellcastingByClass || {});
  const matchingEntries = allEntries.filter((entry) => {
    const activeSpellList =
      entry.mode === "prepared" || entry.mode === "spellbook"
        ? entry.preparedSpells || []
        : entry.knownSpells || [];

    return activeSpellList.some(
      (name) => normalizeSpellName(name) === normalizeSpellName(spellName)
    );
  });

  if (!matchingEntries.length) {
    return null;
  }

  if (specifiedClassName) {
    const explicitMatch = matchingEntries.find(
      (entry) =>
        normalizeName(entry.className) === normalizeName(specifiedClassName)
    );

    return explicitMatch || null;
  }

  if (matchingEntries.length === 1) {
    return matchingEntries[0];
  }

  const primaryClass = getPrimaryClass(profile);
  if (primaryClass) {
    const primaryMatch = matchingEntries.find(
      (entry) =>
        normalizeName(entry.className) === normalizeName(primaryClass.name)
    );

    if (primaryMatch) {
      return primaryMatch;
    }
  }

  return matchingEntries[0];
}

function spendStandardSpellSlot(profile, castLevel) {
  const maxSlotsAtLevel = Number(profile.spellSlots?.max?.[castLevel] ?? 0);
  const currentSlotsAtLevel = Number(profile.spellSlots?.current?.[castLevel] ?? 0);

  if (maxSlotsAtLevel <= 0) {
    return {
      success: false,
      message: `${profile.characterName} does not have any level ${castLevel} spell slots.`,
    };
  }

  if (currentSlotsAtLevel <= 0) {
    return {
      success: false,
      message: `${profile.characterName} has no remaining level ${castLevel} spell slots.`,
    };
  }

  profile.spellSlots.current[castLevel] = currentSlotsAtLevel - 1;

  return {
    success: true,
    source: "standard",
  };
}

function spendPactMagicSlot(profile, castLevel) {
  const pactSlotLevel = Number(profile.pactMagicSlots?.slotLevel ?? 0);
  const pactCurrent = Number(profile.pactMagicSlots?.current ?? 0);
  const pactMax = Number(profile.pactMagicSlots?.max ?? 0);

  if (pactMax <= 0 || pactSlotLevel <= 0) {
    return {
      success: false,
      message: `${profile.characterName} has no Pact Magic slots.`,
    };
  }

  if (castLevel !== pactSlotLevel) {
    return {
      success: false,
      message: `${profile.characterName}'s Pact Magic slots are level ${pactSlotLevel}.`,
    };
  }

  if (pactCurrent <= 0) {
    return {
      success: false,
      message: `${profile.characterName} has no remaining Pact Magic slots.`,
    };
  }

  profile.pactMagicSlots.current = pactCurrent - 1;

  return {
    success: true,
    source: "pact",
  };
}

function parseSpellClassAndSlot(rawArgs, profile) {
  const parsed = parseCastArguments(rawArgs);
  const remainingText = parsed.remainingText;

  const parts = remainingText.split(/\s+/);

  if (parts.length < 2) {
    return {
      spellName: remainingText,
      classEntry: null,
      castLevel: parsed.castLevel,
      classWasExplicit: false,
    };
  }

  const possibleClassName = parts[parts.length - 1];
  const explicitClassEntry = resolveSpellcastingClass(profile, possibleClassName);

  if (explicitClassEntry) {
    return {
      spellName: parts.slice(0, -1).join(" ").trim(),
      classEntry: explicitClassEntry,
      castLevel: parsed.castLevel,
      classWasExplicit: true,
    };
  }

  return {
    spellName: remainingText,
    classEntry: null,
    castLevel: parsed.castLevel,
    classWasExplicit: false,
  };
}

function getAllClassResourceEntries(profile) {
  const result = [];

  for (const classBlock of Object.values(profile.classResourcesByClass || {})) {
    for (const [resourceKey, resource] of Object.entries(classBlock.resources || {})) {
      result.push({
        className: classBlock.className,
        subclass: classBlock.subclass,
        resourceKey,
        resource,
      });
    }
  }

  return result;
}

function resolveResourceClass(profile, commandName, specifiedClassName = null) {
  const matchingResources = getAllClassResourceEntries(profile).filter(
    (entry) => normalizeName(entry.resource.command) === normalizeName(commandName)
  );

  if (!matchingResources.length) {
    return null;
  }

  if (specifiedClassName) {
    return (
      matchingResources.find(
        (entry) => normalizeName(entry.className) === normalizeName(specifiedClassName)
      ) || null
    );
  }

  if (matchingResources.length === 1) {
    return matchingResources[0];
  }

  const primaryClass = getPrimaryClass(profile);
  if (primaryClass) {
    const primaryMatch = matchingResources.find(
      (entry) => normalizeName(entry.className) === normalizeName(primaryClass.name)
    );

    if (primaryMatch) {
      return primaryMatch;
    }
  }

  return matchingResources[0];
}

function parseResourceAmountAndClass(rawArgs, profile) {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);

  let amount = 1;
  let className = null;

  if (!parts.length) {
    return { amount: 1, className: null };
  }

  const maybeLast = parts[parts.length - 1];
  const classEntry = resolveSpellcastingClass(profile, maybeLast);

  if (classEntry) {
    className = classEntry.className;
    parts.pop();
  } else {
    const classNames = (profile.classes || []).map((entry) => entry.name);
    const directClass = classNames.find(
      (name) => normalizeName(name) === normalizeName(maybeLast)
    );

    if (directClass) {
      className = directClass;
      parts.pop();
    }
  }

  if (parts.length) {
    const maybeAmount = parseInt(parts[0], 10);
    if (!isNaN(maybeAmount) && maybeAmount > 0) {
      amount = maybeAmount;
    }
  }

  return { amount, className };
}

/* --------------------------- Message Event ---------------------------- */

bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  await handleHelpCommand(message);

  await handleImportCommand(message);
  await handlePortraitCommand(message);
  await handleProfileCommand(message);
  await handleSpellCommand(message);

  await handleRollInitiativeCommand(message);
  await handleInitiativeCommand(message);
  await handleStartCombatCommand(message);
  await handleNextTurnCommand(message);
  await handleTurnOrderCommand(message);
  await handleEndCombatCommand(message);
  await handleRemoveCombatantCommand(message);

  await handleDeathSaveCommand(message);
  await handleResCommand(message);
  await handleFailDeathSaveCommand(message);

  handleSaveCommand(message);
  handleHpModifyCommand(message);
  handleHpViewCommand(message);
  handleCheckCommand(message);
  await handleInventoryCommand(message);
  await handleAddItemCommand(message);
  await handleTossItemCommand(message);
  await handleSetStatCommand(message);
  await handleModStatCommand(message);
  handleRollCommand(message);

  await handleCastCommand(message);
  await handleLongRestCommand(message);
  await handleShortRestCommand(message);

  await handleAvailableSpellsCommand(message);
  await handlePrepareSpellCommand(message);
  await handleSpellbookCommand(message);

  await handleResourcesCommand(message);
  await handleGenericClassResourceCommand(message);

  await handleUnprepareSpellCommand(message);
  await handleCreateLoadoutCommand(message);
  await handleLoadSpellbookCommand(message);
  await handleLoadoutCommand(message);
  
  await handleScrollCommand(message);

  await handleLearnSpellCommand(message);
  await handleUnlearnSpellCommand(message);

  await handleFeatsCommand(message);
  await handleFeatCommand(message);
  await handleExpCommand(message);
  await handleGainExpCommand(message);
  await handleAsiCommand(message);
  await handleSubclassCommand(message);
  await handleChooseSubclassCommand(message);

  await handleCharactersCommand(message);
  await handleSwitchCharacterCommand(message);
  await handleDeleteCharacterCommand(message);

  await handleSpellSlotsCommand(message);
});
/* ------------------------------ Login -------------------------------- */

if (process.env.NO_BOT_LOGIN === "1") {
  console.log("Discord login skipped because NO_BOT_LOGIN=1.");
} else if (process.env.token) {
  bot.login(process.env.token);
} else {
  console.warn("Discord token missing; set token in .env or run with NO_BOT_LOGIN=1.");
}
