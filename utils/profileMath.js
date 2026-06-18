const SKILL_TO_ABILITY = {
  acrobatics: "dex",
  "animal-handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight-of-hand": "dex",
  stealth: "dex",
  survival: "wis",
};
const {
  getCantripsKnownForClassLevel,
  getCasterProgression,
  getClassDefinition,
  getFeatureEntriesForClassLevel,
  getFullCasterSpellSlots,
  getKnownSpellLimitForClassLevel,
  getMysticArcanumProgressionForClassLevel,
  getPactMagicForClassLevel,
  getPreparedSpellLimitForClassEntry,
  getSpellcastingModeForClassName,
  getSubclassRequirementLevel,
  normalizeName,
} = require("./classData");
const {
  getRacialFeaturesForProfile,
  getSelectedFeatFeatures,
} = require("./raceFeatData");

function getClassLevel(profile, classNameToFind) {
  const target = normalizeClassName(classNameToFind);

  return (profile.classes || [])
    .filter((entry) => normalizeClassName(entry.name) === target)
    .reduce((sum, entry) => sum + Number(entry.level ?? 0), 0);
}

function isThirdCasterClassEntry(classEntry) {
  return getCasterProgression(classEntry.name) === "1 3";
}

function getSpellcastingContributionForClassEntry(classEntry) {
  const level = Number(classEntry.level ?? 0);
  const progression = getCasterProgression(classEntry.name);

  if (level <= 0) return 0;

  if (progression === "full") {
    return level;
  }

  if (progression === "artificer") {
    return Math.ceil(level / 2);
  }

  if (progression === "1 2") {
    return Math.floor(level / 2);
  }

  if (progression === "1 3") {
    return Math.floor(level / 3);
  }

  if (progression === "pact") {
    return 0;
  }

  return 0;
}

function getEffectiveMulticlassCasterLevel(profile) {
  return (profile.classes || []).reduce(
    (sum, classEntry) => sum + getSpellcastingContributionForClassEntry(classEntry),
    0
  );
}

function normalizeClassName(className) {
  return normalizeName(className);
}

function normalizeSubclassName(subclassName) {
  return normalizeName(subclassName);
}

function clampMinimumOne(value) {
  return Math.max(1, Number(value ?? 1));
}

function getMaxSpellSlotsForProfile(profile) {
  const effectiveCasterLevel = getEffectiveMulticlassCasterLevel(profile);

  if (effectiveCasterLevel <= 0) {
    return {};
  }

  return { ...getFullCasterSpellSlots(effectiveCasterLevel) };
}
function getPactMagicSlotsForProfile(profile) {
  for (const classEntry of profile.classes || []) {
    const pactMagic = getPactMagicForClassLevel(classEntry.name, classEntry.level);

    if (pactMagic.slots > 0) {
      return pactMagic;
    }
  }

  return {
    slotLevel: 0,
    slots: 0,
  };
}

function resetSpellSlots(profile) {
  const maxSlots = getMaxSpellSlotsForProfile(profile);
  const pactMagic = getPactMagicSlotsForProfile(profile);

  profile.spellSlots = {
    current: { ...maxSlots },
    max: { ...maxSlots },
  };

  profile.pactMagicSlots = {
    current: pactMagic.slots,
    max: pactMagic.slots,
    slotLevel: pactMagic.slotLevel,
  };

  return profile;
}

function getAbilityMod(profile, ability) {
  return Number(profile?.abilityModifiers?.[ability] ?? 0);
}

function getHighestSpellSlotLevel(profile) {
  const maxSlots = profile.spellSlots?.max || {};
  const normalLevels = Object.keys(maxSlots)
    .map(Number)
    .filter((level) => Number(maxSlots[level] ?? 0) > 0);

  const pactLevel = Number(profile.pactMagicSlots?.slotLevel ?? 0);
  const allLevels = pactLevel > 0 ? [...normalLevels, pactLevel] : normalLevels;

  if (!allLevels.length) return 0;
  return Math.max(...allLevels);
}

