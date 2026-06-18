const fs = require("fs");
const path = require("path");

const {
  flattenEntryText,
  normalizeName,
  getClassDefinition,
} = require("./classData");

const RACE_DATA_PATH = path.join(__dirname, "..", "race_data", "races.json");
const FEAT_DATA_PATH = path.join(__dirname, "..", "feat_data", "feats.json");

const FEATURE_NAME_BLACKLIST = new Set([
  "age",
  "alignment",
  "appearance",
  "creature type",
  "darkvision",
  "flight",
  "languages",
  "language",
  "lifespan",
  "size",
  "speed",
  "names",
]);

let raceCache = null;
let featCache = null;

function scoreEntry(entry) {
  let score = 0;

  const source = String(entry?.source || "").toUpperCase();
  if (source === "PHB") score += 100;
  if (source === "TCE") score += 60;
  if (source === "XGE") score += 50;
  if (source === "SCAG") score += 40;
  if (entry?.srd) score += 25;
  if (entry?.basicRules) score += 20;
  if ((entry?.edition || "").toLowerCase() === "classic") score += 10;

  return score;
}

function chooseBest(existing, incoming) {
  if (!existing) return incoming;
  return scoreEntry(incoming) > scoreEntry(existing) ? incoming : existing;
}

function loadRaceCache() {
  if (raceCache) return raceCache;

  const result = {
    races: new Map(),
    subraces: [],
  };

  if (!fs.existsSync(RACE_DATA_PATH)) {
    raceCache = result;
    return result;
  }

  const data = JSON.parse(fs.readFileSync(RACE_DATA_PATH, "utf8"));

  for (const race of data.race || []) {
    const key = normalizeName(race.name);
    result.races.set(key, chooseBest(result.races.get(key), race));
  }

  for (const subrace of data.subrace || []) {
    if (!subrace || (!subrace.name && !subrace.raceName)) continue;
    result.subraces.push(subrace);
  }

  raceCache = result;
  return result;
}

function loadFeatCache() {
  if (featCache) return featCache;

  const result = {
    feats: new Map(),
  };

  if (!fs.existsSync(FEAT_DATA_PATH)) {
    featCache = result;
    return result;
  }

  const data = JSON.parse(fs.readFileSync(FEAT_DATA_PATH, "utf8"));

  for (const feat of data.feat || []) {
    const key = normalizeName(feat.name);
    result.feats.set(key, chooseBest(result.feats.get(key), feat));
  }

  featCache = result;
  return result;
}

function getFeatDefinition(featName) {
  return loadFeatCache().feats.get(normalizeName(featName)) || null;
}

function listAllFeats() {
  return [...loadFeatCache().feats.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeRaceText(text) {
  return normalizeName(text).replace(/\blineage\b/g, "").replace(/\s+/g, " ").trim();
}

function getRaceDefinition(raceName) {
  if (!raceName) return null;

  const normalized = normalizeRaceText(raceName);
  const cache = loadRaceCache();

  if (cache.races.has(normalized)) {
    return cache.races.get(normalized);
  }

  for (const race of cache.races.values()) {
    if (normalizeRaceText(race.name) === normalized) {
      return race;
    }
  }

  return null;
}

function getSubraceDefinition(raceName, subraceName) {
  const cache = loadRaceCache();
  const normalizedRace = normalizeRaceText(raceName);
  const normalizedSubrace = normalizeRaceText(subraceName);

  if (!normalizedSubrace) return null;

  let best = null;

  for (const subrace of cache.subraces) {
    const subraceRace = normalizeRaceText(subrace.raceName || "");
    if (subraceRace && normalizedRace && subraceRace !== normalizedRace) {
      continue;
    }

    const candidates = [
      normalizeRaceText(subrace.name),
      normalizeRaceText(`${subrace.name} ${subrace.raceName || ""}`),
      normalizeRaceText(`${subrace.raceName || ""} ${subrace.name}`),
    ].filter(Boolean);

    const matched = candidates.some((candidate) => candidate === normalizedSubrace);

    if (matched) {
      best = chooseBest(best, subrace);
    }
  }

  if (best) return best;

  if (normalizedRace) {
    for (const subrace of cache.subraces) {
      const combined = normalizeRaceText(`${subrace.name} ${subrace.raceName || ""}`);
      const raceCombined = normalizeRaceText(`${raceName} ${subraceName}`);
      if (combined && combined === raceCombined) {
        return subrace;
      }
    }
  }

  return null;
}

function resolveRaceSelection(raceName, subraceName) {
  let race = getRaceDefinition(raceName);
  let subrace = getSubraceDefinition(raceName, subraceName);

  if (!race && !subrace && raceName) {
    const normalizedRace = normalizeRaceText(raceName);

    for (const candidate of loadRaceCache().subraces) {
      const combined = normalizeRaceText(`${candidate.name} ${candidate.raceName || ""}`);
      if (combined && combined === normalizedRace) {
        subrace = candidate;
        race = getRaceDefinition(candidate.raceName);
        break;
      }
    }
  }

  if (!race && subrace?.raceName) {
    race = getRaceDefinition(subrace.raceName);
  }

  return { race, subrace };
}

function shouldKeepRacialEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!entry.name || !Array.isArray(entry.entries)) return false;

  return !FEATURE_NAME_BLACKLIST.has(normalizeName(entry.name));
}

