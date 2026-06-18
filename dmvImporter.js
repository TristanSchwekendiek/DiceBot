const DEFAULT_PLAYER_PROFILE = {
  playerName: "",
  characterName: "",
  race: "",
  subrace: "",
  alignment: "",
  background: "",

  class: "",
  subclass: "",
  level: 1,
  hitDie: 0,

  classes: [],
  totalLevel: 1,

  experience: 0,
  ac: 10,
  hp: {
    current: 1,
    max: 1,
  },
  initiative: 0,
  passivePerception: 10,
  proficiencyBonus: 2,
  abilities: {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  },
  abilityModifiers: {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  },
  savingThrows: {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  },
  savingThrowProficiencies: {
    str: false,
    dex: false,
    con: false,
    int: false,
    wis: false,
    cha: false,
  },
  skillProficiencies: {
    acrobatics: false,
    "animal-handling": false,
    arcana: false,
    athletics: false,
    deception: false,
    history: false,
    insight: false,
    intimidation: false,
    investigation: false,
    medicine: false,
    nature: false,
    perception: false,
    performance: false,
    persuasion: false,
    religion: false,
    "sleight-of-hand": false,
    stealth: false,
    survival: false,
  },
  skillExpertise: {
    acrobatics: false,
    "animal-handling": false,
    arcana: false,
    athletics: false,
    deception: false,
    history: false,
    insight: false,
    intimidation: false,
    investigation: false,
    medicine: false,
    nature: false,
    perception: false,
    performance: false,
    persuasion: false,
    religion: false,
    "sleight-of-hand": false,
    stealth: false,
    survival: false,
  },
  skills: {},
  inventory: [],
  spellSlots: {
    current: {},
    max: {},
  },
  spellcasting: {
    mode: "none",
    preparedLimit: 0,
    preparedSpells: [],
    knownSpells: [],
    loadouts: {},
  },
  classResources: {},
  classResourcesByClass: {},
  spellcastingByClass: {},
  characterFeatures: [],
  racialFeatures: [],
  selectedFeats: [],
  selectedFeatFeatures: [],
  featuresByClass: {},
  pendingAsiPoints: 0,
  pendingSubclassSelections: [],
  levelUpHistory: [],
  hitDice: {
    dieSize: 0,
    current: 0,
    max: 0,
  },
  deathSaves: {
    successes: 0,
    failures: 0,
  },
};

const { recalculateDerivedStats } = require("./utils/profileMath");

function extractSkillProficiencies(character) {
  const skillData = character.skills || {};

  return {
    acrobatics: skillData["acrobatics-check"] ?? false,
    "animal-handling": skillData["animal-handling-check"] ?? false,
    arcana: skillData["arcana-check"] ?? false,
    athletics: skillData["athletics-check"] ?? false,
    deception: skillData["deception-check"] ?? false,
    history: skillData["history-check"] ?? false,
    insight: skillData["insight-check"] ?? false,
    intimidation: skillData["intimidation-check"] ?? false,
    investigation: skillData["investigation-check"] ?? false,
    medicine: skillData["medicine-check"] ?? false,
    nature: skillData["nature-check"] ?? false,
    perception: skillData["perception-check"] ?? false,
    performance: skillData["performance-check"] ?? false,
    persuasion: skillData["persuasion-check"] ?? false,
    religion: skillData["religion-check"] ?? false,
    "sleight-of-hand": skillData["sleight-of-hand-check"] ?? false,
    stealth: skillData["stealth-check"] ?? false,
    survival: skillData["survival-check"] ?? false,
  };
}

function extractSavingThrowProficiencies(character, abilitiesBlock) {
  const result = {
    str: false,
    dex: false,
    con: false,
    int: false,
    wis: false,
    cha: false,
  };

  const proficiencyBonus = Number(character.proficiency_bonus ?? 2);
  const modifiers = abilitiesBlock?.bonuses || {};
  const saves = character.save_bonuses || {};

  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    const expectedUnproficient = modifiers[ability] ?? 0;
    const actualSave = saves[ability] ?? 0;

    if (actualSave === expectedUnproficient + proficiencyBonus) {
      result[ability] = true;
    }
  }

  return result;
}

function extractInventory(character) {
  const inventory = [];

  if (!Array.isArray(character.equipment) || character.equipment.length === 0) {
    return inventory;
  }

  const equipmentBlock = character.equipment[0];

  if (equipmentBlock.equipment) {
    for (const [itemName, itemData] of Object.entries(equipmentBlock.equipment)) {
      inventory.push({
        name: itemName,
        quantity: itemData?.quantity ?? 1,
        equipped: itemData?.["equipped?"] ?? false,
        category: "equipment",
      });
    }
  }

  if (equipmentBlock.armor) {
    for (const [itemName, itemData] of Object.entries(equipmentBlock.armor)) {
      inventory.push({
        name: itemName,
        quantity: itemData?.quantity ?? 1,
        equipped: itemData?.["equipped?"] ?? false,
        category: "armor",
      });
    }
  }

  if (Array.isArray(equipmentBlock.weapons)) {
    for (const weaponEntry of equipmentBlock.weapons) {
      const [itemName, itemData] = weaponEntry;

      inventory.push({
        name: itemName,
        quantity: itemData?.quantity ?? 1,
        equipped: itemData?.["equipped?"] ?? false,
        category: "weapon",
      });
    }
  }

  return inventory;
}