function getSpellcastingMode(profile) {
  return getSpellcastingModeForClassName(profile.class);
}

function getPreparedSpellLimit(profile) {
  return getPreparedSpellLimitForClassEntry(profile, {
    name: profile.class,
    level: profile.level,
  });
}

function rebuildSpellcasting(profile) {
  const mode = getSpellcastingMode(profile);
  const preparedLimit = getPreparedSpellLimit(profile);
  const primaryClass = getPrimaryClass(profile);
  const primarySpellcastingEntry = primaryClass
    ? profile.spellcastingByClass?.[getClassSpellcastingKey(primaryClass.name)] || null
    : null;

  if (!profile.spellcasting) {
    profile.spellcasting = {
      mode,
      preparedLimit,
      cantripsKnown: Number(primarySpellcastingEntry?.cantripsKnown ?? 0),
      knownSpellLimit: Number(primarySpellcastingEntry?.knownSpellLimit ?? 0),
      preparedSpells: [],
      knownSpells: [],
      loadouts: {},
    };
    return profile;
  }

  profile.spellcasting.mode = mode;
  profile.spellcasting.preparedLimit = preparedLimit;
  profile.spellcasting.cantripsKnown = Number(primarySpellcastingEntry?.cantripsKnown ?? 0);
  profile.spellcasting.knownSpellLimit = Number(primarySpellcastingEntry?.knownSpellLimit ?? 0);

  if (!Array.isArray(profile.spellcasting.preparedSpells)) {
    profile.spellcasting.preparedSpells = [];
  }

  if (!Array.isArray(profile.spellcasting.knownSpells)) {
    profile.spellcasting.knownSpells = [];
  }

  if (
    !profile.spellcasting.loadouts ||
    typeof profile.spellcasting.loadouts !== "object" ||
    Array.isArray(profile.spellcasting.loadouts)
  ) {
    profile.spellcasting.loadouts = {};
  }

  return profile;
}