function extractRacialFeaturesFromEntries(entries, categoryName, source, type) {
  const features = [];

  for (const entry of entries || []) {
    if (!shouldKeepRacialEntry(entry)) continue;

    features.push({
      id: `${type}:${normalizeName(categoryName)}:${normalizeName(entry.name)}`,
      type: "racial",
      group: categoryName,
      name: entry.name,
      source: source || "",
      level: 0,
      description: flattenEntryText([entry]),
    });
  }

  return features;
}

function getRacialFeaturesForProfile(profile) {
  const { race, subrace } = resolveRaceSelection(profile?.race, profile?.subrace);
  const features = [];

  if (race) {
    features.push(
      ...extractRacialFeaturesFromEntries(race.entries, race.name, race.source, "race")
    );
  }

  if (subrace) {
    const subraceDisplay = `${subrace.name} ${subrace.raceName || ""}`.trim();
    features.push(
      ...extractRacialFeaturesFromEntries(
        subrace.entries,
        subraceDisplay,
        subrace.source,
        "subrace"
      )
    );
  }

  return features;
}

function getSelectedFeatFeatures(profile) {
  const selectedFeats = Array.isArray(profile?.selectedFeats) ? profile.selectedFeats : [];

  return selectedFeats
    .map((selectedFeat) => {
      const definition = getFeatDefinition(selectedFeat.name);
      if (!definition) return null;

      let description = flattenEntryText(definition.entries || []);

      if (selectedFeat.chosenAbility) {
        description += `\nChosen ability increase: ${selectedFeat.chosenAbility.toUpperCase()}.`;
      }

      return {
        id: `feat:${normalizeName(definition.name)}`,
        type: "selectedFeat",
        group: "Selected Feats",
        name: definition.name,
        source: definition.source || "",
        level: Number(selectedFeat.acquiredLevel ?? 0),
        description,
      };
    })
    .filter(Boolean);
}

function profileHasSpellcasting(profile) {
  if (Object.values(profile?.spellcastingByClass || {}).some((entry) => entry.mode !== "none")) {
    return true;
  }

  const { race, subrace } = resolveRaceSelection(profile?.race, profile?.subrace);

  if ((race?.additionalSpells?.length || 0) > 0 || (subrace?.additionalSpells?.length || 0) > 0) {
    return true;
  }

  return (profile?.selectedFeats || []).some((selectedFeat) => {
    const feat = getFeatDefinition(selectedFeat.name);
    return Boolean(feat?.additionalSpells?.length);
  });
}

function profileHasClassSpellcasting(profile) {
  return Object.values(profile?.spellcastingByClass || {}).some((entry) => entry.mode !== "none");
}

function getProfileFeatureNames(profile) {
  const names = new Set();

  for (const feature of profile.characterFeatures || []) {
    names.add(normalizeName(feature.name));
  }

  for (const feature of profile.racialFeatures || []) {
    names.add(normalizeName(feature.name));
  }

  for (const feature of profile.selectedFeatFeatures || []) {
    names.add(normalizeName(feature.name));
  }

  return names;
}

function getProfileFeatNames(profile) {
  return new Set(
    (profile.selectedFeats || []).map((selectedFeat) => normalizeName(selectedFeat.name))
  );
}

function getProfileFeatCategories(profile) {
  const categories = new Set();

  for (const selectedFeat of profile.selectedFeats || []) {
    const definition = getFeatDefinition(selectedFeat.name);
    if (definition?.category) {
      categories.add(normalizeName(definition.category));
    }
  }

  return categories;
}

