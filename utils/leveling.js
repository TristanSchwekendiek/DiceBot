const {
  getFeatureEntriesForClassLevel,
  getFeaturesGrantedAtLevel,
  getSubclassRequirementLevel,
  getSubclassOptions,
  normalizeName,
} = require("./classData");
const {
  getTotalCharacterLevel,
  recalculateDerivedStats,
} = require("./profileMath");

const XP_THRESHOLDS = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

function isAbilityScoreImprovementFeature(feature) {
  return normalizeName(feature?.name) === "ability score improvement";
}

function ensureLevelingState(profile) {
  if (!profile || typeof profile !== "object") {
    return profile;
  }

  if (typeof profile.experience !== "number") {
    profile.experience = Number(profile.experience ?? 0) || 0;
  }

  if (typeof profile.pendingAsiPoints !== "number") {
    profile.pendingAsiPoints = Number(profile.pendingAsiPoints ?? 0) || 0;
  }

  if (!Array.isArray(profile.pendingSubclassSelections)) {
    profile.pendingSubclassSelections = [];
  }

  if (!Array.isArray(profile.levelUpHistory)) {
    profile.levelUpHistory = [];
  }

  return profile;
}

function getXpInfo(level, experience) {
  const currentLevel = Math.max(1, Math.min(20, Number(level ?? 1)));
  const currentXp = Math.max(0, Number(experience ?? 0));
  const currentThreshold = XP_THRESHOLDS[currentLevel] ?? 0;
  const nextLevel = Math.min(20, currentLevel + 1);
  const nextThreshold = XP_THRESHOLDS[nextLevel] ?? null;

  return {
    level: currentLevel,
    currentXp,
    currentThreshold,
    nextLevel: currentLevel >= 20 ? null : nextLevel,
    nextThreshold: currentLevel >= 20 ? null : nextThreshold,
    remainingToNext:
      currentLevel >= 20 || nextThreshold === null
        ? 0
        : Math.max(0, nextThreshold - currentXp),
  };
}

function getAverageHpGain(hitDie, conMod) {
  const safeHitDie = Math.max(0, Number(hitDie ?? 0));
  const safeConMod = Number(conMod ?? 0);

  if (safeHitDie <= 0) {
    return Math.max(1, 1 + safeConMod);
  }

  const averageRoll = Math.floor(safeHitDie / 2) + 1;
  return Math.max(1, averageRoll + safeConMod);
}

function addPendingSubclassSelection(profile, className) {
  ensureLevelingState(profile);

  if (
    !profile.pendingSubclassSelections.some(
      (name) => normalizeName(name) === normalizeName(className)
    )
  ) {
    profile.pendingSubclassSelections.push(className);
  }
}

function removePendingSubclassSelection(profile, className) {
  ensureLevelingState(profile);

  profile.pendingSubclassSelections = profile.pendingSubclassSelections.filter(
    (name) => normalizeName(name) !== normalizeName(className)
  );
}

function syncPendingSubclassSelections(profile) {
  ensureLevelingState(profile);

  const result = [];

  for (const classEntry of profile.classes || []) {
    const requiredLevel = getSubclassRequirementLevel(classEntry.name);
    const hasSubclass = Boolean(String(classEntry.subclass || "").trim());

    if (requiredLevel && Number(classEntry.level ?? 0) >= requiredLevel && !hasSubclass) {
      result.push(classEntry.name);
    }
  }

  profile.pendingSubclassSelections = result;
  return profile;
}

function summarizeSpellcastingGain(beforeProfile, afterProfile, className) {
  const before = beforeProfile?.spellcastingByClass?.[normalizeName(className)] || null;
  const after = afterProfile?.spellcastingByClass?.[normalizeName(className)] || null;
  const lines = [];

  if (!after) {
    return lines;
  }

  const beforeCantrips = Number(before?.cantripsKnown ?? 0);
  const afterCantrips = Number(after?.cantripsKnown ?? 0);
  if (afterCantrips > beforeCantrips) {
    lines.push(`Cantrips Known: ${beforeCantrips} -> ${afterCantrips}`);
  }

  const beforeKnown = Number(before?.knownSpellLimit ?? 0);
  const afterKnown = Number(after?.knownSpellLimit ?? 0);
  if (afterKnown > beforeKnown) {
    lines.push(`Spell Capacity: ${beforeKnown} -> ${afterKnown}`);
  }

  const beforePrepared = Number(before?.preparedLimit ?? 0);
  const afterPrepared = Number(after?.preparedLimit ?? 0);
  if (afterPrepared > beforePrepared) {
    lines.push(`Prepared Spells: ${beforePrepared} -> ${afterPrepared}`);
  }

  const beforeSlots = JSON.stringify(beforeProfile?.spellSlots?.max || {});
  const afterSlots = JSON.stringify(afterProfile?.spellSlots?.max || {});
  if (beforeSlots !== afterSlots && Object.keys(afterProfile?.spellSlots?.max || {}).length) {
    lines.push("Spell slots increased.");
  }

  const beforePact = `${beforeProfile?.pactMagicSlots?.max || 0}:${beforeProfile?.pactMagicSlots?.slotLevel || 0}`;
  const afterPact = `${afterProfile?.pactMagicSlots?.max || 0}:${afterProfile?.pactMagicSlots?.slotLevel || 0}`;
  if (beforePact !== afterPact && Number(afterProfile?.pactMagicSlots?.max ?? 0) > 0) {
    lines.push(
      `Pact Magic: ${afterProfile.pactMagicSlots.max} slot(s) at level ${afterProfile.pactMagicSlots.slotLevel}`
    );
  }

  return lines;
}