function getClassResourcesForProfile(profile) {
  const className = normalizeClassName(profile.class);
  const subclassName = normalizeSubclassName(profile.subclass);
  const level = Number(profile.level ?? 1);
  const proficiencyBonus = Number(profile.proficiencyBonus ?? 2);

  const resources = {};

  if (className === "warlock") {
  if (level >= 11) {
    resources.mysticArcanum6 = {
      label: "Mystic Arcanum (6th)",
      command: "mysticarcanum6",
      emoji: "🌌",
      max: 1,
      recharge: "long",
    };
  }

  if (level >= 13) {
    resources.mysticArcanum7 = {
      label: "Mystic Arcanum (7th)",
      command: "mysticarcanum7",
      emoji: "🌌",
      max: 1,
      recharge: "long",
    };
  }

  if (level >= 15) {
    resources.mysticArcanum8 = {
      label: "Mystic Arcanum (8th)",
      command: "mysticarcanum8",
      emoji: "🌌",
      max: 1,
      recharge: "long",
    };
  }

  if (level >= 17) {
    resources.mysticArcanum9 = {
      label: "Mystic Arcanum (9th)",
      command: "mysticarcanum9",
      emoji: "🌌",
      max: 1,
      recharge: "long",
    };
  }
}
  if (className === "fighter") {
    if (level >= 1) {
      resources.secondWind = {
        label: "Second Wind",
        command: "secondwind",
        emoji: "💨",
        max: 1,
        recharge: "short",
      };
    }

    if (level >= 2) {
      resources.actionSurge = {
        label: "Action Surge",
        command: "actionsurge",
        emoji: "⚔️",
        max: level >= 17 ? 2 : 1,
        recharge: "short",
      };
    }

    if (level >= 9) {
      let maxUses = 1;
      if (level >= 13) maxUses = 2;
      if (level >= 17) maxUses = 3;

      resources.indomitable = {
        label: "Indomitable",
        command: "indomitable",
        emoji: "🛡️",
        max: maxUses,
        recharge: "long",
      };
    }

    if (subclassName === "battle master") {
      let diceCount = 4;
      if (level >= 7) diceCount = 5;
      if (level >= 15) diceCount = 6;

      resources.superiorityDice = {
        label: "Superiority Dice",
        command: "superioritydice",
        emoji: "🎯",
        max: diceCount,
        recharge: "short",
      };
    }

    if (subclassName === "arcane archer" && level >= 3) {
      resources.arcaneShot = {
        label: "Arcane Shot",
        command: "arcaneshot",
        emoji: "🏹",
        max: 2,
        recharge: "short",
      };
    }

    if (subclassName === "samurai" && level >= 3) {
      resources.fightingSpirit = {
        label: "Fighting Spirit",
        command: "fightingspirit",
        emoji: "🔥",
        max: 3,
        recharge: "short",
      };
    }

    if (subclassName === "psi warrior" && level >= 3) {
      resources.psionicEnergy = {
        label: "Psionic Energy Dice",
        command: "psionicenergy",
        emoji: "🧠",
        max: proficiencyBonus * 2,
        recharge: "long",
      };
    }
  }

  if (className === "cleric" || className === "paladin") {
    const qualifies =
      (className === "cleric" && level >= 2) ||
      (className === "paladin" && level >= 3);

    if (qualifies) {
      let maxUses = 1;
      if (level >= 6) maxUses = 2;
      if (level >= 18) maxUses = 3;

      resources.channelDivinity = {
        label: "Channel Divinity",
        command: "channeldivinity",
        emoji: "✨",
        max: maxUses,
        recharge: "short",
      };
    }
  }

  if (className === "cleric" && subclassName === "war domain" && level >= 1) {
    resources.warPriest = {
      label: "War Priest",
      command: "warpriest",
      emoji: "⚒️",
      max: clampMinimumOne(getAbilityMod(profile, "wis")),
      recharge: "long",
    };
  }

  if (className === "barbarian") {
    let maxUses = 0;
    if (level >= 1 && level <= 2) maxUses = 2;
    else if (level >= 3 && level <= 5) maxUses = 3;
    else if (level >= 6 && level <= 11) maxUses = 4;
    else if (level >= 12 && level <= 16) maxUses = 5;
    else if (level >= 17 && level <= 19) maxUses = 6;
    else if (level >= 20) maxUses = 999;

    if (maxUses > 0) {
      resources.rage = {
        label: "Rage",
        command: "rage",
        emoji: "😡",
        max: maxUses,
        recharge: "long",
      };
    }
  }

  if (className === "bard" && level >= 1) {
    resources.bardicInspiration = {
      label: "Bardic Inspiration",
      command: "bardicinspiration",
      emoji: "🎵",
      max: clampMinimumOne(getAbilityMod(profile, "cha")),
      recharge: "long",
    };
  }

  if (className === "druid" && level >= 2) {
    resources.wildShape = {
      label: "Wild Shape",
      command: "wildshape",
      emoji: "🐾",
      max: 2,
      recharge: "short",
    };
  }

  if (className === "monk" && level >= 2) {
    resources.ki = {
      label: "Ki Points",
      command: "ki",
      emoji: "☯️",
      max: level,
      recharge: "short",
    };
  }

  if (className === "paladin" && level >= 1) {
    resources.layOnHands = {
      label: "Lay on Hands Pool",
      command: "layonhands",
      emoji: "🤲",
      max: level * 5,
      recharge: "long",
    };
  }

  if (className === "ranger" && level >= 1) {
    resources.favoredFoe = {
      label: "Favored Foe",
      command: "favoredfoe",
      emoji: "🏕️",
      max: proficiencyBonus,
      recharge: "long",
    };
  }

  if (className === "rogue" && subclassName === "phantom" && level >= 3) {
    resources.wailsFromTheGrave = {
      label: "Wails from the Grave",
      command: "wailsfromthegrave",
      emoji: "👻",
      max: proficiencyBonus,
      recharge: "long",
    };
  }

  if (className === "rogue" && subclassName === "soulknife" && level >= 3) {
    resources.psionicEnergy = {
      label: "Psionic Energy Dice",
      command: "psionicenergy",
      emoji: "🧠",
      max: proficiencyBonus * 2,
    };
  }

  if (className === "sorcerer" && level >= 2) {
    resources.sorceryPoints = {
      label: "Sorcery Points",
      command: "sorcerypoints",
      emoji: "🔮",
      max: level,
      recharge: "long",
    };
  }

  if (className === "wizard" && level >= 1) {
    resources.arcaneRecovery = {
      label: "Arcane Recovery",
      command: "arcanerecovery",
      emoji: "📘",
      max: 1,
      recharge: "short",
    };
  }

  if (className === "wizard" && subclassName === "school of divination" && level >= 2) {
    resources.portent = {
      label: "Portent Dice",
      command: "portent",
      emoji: "🔮",
      max: level >= 14 ? 3 : 2,
      recharge: "long",
    };
  }

  if (className === "artificer" && level >= 7) {
    resources.flashOfGenius = {
      label: "Flash of Genius",
      command: "flashofgenius",
      emoji: "💡",
      max: clampMinimumOne(getAbilityMod(profile, "int")),
      recharge: "long",
    };
  }

  if (className === "artificer" && subclassName === "battle smith" && level >= 9) {
    resources.arcaneJolt = {
      label: "Arcane Jolt",
      command: "arcanejolt",
      emoji: "⚡",
      max: clampMinimumOne(getAbilityMod(profile, "int")),
      recharge: "long",
    };
  }

  return resources;
}