function addArmorAndWeaponProficiencies(profile, armorSet, weaponSet) {
  for (const classEntry of profile.classes || []) {
    const classDef = getClassDefinition(classEntry.name);
    const starting = classDef?.rawClass?.startingProficiencies || {};

    for (const armor of starting.armor || []) {
      armorSet.add(normalizeName(armor));
    }

    for (const weapon of starting.weapons || []) {
      weaponSet.add(normalizeName(weapon));
    }
  }

  const { race, subrace } = resolveRaceSelection(profile?.race, profile?.subrace);

  for (const source of [race, subrace]) {
    for (const weapon of source?.weaponProficiencies || []) {
      weaponSet.add(normalizeName(weapon));
    }
  }

  for (const selectedFeat of profile.selectedFeats || []) {
    const featName = normalizeName(selectedFeat.name);

    if (featName === "lightly armored") {
      armorSet.add("light");
    }

    if (featName === "moderately armored") {
      armorSet.add("medium");
      armorSet.add("shield");
    }

    if (featName === "heavily armored") {
      armorSet.add("heavy");
    }
  }
}

function getProfileProficiencySets(profile) {
  const armor = new Set();
  const weapons = new Set();

  addArmorAndWeaponProficiencies(profile, armor, weapons);

  return { armor, weapons };
}

function isRacePrerequisiteSatisfied(profile, racePrereq) {
  const baseRace = normalizeRaceText(profile?.race);
  const subrace = normalizeRaceText(profile?.subrace);
  const combined = normalizeRaceText(`${profile?.subrace || ""} ${profile?.race || ""}`);
  const raceName = normalizeRaceText(racePrereq?.name);
  const requiredSubrace = normalizeRaceText(racePrereq?.subrace);

  if (!raceName) return false;

  const baseMatches = baseRace === raceName || combined === raceName;

  if (!baseMatches) {
    return false;
  }

  if (!requiredSubrace) {
    return true;
  }

  return subrace === requiredSubrace || combined === normalizeRaceText(`${requiredSubrace} ${raceName}`);
}

function isAbilityPrerequisiteSatisfied(profile, abilityRequirements) {
  if (!Array.isArray(abilityRequirements) || !abilityRequirements.length) {
    return true;
  }

  return abilityRequirements.some((abilityGroup) =>
    Object.entries(abilityGroup || {}).every(([ability, minimum]) => {
      if (!["str", "dex", "con", "int", "wis", "cha"].includes(normalizeName(ability))) {
        return true;
      }

      return Number(profile?.abilities?.[normalizeName(ability)] ?? 0) >= Number(minimum ?? 0);
    })
  );
}

function isFeaturePrerequisiteSatisfied(profile, featureRequirements) {
  const owned = getProfileFeatureNames(profile);
  return (featureRequirements || []).some((featureName) => owned.has(normalizeName(featureName)));
}

function isFeatPrerequisiteSatisfied(profile, featRequirements) {
  const owned = getProfileFeatNames(profile);
  return (featRequirements || []).some((featRef) => {
    const featName = String(featRef || "").split("|")[0];
    return owned.has(normalizeName(featName));
  });
}

function isProficiencyPrerequisiteSatisfied(profile, proficiencyRequirements) {
  const sets = getProfileProficiencySets(profile);

  return (proficiencyRequirements || []).some((requirement) => {
    if (requirement.armor) {
      return sets.armor.has(normalizeName(requirement.armor));
    }

    if (requirement.weapon) {
      return sets.weapons.has(normalizeName(requirement.weapon));
    }

    if (requirement.weaponGroup) {
      return sets.weapons.has(normalizeName(requirement.weaponGroup));
    }

    return false;
  });
}

function isOtherPrerequisiteSatisfied(profile, prereq) {
  if (prereq.other === "No other dragonmark") {
    const categories = getProfileFeatCategories(profile);
    return !categories.has("d");
  }

  if (prereq.exclusiveFeatCategory) {
    const categories = getProfileFeatCategories(profile);
    return !prereq.exclusiveFeatCategory.some((category) =>
      categories.has(normalizeName(category))
    );
  }

  if (prereq.featCategory) {
    const categories = getProfileFeatCategories(profile);
    return prereq.featCategory.some((category) =>
      categories.has(normalizeName(category))
    );
  }

  if (prereq.background) {
    const currentBackground = normalizeName(profile?.background);
    return prereq.background.some(
      (background) => currentBackground === normalizeName(background.name)
    );
  }

  if (prereq.otherSummary || prereq.campaign) {
    return false;
  }

  return true;
}