function levelUpSingleClassProfile(profile) {
  ensureLevelingState(profile);

  if (!Array.isArray(profile.classes) || profile.classes.length !== 1) {
    return {
      profile,
      summary: null,
      blockedReason: "Automatic level ups currently only support single-class characters.",
    };
  }

  const classEntry = profile.classes[0];
  const oldLevel = Number(classEntry.level ?? 1);
  const oldTotalLevel = getTotalCharacterLevel(profile);

  if (oldTotalLevel >= 20) {
    return {
      profile,
      summary: null,
      blockedReason: "This character is already level 20.",
    };
  }

  const beforeProfile = recalculateDerivedStats(JSON.parse(JSON.stringify(profile)));
  const beforeFeatureIds = new Set((beforeProfile.characterFeatures || []).map((feature) => feature.id));
  const beforeProficiency = Number(beforeProfile.proficiencyBonus ?? 2);

  classEntry.level = oldLevel + 1;

  const conMod = Number(profile.abilityModifiers?.con ?? beforeProfile.abilityModifiers?.con ?? 0);
  const hpGain = getAverageHpGain(classEntry.hitDie, conMod);

  profile.hp.max = Number(profile.hp?.max ?? 0) + hpGain;
  profile.hp.current = Number(profile.hp?.current ?? 0) + hpGain;

  ensureLevelingState(profile);
  profile = recalculateDerivedStats(profile);
  syncPendingSubclassSelections(profile);

  const gainedFeatures = [];

  for (const feature of profile.characterFeatures || []) {
    if (!beforeFeatureIds.has(feature.id)) {
      gainedFeatures.push(feature);
    }
  }

  const newLevelFeatures = getFeaturesGrantedAtLevel(
    classEntry.name,
    classEntry.subclass,
    classEntry.level
  );

  const subclassPending = profile.pendingSubclassSelections.some(
    (name) => normalizeName(name) === normalizeName(classEntry.name)
  );

  const gainedAsiCount = newLevelFeatures.filter(
    (feature) => isAbilityScoreImprovementFeature(feature)
  ).length;

  if (gainedAsiCount > 0) {
    profile.pendingAsiPoints += gainedAsiCount * 2;
  }

  const afterProfile = recalculateDerivedStats(profile);
  const newProficiency = Number(afterProfile.proficiencyBonus ?? beforeProficiency);

  const summary = {
    className: classEntry.name,
    level: Number(classEntry.level ?? oldLevel + 1),
    hpGain,
    proficiencyChanged: newProficiency !== beforeProficiency,
    proficiencyBonus: newProficiency,
    gainedAsiCount,
    gainedFeatures:
      gainedFeatures.length > 0
        ? gainedFeatures.filter((feature) => !isAbilityScoreImprovementFeature(feature))
        : newLevelFeatures.filter((feature) => !isAbilityScoreImprovementFeature(feature)),
    spellcastingChanges: summarizeSpellcastingGain(beforeProfile, afterProfile, classEntry.name),
    pendingAsiPoints: profile.pendingAsiPoints,
    subclassPending,
    subclassOptions: subclassPending ? getSubclassOptions(classEntry.name) : [],
    oldLevel,
  };

  profile.levelUpHistory.unshift({
    className: summary.className,
    level: summary.level,
    gainedAt: new Date().toISOString(),
    gainedFeatures: [
      ...summary.gainedFeatures.map((feature) => feature.name),
      ...Array.from({ length: gainedAsiCount }, () => "Ability Score Improvement"),
    ],
  });

  return {
    profile,
    summary,
    blockedReason: null,
  };
}