function resetShortRestResources(profile) {
  rebuildClassResourcesByClass(profile);

  for (const classEntry of Object.values(profile.classResourcesByClass || {})) {
    for (const resource of Object.values(classEntry.resources || {})) {
      if (resource.recharge === "short") {
        resource.current = resource.max;
      }
    }
  }

  const primaryClass = getPrimaryClass(profile);
  if (primaryClass) {
    const primaryKey = getClassSpellcastingKey(primaryClass.name);
    profile.classResources =
      profile.classResourcesByClass?.[primaryKey]?.resources || {};
  }

  return profile;
}

function rebuildHitDice(profile) {
  const totalLevel = getTotalCharacterLevel(profile);

  const previousPools = profile.hitDice?.pools || [];
  const previousPoolMap = {};

  for (const pool of previousPools) {
    previousPoolMap[Number(pool.dieSize)] = Number(pool.current ?? 0);
  }

  const poolsMap = {};

  for (const classEntry of profile.classes || []) {
    const dieSize = Number(classEntry.hitDie ?? 0);
    const level = Number(classEntry.level ?? 0);

    if (dieSize <= 0 || level <= 0) continue;

    if (!poolsMap[dieSize]) {
      poolsMap[dieSize] = {
        dieSize,
        current: 0,
        max: 0,
      };
    }

    poolsMap[dieSize].max += level;
  }

  const pools = Object.values(poolsMap)
    .sort((a, b) => a.dieSize - b.dieSize)
    .map((pool) => {
      const oldCurrent = previousPoolMap[pool.dieSize];
      return {
        dieSize: pool.dieSize,
        max: pool.max,
        current:
          oldCurrent !== undefined
            ? Math.min(oldCurrent, pool.max)
            : pool.max,
      };
    });

  // Backward-compatible summary fields for old code.
  const primaryClass = getPrimaryClass(profile);
  const primaryDieSize = Number(primaryClass?.hitDie ?? 0);
  const primaryPool =
    pools.find((pool) => pool.dieSize === primaryDieSize) || null;

  profile.hitDice = {
    dieSize: primaryDieSize,
    current: primaryPool ? primaryPool.current : totalLevel,
    max: primaryPool ? primaryPool.max : totalLevel,
    pools,
  };

  return profile;
}