function isSinglePrerequisiteObjectSatisfied(profile, prereq) {
  if (prereq.level && Number(profile?.totalLevel ?? 0) < Number(prereq.level)) {
    return false;
  }

  if (prereq.race && !prereq.race.some((raceReq) => isRacePrerequisiteSatisfied(profile, raceReq))) {
    return false;
  }

  if (prereq.ability && !isAbilityPrerequisiteSatisfied(profile, prereq.ability)) {
    return false;
  }

  if (prereq.spellcasting && !profileHasSpellcasting(profile)) {
    return false;
  }

  if (prereq.spellcasting2020 && !profileHasSpellcasting(profile)) {
    return false;
  }

  if (prereq.spellcastingFeature && !profileHasClassSpellcasting(profile)) {
    return false;
  }

  if (prereq.feature && !isFeaturePrerequisiteSatisfied(profile, prereq.feature)) {
    return false;
  }

  if (prereq.feat && !isFeatPrerequisiteSatisfied(profile, prereq.feat)) {
    return false;
  }

  if (prereq.proficiency && !isProficiencyPrerequisiteSatisfied(profile, prereq.proficiency)) {
    return false;
  }

  if (!isOtherPrerequisiteSatisfied(profile, prereq)) {
    return false;
  }

  return true;
}

function checkFeatPrerequisites(profile, feat) {
  const prereqs = Array.isArray(feat?.prerequisite) ? feat.prerequisite : [];

  if (!prereqs.length) {
    return { eligible: true, reason: null };
  }

  const eligible = prereqs.some((prereq) => isSinglePrerequisiteObjectSatisfied(profile, prereq));

  return {
    eligible,
    reason: eligible ? null : "Prerequisites not met.",
  };
}

function getFeatAbilityOptions(feat) {
  const adjustments = {
    fixed: {},
    choose: [],
  };

  for (const entry of feat?.ability || []) {
    for (const [key, value] of Object.entries(entry || {})) {
      if (["str", "dex", "con", "int", "wis", "cha"].includes(normalizeName(key))) {
        adjustments.fixed[normalizeName(key)] =
          (adjustments.fixed[normalizeName(key)] || 0) + Number(value ?? 0);
      }
    }

    if (entry.choose) {
      adjustments.choose.push({
        from: Array.isArray(entry.choose.from) ? entry.choose.from.map(normalizeName) : [],
        amount: Number(entry.choose.amount ?? 1),
        count: Number(entry.choose.count ?? 1),
        max: Number(entry.max ?? 20),
      });
    }
  }

  return adjustments;
}

function applyFeatAbilityBonuses(profile, feat, chosenAbility) {
  const { fixed, choose } = getFeatAbilityOptions(feat);
  const applied = {};

  for (const [ability, amount] of Object.entries(fixed)) {
    const current = Number(profile.abilities?.[ability] ?? 10);
    const next = current + Number(amount ?? 0);
    const max = 20;

    if (next > max) {
      return {
        success: false,
        message: `${feat.name} would raise ${ability.toUpperCase()} above ${max}.`,
      };
    }

    applied[ability] = (applied[ability] || 0) + amount;
  }

  if (choose.length > 1 || choose.some((entry) => entry.count !== 1)) {
    return {
      success: false,
      message: `${feat.name} has a complex ability choice that is not supported yet.`,
    };
  }

  if (choose.length === 1) {
    const choice = choose[0];

    if (!chosenAbility) {
      return {
        success: false,
        message: `${feat.name} requires an ability choice. Usage: !asi feat ${feat.name} ${choice.from.join("/")}`,
      };
    }

    const normalizedChoice = normalizeName(chosenAbility);
    if (!choice.from.includes(normalizedChoice)) {
      return {
        success: false,
        message: `${feat.name} can only increase: ${choice.from.join(", ")}.`,
      };
    }

    const current = Number(profile.abilities?.[normalizedChoice] ?? 10);
    const next = current + choice.amount;
    const max = Number(choice.max ?? 20);

    if (next > max) {
      return {
        success: false,
        message: `${feat.name} would raise ${normalizedChoice.toUpperCase()} above ${max}.`,
      };
    }

    applied[normalizedChoice] = (applied[normalizedChoice] || 0) + choice.amount;
  }

  for (const [ability, amount] of Object.entries(applied)) {
    profile.abilities[ability] = Number(profile.abilities?.[ability] ?? 10) + Number(amount ?? 0);
  }

  return {
    success: true,
    applied,
  };
}

function addSelectedFeat(profile, feat, options = {}) {
  if (!Array.isArray(profile.selectedFeats)) {
    profile.selectedFeats = [];
  }

  profile.selectedFeats.push({
    name: feat.name,
    source: feat.source || "",
    chosenAbility: options.chosenAbility ? normalizeName(options.chosenAbility) : null,
    acquiredLevel: Number(profile.totalLevel ?? 0),
    category: feat.category || "",
  });
}

module.exports = {
  addSelectedFeat,
  applyFeatAbilityBonuses,
  checkFeatPrerequisites,
  getFeatAbilityOptions,
  getFeatDefinition,
  getRaceDefinition,
  getRacialFeaturesForProfile,
  getSelectedFeatFeatures,
  getSubraceDefinition,
  listAllFeats,
  profileHasSpellcasting,
  resolveRaceSelection,
};