function importDMVCharacter(rawData) {
  const character = Array.isArray(rawData.character) ? rawData.character[0] : null;

  if (!character) {
    throw new Error("Invalid character file: missing character data.");
  }

  const abilitiesBlock = Array.isArray(character.abilities_bonuses)
    ? character.abilities_bonuses[0]
    : null;

  const hpBlock = Array.isArray(character.hp) ? character.hp[0] : null;

const rawClasses = character.classes || {};
const classEntries = Object.entries(rawClasses);

const importedClasses = classEntries.map(([classKey, classData]) => ({
  name: classData?.["class-name"] ?? classKey ?? "",
  subclass: classData?.["subclass-name"] ?? "",
  level: Number(classData?.["class-level"] ?? 1),
  hitDie: Number(classData?.["hit-die"] ?? 0),
}));

const firstClass = importedClasses.length > 0 ? importedClasses[0] : null;

  const hpMax = hpBlock?.hp_max ?? DEFAULT_PLAYER_PROFILE.hp.max;
  const hpCurrent = hpBlock?.hp_current ?? hpMax;

  const importedProfile = {
  ...DEFAULT_PLAYER_PROFILE,
  playerName: rawData.player_name || DEFAULT_PLAYER_PROFILE.playerName,
  characterName: character.character_name || DEFAULT_PLAYER_PROFILE.characterName,
  race: character.race || DEFAULT_PLAYER_PROFILE.race,
  subrace: character.subrace || DEFAULT_PLAYER_PROFILE.subrace,
  alignment: character.alignment || DEFAULT_PLAYER_PROFILE.alignment,
  background: character.background || DEFAULT_PLAYER_PROFILE.background,

  class: firstClass?.name ?? DEFAULT_PLAYER_PROFILE.class,
  subclass: firstClass?.subclass ?? DEFAULT_PLAYER_PROFILE.subclass,
  level: firstClass?.level ?? DEFAULT_PLAYER_PROFILE.level,
  hitDie: firstClass?.hitDie ?? DEFAULT_PLAYER_PROFILE.hitDie,
  spellcastingByClass: {},
  classResourcesByClass: {},

classes: importedClasses,
totalLevel:
  importedClasses.reduce((sum, classEntry) => sum + Number(classEntry.level ?? 0), 0) ||
  DEFAULT_PLAYER_PROFILE.totalLevel,

  experience: character.experience ?? DEFAULT_PLAYER_PROFILE.experience,
  ac: character.ac ?? DEFAULT_PLAYER_PROFILE.ac,
  hp: {
    current: hpCurrent,
    max: hpMax,
  },
  initiative: character.initiative_bonus ?? DEFAULT_PLAYER_PROFILE.initiative,
  passivePerception:
    character.passive_perception ?? DEFAULT_PLAYER_PROFILE.passivePerception,
  proficiencyBonus: Number(
    character.proficiency_bonus ?? DEFAULT_PLAYER_PROFILE.proficiencyBonus
  ),
  inventory: extractInventory(character),
  abilities: {
    str: abilitiesBlock?.abilities?.str ?? DEFAULT_PLAYER_PROFILE.abilities.str,
    dex: abilitiesBlock?.abilities?.dex ?? DEFAULT_PLAYER_PROFILE.abilities.dex,
    con: abilitiesBlock?.abilities?.con ?? DEFAULT_PLAYER_PROFILE.abilities.con,
    int: abilitiesBlock?.abilities?.int ?? DEFAULT_PLAYER_PROFILE.abilities.int,
    wis: abilitiesBlock?.abilities?.wis ?? DEFAULT_PLAYER_PROFILE.abilities.wis,
    cha: abilitiesBlock?.abilities?.cha ?? DEFAULT_PLAYER_PROFILE.abilities.cha,
  },
  abilityModifiers: {
    ...DEFAULT_PLAYER_PROFILE.abilityModifiers,
  },
  savingThrows: {
    ...DEFAULT_PLAYER_PROFILE.savingThrows,
  },
  skills: {
    ...DEFAULT_PLAYER_PROFILE.skills,
  },
  savingThrowProficiencies: extractSavingThrowProficiencies(character, abilitiesBlock),
  skillProficiencies: extractSkillProficiencies(character),
  skillExpertise: {
    ...DEFAULT_PLAYER_PROFILE.skillExpertise,
  },
};

return recalculateDerivedStats(importedProfile);
}

module.exports = {
  DEFAULT_PLAYER_PROFILE,
  importDMVCharacter,
};