function rebuildClassResources(profile) {
  const derivedResources = getClassResourcesForProfile(profile);
  const existing = profile.classResources || {};
  const rebuilt = {};

  for (const [key, resource] of Object.entries(derivedResources)) {
    const oldCurrent = Number(existing[key]?.current ?? resource.max);

    rebuilt[key] = {
      ...resource,
      current: Math.min(oldCurrent, resource.max),
      max: resource.max,
    };
  }

  profile.classResources = rebuilt;
  return profile;
}

function resetLongRestResources(profile) {
  rebuildClassResourcesByClass(profile);

  for (const classEntry of Object.values(profile.classResourcesByClass || {})) {
    for (const resource of Object.values(classEntry.resources || {})) {
      resource.current = resource.max;
    }
  }

  const primaryClass = getPrimaryClass(profile);
  if (primaryClass) {
    const primaryKey = getClassSpellcastingKey(primaryClass.name);
    profile.classResources =
      profile.classResourcesByClass?.[primaryKey]?.resources || {};
  }

  return profile;
}

function calculateAbilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

function ensureProfileCollections(profile) {
  if (typeof profile.experience !== "number") {
    profile.experience = Number(profile.experience ?? 0) || 0;
  }

  if (!profile.abilityModifiers || typeof profile.abilityModifiers !== "object") {
    profile.abilityModifiers = {};
  }

  if (!profile.savingThrows || typeof profile.savingThrows !== "object") {
    profile.savingThrows = {};
  }

  if (!profile.skills || typeof profile.skills !== "object") {
    profile.skills = {};
  }

  if (!profile.spellcastingByClass || typeof profile.spellcastingByClass !== "object") {
    profile.spellcastingByClass = {};
  }

  if (!profile.classResourcesByClass || typeof profile.classResourcesByClass !== "object") {
    profile.classResourcesByClass = {};
  }

  if (!Array.isArray(profile.characterFeatures)) {
    profile.characterFeatures = [];
  }

  if (!Array.isArray(profile.racialFeatures)) {
    profile.racialFeatures = [];
  }

  if (!Array.isArray(profile.selectedFeats)) {
    profile.selectedFeats = [];
  }

  if (!Array.isArray(profile.selectedFeatFeatures)) {
    profile.selectedFeatFeatures = [];
  }

  if (!profile.featuresByClass || typeof profile.featuresByClass !== "object") {
    profile.featuresByClass = {};
  }

  if (!Array.isArray(profile.pendingSubclassSelections)) {
    profile.pendingSubclassSelections = [];
  }

  if (typeof profile.pendingAsiPoints !== "number") {
    profile.pendingAsiPoints = Number(profile.pendingAsiPoints ?? 0) || 0;
  }
}

function rebuildCharacterFeatures(profile) {
  const byClass = {};
  const allFeatures = [];

  for (const classEntry of profile.classes || []) {
    const classKey = getClassSpellcastingKey(classEntry.name);
    const features = getFeatureEntriesForClassLevel(
      classEntry.name,
      classEntry.subclass,
      classEntry.level
    );

    byClass[classKey] = {
      className: classEntry.name,
      subclass: classEntry.subclass || "",
      features,
    };

    allFeatures.push(...features);
  }

  profile.featuresByClass = byClass;
  profile.characterFeatures = [...allFeatures].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.className !== b.className) return a.className.localeCompare(b.className);
    return a.name.localeCompare(b.name);
  });

  return profile;
}

function rebuildRacialAndSelectedFeatFeatures(profile) {
  profile.racialFeatures = getRacialFeaturesForProfile(profile);
  profile.selectedFeatFeatures = getSelectedFeatFeatures(profile);
  return profile;
}

function rebuildPendingSubclassSelections(profile) {
  profile.pendingSubclassSelections = (profile.classes || [])
    .filter((classEntry) => {
      const requiredLevel = getSubclassRequirementLevel(classEntry.name);
      return (
        requiredLevel &&
        Number(classEntry.level ?? 0) >= requiredLevel &&
        !String(classEntry.subclass || "").trim()
      );
    })
    .map((classEntry) => classEntry.name);

  return profile;
}