function awardExperience(profile, amount) {
  ensureLevelingState(profile);

  const gainAmount = Number(amount ?? 0);

  if (!Number.isFinite(gainAmount) || gainAmount <= 0) {
    return {
      profile,
      summaries: [],
      blockedReason: "Please provide a positive amount of XP.",
    };
  }

  profile.experience += gainAmount;
  profile = recalculateDerivedStats(profile);

  const summaries = [];
  let blockedReason = null;

  while (true) {
    const currentLevel = getTotalCharacterLevel(profile);
    const nextThreshold = XP_THRESHOLDS[Math.min(currentLevel + 1, 20)];

    if (currentLevel >= 20 || nextThreshold === undefined || profile.experience < nextThreshold) {
      break;
    }

    const result = levelUpSingleClassProfile(profile);
    profile = result.profile;

    if (result.blockedReason) {
      blockedReason = result.blockedReason;
      break;
    }

    if (result.summary) {
      summaries.push(result.summary);
    } else {
      break;
    }
  }

  return {
    profile,
    summaries,
    blockedReason,
  };
}

function applyAbilityScoreImprovement(profile, adjustments) {
  ensureLevelingState(profile);

  const entries = Object.entries(adjustments || {});
  const totalPoints = entries.reduce((sum, [, value]) => sum + Number(value ?? 0), 0);

  if (!entries.length || totalPoints <= 0) {
    return {
      success: false,
      message: "Please specify at least one ability to improve.",
      profile,
    };
  }

  if (totalPoints > profile.pendingAsiPoints) {
    return {
      success: false,
      message: `${profile.characterName} only has ${profile.pendingAsiPoints} pending ASI point(s).`,
      profile,
    };
  }

  for (const [ability, increase] of entries) {
    const normalizedAbility = normalizeName(ability);
    if (!["str", "dex", "con", "int", "wis", "cha"].includes(normalizedAbility)) {
      return {
        success: false,
        message: `Invalid ability: ${ability}.`,
        profile,
      };
    }

    const amount = Number(increase ?? 0);
    if (!Number.isInteger(amount) || amount <= 0) {
      return {
        success: false,
        message: `Invalid ASI amount for ${ability}.`,
        profile,
      };
    }

    const currentScore = Number(profile.abilities?.[normalizedAbility] ?? 10);
    if (currentScore + amount > 20) {
      return {
        success: false,
        message: `${profile.characterName}'s ${normalizedAbility.toUpperCase()} cannot go above 20.`,
        profile,
      };
    }
  }

  for (const [ability, increase] of entries) {
    const normalizedAbility = normalizeName(ability);
    profile.abilities[normalizedAbility] =
      Number(profile.abilities?.[normalizedAbility] ?? 10) + Number(increase);
  }

  profile.pendingAsiPoints -= totalPoints;
  profile = recalculateDerivedStats(profile);

  return {
    success: true,
    message: `${profile.characterName} applied ${totalPoints} ASI point(s).`,
    profile,
  };
}

function chooseSubclass(profile, subclassName) {
  ensureLevelingState(profile);

  const pendingClasses = (profile.pendingSubclassSelections || [])
    .map((className) => ({
      className,
      options: getSubclassOptions(className),
    }))
    .filter((entry) => entry.options.length > 0);

  const matches = [];

  for (const pending of pendingClasses) {
    for (const option of pending.options) {
      if (
        normalizeName(option.name) === normalizeName(subclassName) ||
        normalizeName(option.shortName) === normalizeName(subclassName)
      ) {
        matches.push({
          className: pending.className,
          subclassName: option.name,
        });
      }
    }
  }

  if (!matches.length) {
    return {
      success: false,
      message: `No pending subclass option found matching **${subclassName}**.`,
      profile,
      gainedFeatures: [],
    };
  }

  if (matches.length > 1) {
    return {
      success: false,
      message: `More than one class has a subclass option named **${subclassName}**.`,
      profile,
      gainedFeatures: [],
    };
  }

  const match = matches[0];
  const classEntry = (profile.classes || []).find(
    (entry) => normalizeName(entry.name) === normalizeName(match.className)
  );

  if (!classEntry) {
    return {
      success: false,
      message: "Could not find the class needing a subclass choice.",
      profile,
      gainedFeatures: [],
    };
  }

  const beforeFeatures = getFeatureEntriesForClassLevel(
    classEntry.name,
    classEntry.subclass,
    classEntry.level
  );
  const beforeFeatureIds = new Set(beforeFeatures.map((feature) => feature.id));

  classEntry.subclass = match.subclassName;
  removePendingSubclassSelection(profile, classEntry.name);
  profile = recalculateDerivedStats(profile);

  const afterFeatures = getFeatureEntriesForClassLevel(
    classEntry.name,
    classEntry.subclass,
    classEntry.level
  );
  const gainedFeatures = afterFeatures.filter((feature) => !beforeFeatureIds.has(feature.id));

  return {
    success: true,
    message: `${profile.characterName} chose **${match.subclassName}** for ${classEntry.name}.`,
    profile,
    className: classEntry.name,
    subclassName: match.subclassName,
    gainedFeatures,
  };
}

module.exports = {
  XP_THRESHOLDS,
  applyAbilityScoreImprovement,
  awardExperience,
  chooseSubclass,
  ensureLevelingState,
  getXpInfo,
  syncPendingSubclassSelections,
};