function recalculateDerivedStats(profile) {
  const migratedProfile = JSON.parse(JSON.stringify(profile));
  migrateProfileToMulticlassShape(migratedProfile);
  const newProfile = migratedProfile;
  ensureProfileCollections(newProfile);

  newProfile.totalLevel = getTotalCharacterLevel(newProfile);
  newProfile.proficiencyBonus = calculateProficiencyBonusFromLevel(
    newProfile.totalLevel
  );
  rebuildLegacyPrimaryClassFields(newProfile);

  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    const score = newProfile.abilities?.[ability] ?? 10;
    newProfile.abilityModifiers[ability] = calculateAbilityModifier(score);
  }

  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    const modifier = newProfile.abilityModifiers?.[ability] ?? 0;
    const proficient = newProfile.savingThrowProficiencies?.[ability] ?? false;
    const proficiencyBonus = Number(newProfile.proficiencyBonus ?? 2);

    newProfile.savingThrows[ability] =
      modifier + (proficient ? proficiencyBonus : 0);
  }

  for (const [skillName, ability] of Object.entries(SKILL_TO_ABILITY)) {
    const modifier = newProfile.abilityModifiers?.[ability] ?? 0;
    const proficient = newProfile.skillProficiencies?.[skillName] ?? false;
    const expertise = newProfile.skillExpertise?.[skillName] ?? false;
    const proficiencyBonus = Number(newProfile.proficiencyBonus ?? 2);

    let total = modifier;

    if (expertise) {
      total += proficiencyBonus * 2;
    } else if (proficient) {
      total += proficiencyBonus;
    }

    newProfile.skills[skillName] =
      total >= 0 ? `+${total}` : `${total}`;
  }

  const wisMod = newProfile.abilityModifiers?.wis ?? 0;
  const perceptionBonus = parseInt(newProfile.skills?.perception ?? "0", 10);

  newProfile.passivePerception = 10 + perceptionBonus;

    const newMaxSpellSlots = getMaxSpellSlotsForProfile(newProfile);

  if (!newProfile.spellSlots) {
    newProfile.spellSlots = {
      current: { ...newMaxSpellSlots },
      max: { ...newMaxSpellSlots },
    };
  } else {
    const oldCurrent = newProfile.spellSlots.current || {};
    const rebuiltCurrent = {};

    for (const [slotLevel, maxValue] of Object.entries(newMaxSpellSlots)) {
      const oldValue = Number(oldCurrent[slotLevel] ?? maxValue);
      rebuiltCurrent[slotLevel] = Math.min(oldValue, maxValue);
    }

    newProfile.spellSlots.max = { ...newMaxSpellSlots };
    newProfile.spellSlots.current = rebuiltCurrent;
  }

  const newPactMagic = getPactMagicSlotsForProfile(newProfile);

  if (!newProfile.pactMagicSlots) {
    newProfile.pactMagicSlots = {
      current: newPactMagic.slots,
      max: newPactMagic.slots,
      slotLevel: newPactMagic.slotLevel,
    };
  } else {
    newProfile.pactMagicSlots = {
      current: Math.min(
        Number(newProfile.pactMagicSlots.current ?? newPactMagic.slots),
        newPactMagic.slots
      ),
      max: newPactMagic.slots,
      slotLevel: newPactMagic.slotLevel,
    };
  }

  rebuildSpellcastingByClass(newProfile);
  rebuildClassResourcesByClass(newProfile);
  rebuildHitDice(newProfile);
  rebuildSpellcasting(newProfile);
  rebuildCharacterFeatures(newProfile);
  rebuildRacialAndSelectedFeatFeatures(newProfile);
  rebuildPendingSubclassSelections(newProfile);
  return newProfile;
}

function normalizeClassEntry(entry) {
  const classDef = getClassDefinition(entry?.name);
  const derivedHitDie = Number(classDef?.rawClass?.hd?.faces ?? 0);

  return {
    name: String(entry?.name || "").trim(),
    subclass: String(entry?.subclass || "").trim(),
    level: Number(entry?.level ?? 1),
    hitDie: Number(entry?.hitDie ?? derivedHitDie ?? 0),
  };
}

function migrateProfileToMulticlassShape(profile) {
  if (!profile || typeof profile !== "object") {
    return profile;
  }

  if (!Array.isArray(profile.classes) || profile.classes.length === 0) {
    if (profile.class) {
      profile.classes = [
        {
          name: String(profile.class || "").trim(),
          subclass: String(profile.subclass || "").trim(),
          level: Number(profile.level ?? 1),
          hitDie: Number(profile.hitDie ?? 0),
        },
      ];
    } else {
      profile.classes = [];
    }
  }

  profile.classes = profile.classes.map(normalizeClassEntry);
  profile.totalLevel = getTotalCharacterLevel(profile);
  rebuildLegacyPrimaryClassFields(profile);

  return profile;
}

function getPrimaryClass(profile) {
  if (!Array.isArray(profile.classes) || profile.classes.length === 0) {
    return null;
  }

  return profile.classes[0];
}

function calculateProficiencyBonusFromLevel(totalLevel) {
  const level = Number(totalLevel ?? 1);
  return Math.floor((level - 1) / 4) + 2;
}

function getTotalCharacterLevel(profile) {
  if (!Array.isArray(profile.classes) || profile.classes.length === 0) {
    return Number(profile.level ?? 1);
  }

  return profile.classes.reduce(
    (sum, classEntry) => sum + Number(classEntry.level ?? 0),
    0
  );
}

function rebuildLegacyPrimaryClassFields(profile) {
  const primaryClass = getPrimaryClass(profile);

  if (!primaryClass) {
    return profile;
  }

  profile.class = primaryClass.name;
  profile.subclass = primaryClass.subclass;
  profile.level = primaryClass.level;
  profile.hitDie = primaryClass.hitDie;

  return profile;
}

function getClassSpellcastingKey(className) {
  return normalizeClassName(className);
}

function getPreparedSpellLimitForClass(profile, classEntry) {
  return getPreparedSpellLimitForClassEntry(profile, classEntry);
}

function rebuildSpellcastingByClass(profile) {
  const existing = profile.spellcastingByClass || {};
  const rebuilt = {};

  for (const classEntry of profile.classes || []) {
    const key = getClassSpellcastingKey(classEntry.name);
    const mode = getSpellcastingModeForClassName(classEntry.name);
    const preparedLimit = getPreparedSpellLimitForClass(profile, classEntry);
    const cantripsKnown = getCantripsKnownForClassLevel(
      classEntry.name,
      Number(classEntry.level ?? 0)
    );
    const knownSpellLimit = getKnownSpellLimitForClassLevel(
      classEntry.name,
      Number(classEntry.level ?? 0)
    );
    const oldEntry = existing[key] || null;

    rebuilt[key] = {
      className: classEntry.name,
      subclass: classEntry.subclass || "",
      mode,
      preparedLimit,
      cantripsKnown,
      knownSpellLimit,
      mysticArcanum: getMysticArcanumProgressionForClassLevel(
        classEntry.name,
        Number(classEntry.level ?? 0)
      ),
      preparedSpells: Array.isArray(oldEntry?.preparedSpells)
        ? oldEntry.preparedSpells
        : [],
      knownSpells: Array.isArray(oldEntry?.knownSpells)
        ? oldEntry.knownSpells
        : [],
      loadouts:
        oldEntry?.loadouts &&
        typeof oldEntry.loadouts === "object" &&
        !Array.isArray(oldEntry.loadouts)
          ? oldEntry.loadouts
          : {},
    };
  }

  // One-time migration from old single-class spellcasting field.
  if (
    profile.spellcasting &&
    Object.keys(rebuilt).length > 0
  ) {
    const primaryClass = getPrimaryClass(profile);
    const primaryKey = primaryClass
      ? getClassSpellcastingKey(primaryClass.name)
      : null;

    if (
      primaryKey &&
      rebuilt[primaryKey] &&
      rebuilt[primaryKey].preparedSpells.length === 0 &&
      rebuilt[primaryKey].knownSpells.length === 0
    ) {
      rebuilt[primaryKey].preparedSpells = Array.isArray(profile.spellcasting.preparedSpells)
        ? profile.spellcasting.preparedSpells
        : [];
      rebuilt[primaryKey].knownSpells = Array.isArray(profile.spellcasting.knownSpells)
        ? profile.spellcasting.knownSpells
        : [];
      rebuilt[primaryKey].loadouts =
        profile.spellcasting.loadouts &&
        typeof profile.spellcasting.loadouts === "object" &&
        !Array.isArray(profile.spellcasting.loadouts)
          ? profile.spellcasting.loadouts
          : {};
    }
  }

  profile.spellcastingByClass = rebuilt;

  // Keep legacy field synced to the primary class for backward compatibility.
  const primaryClass = getPrimaryClass(profile);
  const primaryKey = primaryClass
    ? getClassSpellcastingKey(primaryClass.name)
    : null;

  if (primaryKey && rebuilt[primaryKey]) {
    profile.spellcasting = {
      mode: rebuilt[primaryKey].mode,
      preparedLimit: rebuilt[primaryKey].preparedLimit,
      cantripsKnown: rebuilt[primaryKey].cantripsKnown,
      knownSpellLimit: rebuilt[primaryKey].knownSpellLimit,
      preparedSpells: [...rebuilt[primaryKey].preparedSpells],
      knownSpells: [...rebuilt[primaryKey].knownSpells],
      loadouts: { ...rebuilt[primaryKey].loadouts },
    };
  }

  return profile;
}

function rebuildClassResourcesByClass(profile) {
  const existing = profile.classResourcesByClass || {};
  const rebuilt = {};

  for (const classEntry of profile.classes || []) {
    const classKey = getClassSpellcastingKey(classEntry.name);
    const derivedProfileForClass = {
      ...profile,
      class: classEntry.name,
      subclass: classEntry.subclass,
      level: classEntry.level,
    };

    const derivedResources = getClassResourcesForProfile(derivedProfileForClass);
    const oldClassResources = existing[classKey] || {};
    const rebuiltClassResources = {};

    for (const [resourceKey, resource] of Object.entries(derivedResources)) {
      const oldCurrent = Number(oldClassResources[resourceKey]?.current ?? resource.max);

      rebuiltClassResources[resourceKey] = {
        ...resource,
        current: Math.min(oldCurrent, resource.max),
        max: resource.max,
      };
    }

    rebuilt[classKey] = {
      className: classEntry.name,
      subclass: classEntry.subclass || "",
      resources: rebuiltClassResources,
    };
  }

  profile.classResourcesByClass = rebuilt;

  // Keep legacy flat classResources synced to primary class
  const primaryClass = getPrimaryClass(profile);
  if (primaryClass) {
    const primaryKey = getClassSpellcastingKey(primaryClass.name);
    profile.classResources =
      profile.classResourcesByClass?.[primaryKey]?.resources || {};
  }

  return profile;
}

module.exports = {
  calculateAbilityModifier,
  recalculateDerivedStats,
  SKILL_TO_ABILITY,
  getMaxSpellSlotsForProfile,
  resetSpellSlots,
  getClassResourcesForProfile,
  rebuildClassResources,
  rebuildClassResourcesByClass,
  resetLongRestResources,
  resetShortRestResources,
  rebuildHitDice,
  getHighestSpellSlotLevel,
  getSpellcastingMode,
  getPreparedSpellLimit,
  rebuildSpellcasting,
  migrateProfileToMulticlassShape,
  getTotalCharacterLevel,
  calculateProficiencyBonusFromLevel,
  getEffectiveMulticlassCasterLevel,
  getPactMagicSlotsForProfile,
  getClassLevel,
  rebuildSpellcastingByClass,
  getClassSpellcastingKey,
  getPrimaryClass,
};
