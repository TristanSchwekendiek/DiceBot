const fs = require("fs");
const path = require("path");

const CLASS_DATA_DIR = path.join(__dirname, "..", "class_data");

let cachedIndex = null;

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDataText(text) {
  if (text === null || text === undefined) return "";

  return String(text)
    .replace(/\{@dice ([^}|]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{@damage ([^}|]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{@hit ([^}|]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{@dc ([^}|]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{@filter ([^|}]+)\|[^}]*\}/g, "$1")
    .replace(/\{@([^ }]+) ([^}|]+)(?:\|[^}]*)?\}/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenEntryText(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return "No description available.";
  }

  const visited = options.visited || new Set();
  const lines = [];

  function walk(entry) {
    if (!entry) return;

    if (typeof entry === "string") {
      const cleaned = cleanDataText(entry);
      if (cleaned) {
        lines.push(cleaned);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(walk);
      return;
    }

    if (typeof entry !== "object") {
      return;
    }

    if (entry.type === "entries" || entry.type === "inset" || entry.type === "section") {
      if (entry.name) {
        lines.push(`**${cleanDataText(entry.name)}**`);
      }
      if (Array.isArray(entry.entries)) {
        entry.entries.forEach(walk);
      }
      return;
    }

    if (entry.type === "list" && Array.isArray(entry.items)) {
      entry.items.forEach((item) => {
        if (typeof item === "string") {
          lines.push(`- ${cleanDataText(item)}`);
        } else {
          walk(item);
        }
      });
      return;
    }

    if (entry.type === "item") {
      if (entry.name) {
        lines.push(`**${cleanDataText(entry.name)}**`);
      }
      if (Array.isArray(entry.entries)) {
        entry.entries.forEach(walk);
      }
      return;
    }

    if (entry.type === "options" && Array.isArray(entry.entries)) {
      if (typeof entry.count === "number") {
        lines.push(`Choose ${entry.count}:`);
      }
      entry.entries.forEach(walk);
      return;
    }

    if (entry.type === "table") {
      if (entry.caption) {
        lines.push(`**${cleanDataText(entry.caption)}**`);
      }

      if (Array.isArray(entry.rows)) {
        entry.rows.forEach((row) => {
          if (Array.isArray(row)) {
            const rowText = row.map((cell) => cleanCellText(cell)).filter(Boolean).join(" | ");
            if (rowText) {
              lines.push(rowText);
            }
          }
        });
      }
      return;
    }

    if (entry.type === "refClassFeature" && entry.classFeature) {
      const feature = getClassFeatureByRef(entry.classFeature);
      const featureKey = feature?.id || `class:${entry.classFeature}`;

      if (feature && !visited.has(featureKey)) {
        visited.add(featureKey);
        lines.push(`**${feature.name}**`);
        lines.push(flattenEntryText(feature.entries, { visited }));
      }
      return;
    }

    if (entry.type === "refSubclassFeature" && entry.subclassFeature) {
      const feature = getSubclassFeatureByRef(entry.subclassFeature);
      const featureKey = feature?.id || `subclass:${entry.subclassFeature}`;

      if (feature && !visited.has(featureKey)) {
        visited.add(featureKey);
        lines.push(`**${feature.name}**`);
        lines.push(flattenEntryText(feature.entries, { visited }));
      }
      return;
    }

    if (entry.type === "refOptionalfeature" && entry.optionalfeature) {
      lines.push(cleanDataText(entry.optionalfeature));
      return;
    }

    if (entry.name) {
      lines.push(`**${cleanDataText(entry.name)}**`);
    }

    if (Array.isArray(entry.entries)) {
      entry.entries.forEach(walk);
      return;
    }

    if (Array.isArray(entry.items)) {
      entry.items.forEach(walk);
      return;
    }

    const cleaned = cleanDataText(JSON.stringify(entry));
    if (cleaned) {
      lines.push(cleaned);
    }
  }

  entries.forEach(walk);

  const result = lines.filter(Boolean).join("\n").trim();
  return result || "No description available.";
}

function cleanCellText(cell) {
  if (cell === null || cell === undefined) return "";

  if (typeof cell === "string") {
    return cleanDataText(cell);
  }

  if (typeof cell === "number") {
    return String(cell);
  }

  if (Array.isArray(cell)) {
    return cell.map((part) => cleanCellText(part)).filter(Boolean).join(", ");
  }

  if (typeof cell === "object") {
    if (cell.type === "dice" && Array.isArray(cell.toRoll)) {
      return cell.toRoll
        .map((roll) => `${roll.number || 1}d${roll.faces || 0}`)
        .join(" + ");
    }

    if (cell.item) {
      return cleanDataText(cell.item);
    }
  }

  return cleanDataText(JSON.stringify(cell));
}

function scoreEntry(entry) {
  let score = 0;

  if ((entry?.edition || "").toLowerCase() === "classic") score += 100;
  if ((entry?.source || "").toUpperCase() === "PHB") score += 50;
  if ((entry?.classSource || "").toUpperCase() === "PHB") score += 25;
  if (Array.isArray(entry?.subclassFeatures) && entry.subclassFeatures.length > 0) score += 10;
  if (entry?.srd) score += 5;

  return score;
}

function chooseBestEntry(existing, incoming) {
  if (!existing) return incoming;
  return scoreEntry(incoming) > scoreEntry(existing) ? incoming : existing;
}

function parseClassFeatureRef(refOrObject) {
  const payload =
    typeof refOrObject === "string"
      ? { classFeature: refOrObject }
      : refOrObject && typeof refOrObject === "object"
      ? refOrObject
      : null;

  if (!payload?.classFeature) {
    return null;
  }

  const [name = "", className = "", classSource = "", level = "", featureSource = ""] =
    String(payload.classFeature).split("|");

  return {
    type: "class",
    ref: payload.classFeature,
    id: buildClassFeatureId(name, className, classSource, level, featureSource),
    name,
    className,
    classSource,
    level: Number(level || 0),
    featureSource,
    gainSubclassFeature: Boolean(payload.gainSubclassFeature),
    tableDisplayName: payload.tableDisplayName || null,
  };
}

function parseSubclassFeatureRef(ref) {
  if (!ref) return null;

  const [
    name = "",
    className = "",
    classSource = "",
    subclassShortName = "",
    subclassSource = "",
    level = "",
    featureSource = "",
  ] = String(ref).split("|");

  return {
    type: "subclass",
    ref,
    id: buildSubclassFeatureId(
      name,
      className,
      classSource,
      subclassShortName,
      subclassSource,
      level,
      featureSource
    ),
    name,
    className,
    classSource,
    subclassShortName,
    subclassSource,
    level: Number(level || 0),
    featureSource,
  };
}

function buildClassFeatureId(name, className, classSource, level, featureSource) {
  return [
    normalizeName(name),
    normalizeName(className),
    normalizeName(classSource || "phb"),
    Number(level || 0),
    normalizeName(featureSource || "core"),
  ].join("|");
}

function buildSubclassFeatureId(
  name,
  className,
  classSource,
  subclassShortName,
  subclassSource,
  level,
  featureSource
) {
  return [
    normalizeName(name),
    normalizeName(className),
    normalizeName(classSource || "phb"),
    normalizeName(subclassShortName),
    normalizeName(subclassSource || "core"),
    Number(level || 0),
    normalizeName(featureSource || "core"),
  ].join("|");
}

function buildClassIndex() {
  const index = {
    classes: new Map(),
    classFeatures: new Map(),
    subclassFeatures: new Map(),
  };

  if (!fs.existsSync(CLASS_DATA_DIR)) {
    return index;
  }

  const files = fs
    .readdirSync(CLASS_DATA_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const fullPath = path.join(CLASS_DATA_DIR, file);
    const rawData = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const rawClass = Array.isArray(rawData.class) ? rawData.class[0] : null;

    if (!rawClass?.name) {
      continue;
    }

    const normalizedClassName = normalizeName(rawClass.name);
    const existingClass = index.classes.get(normalizedClassName);
    const classRecord = existingClass || {
      name: rawClass.name,
      rawClass,
      subclasses: new Map(),
      file,
    };

    if (!existingClass || scoreEntry(rawClass) > scoreEntry(existingClass.rawClass)) {
      classRecord.name = rawClass.name;
      classRecord.rawClass = rawClass;
      classRecord.file = file;
    }

    if (Array.isArray(rawData.classFeature)) {
      for (const feature of rawData.classFeature) {
        const id = buildClassFeatureId(
          feature.name,
          feature.className,
          feature.classSource,
          feature.level,
          feature.source
        );

        const existing = index.classFeatures.get(id);
        const normalizedFeature = {
          ...feature,
          id,
        };

        if (!existing || scoreEntry(feature) > scoreEntry(existing)) {
          index.classFeatures.set(id, normalizedFeature);
        }
      }
    }

    if (Array.isArray(rawData.subclassFeature)) {
      for (const feature of rawData.subclassFeature) {
        const id = buildSubclassFeatureId(
          feature.name,
          feature.className,
          feature.classSource,
          feature.subclassShortName,
          feature.subclassSource,
          feature.level,
          feature.source
        );

        const existing = index.subclassFeatures.get(id);
        const normalizedFeature = {
          ...feature,
          id,
        };

        if (!existing || scoreEntry(feature) > scoreEntry(existing)) {
          index.subclassFeatures.set(id, normalizedFeature);
        }
      }
    }

    if (Array.isArray(rawData.subclass)) {
      for (const subclass of rawData.subclass) {
        if (!subclass?.name || !subclass?.className) continue;
        if (
          subclass.classSource &&
          normalizeName(subclass.classSource) !== normalizeName(classRecord.rawClass.source)
        ) {
          continue;
        }

        const subclassKey = normalizeName(subclass.shortName || subclass.name);
        const existing = classRecord.subclasses.get(subclassKey);
        classRecord.subclasses.set(subclassKey, chooseBestEntry(existing, subclass));
      }
    }

    index.classes.set(normalizedClassName, classRecord);
  }

  return index;
}

function getIndex() {
  if (!cachedIndex) {
    cachedIndex = buildClassIndex();
  }

  return cachedIndex;
}

function getClassDefinition(className) {
  const normalized = normalizeName(className);
  const index = getIndex();

  if (index.classes.has(normalized)) {
    return index.classes.get(normalized);
  }

  const simplified = normalized.replace(/\brevised\b/g, "").replace(/\s+/g, " ").trim();

  if (simplified && index.classes.has(simplified)) {
    return index.classes.get(simplified);
  }

  return null;
}

function getClassFeatureByRef(ref) {
  const parsed = parseClassFeatureRef(ref);
  if (!parsed) return null;

  const index = getIndex();
  const exact = index.classFeatures.get(parsed.id);
  if (exact) {
    return exact;
  }

  for (const feature of index.classFeatures.values()) {
    if (
      normalizeName(feature.name) === normalizeName(parsed.name) &&
      normalizeName(feature.className) === normalizeName(parsed.className) &&
      Number(feature.level ?? 0) === Number(parsed.level ?? 0)
    ) {
      if (
        parsed.classSource &&
        normalizeName(feature.classSource) !== normalizeName(parsed.classSource)
      ) {
        continue;
      }

      return feature;
    }
  }

  return null;
}

function getSubclassFeatureByRef(ref) {
  const parsed = parseSubclassFeatureRef(ref);
  if (!parsed) return null;

  const index = getIndex();
  const exact = index.subclassFeatures.get(parsed.id);
  if (exact) {
    return exact;
  }

  for (const feature of index.subclassFeatures.values()) {
    if (
      normalizeName(feature.name) === normalizeName(parsed.name) &&
      normalizeName(feature.className) === normalizeName(parsed.className) &&
      normalizeName(feature.subclassShortName) === normalizeName(parsed.subclassShortName) &&
      Number(feature.level ?? 0) === Number(parsed.level ?? 0)
    ) {
      if (
        parsed.classSource &&
        normalizeName(feature.classSource) !== normalizeName(parsed.classSource)
      ) {
        continue;
      }

      if (
        parsed.subclassSource &&
        normalizeName(feature.subclassSource) !== normalizeName(parsed.subclassSource)
      ) {
        continue;
      }

      return feature;
    }
  }

  return null;
}

function getSubclassDefinition(className, subclassName) {
  const classDef = getClassDefinition(className);
  if (!classDef || !subclassName) return null;

  const direct = classDef.subclasses.get(normalizeName(subclassName));
  if (direct) return direct;

  for (const subclass of classDef.subclasses.values()) {
    if (normalizeName(subclass.name) === normalizeName(subclassName)) {
      return subclass;
    }
  }

  return null;
}

function getSubclassOptions(className) {
  const classDef = getClassDefinition(className);
  if (!classDef) return [];

  return [...classDef.subclasses.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((subclass) => ({
      name: subclass.name,
      shortName: subclass.shortName || subclass.name,
      source: subclass.source || "",
      className: subclass.className,
    }));
}

function getProgressionValue(list, level) {
  if (!Array.isArray(list) || level <= 0) return 0;
  return Number(list[level - 1] ?? 0);
}

function getClassTableGroups(className) {
  return getClassDefinition(className)?.rawClass?.classTableGroups || [];
}

function getClassTableRow(className, level, groupIndex = 0) {
  const groups = getClassTableGroups(className);
  const group = groups[groupIndex];
  if (!group || !Array.isArray(group.rows) || level <= 0) return null;
  return group.rows[level - 1] || null;
}

function extractLabelText(label) {
  return cleanDataText(label).toLowerCase();
}

function findTableColumnIndex(className, matcher) {
  const groups = getClassTableGroups(className);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const colLabels = Array.isArray(group.colLabels) ? group.colLabels : [];

    for (let columnIndex = 0; columnIndex < colLabels.length; columnIndex += 1) {
      if (matcher(extractLabelText(colLabels[columnIndex]), group, groupIndex, columnIndex)) {
        return { groupIndex, columnIndex };
      }
    }
  }

  return null;
}

function getCantripsKnownForClassLevel(className, level) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;

  if (!rawClass || level <= 0) {
    return 0;
  }

  if (Array.isArray(rawClass.cantripProgression)) {
    return getProgressionValue(rawClass.cantripProgression, level);
  }

  const column = findTableColumnIndex(className, (label) => label.includes("cantrips known"));
  if (!column) {
    return 0;
  }

  const row = getClassTableRow(className, level, column.groupIndex);
  return Number(row?.[column.columnIndex] ?? 0);
}

function getKnownSpellLimitForClassLevel(className, level) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;

  if (!rawClass || level <= 0) {
    return 0;
  }

  if (Array.isArray(rawClass.spellsKnownProgression)) {
    return getProgressionValue(rawClass.spellsKnownProgression, level);
  }

  if (Array.isArray(rawClass.spellsKnownProgressionFixed)) {
    return rawClass.spellsKnownProgressionFixed
      .slice(0, level)
      .reduce((sum, value) => sum + Number(value ?? 0), 0);
  }

  const column = findTableColumnIndex(className, (label) => label.includes("spells known"));
  if (!column) {
    return 0;
  }

  const row = getClassTableRow(className, level, column.groupIndex);
  return Number(row?.[column.columnIndex] ?? 0);
}

function getMysticArcanumProgressionForClassLevel(className, level) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;
  const result = {};

  if (!rawClass?.spellsKnownProgressionFixedByLevel || level <= 0) {
    return result;
  }

  for (const [requiredLevel, slotsBySpellLevel] of Object.entries(
    rawClass.spellsKnownProgressionFixedByLevel
  )) {
    if (Number(requiredLevel) > level) continue;

    for (const [spellLevel, count] of Object.entries(slotsBySpellLevel || {})) {
      result[spellLevel] = Number(count ?? 0);
    }
  }

  return result;
}

function getClassLevelSpellSlots(className, level) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;

  if (!rawClass || level <= 0) {
    return {};
  }

  const group = (rawClass.classTableGroups || []).find((entry) =>
    Array.isArray(entry.rowsSpellProgression)
  );

  if (!group) {
    return {};
  }

  const row = group.rowsSpellProgression[level - 1] || [];
  const result = {};

  row.forEach((value, index) => {
    const numericValue = Number(value ?? 0);
    if (numericValue > 0) {
      result[index + 1] = numericValue;
    }
  });

  return result;
}

function parseOrdinalLevel(text) {
  const match = String(text || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function getPactMagicForClassLevel(className, level) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;

  if (!rawClass || normalizeName(rawClass.casterProgression) !== "pact" || level <= 0) {
    return {
      slotLevel: 0,
      slots: 0,
    };
  }

  const row = getClassTableRow(className, level, 0) || [];
  const groups = getClassTableGroups(className);
  const firstGroup = groups[0] || {};
  const colLabels = Array.isArray(firstGroup.colLabels) ? firstGroup.colLabels : [];

  const slotsIndex = colLabels.findIndex((label) => extractLabelText(label) === "spell slots");
  const slotLevelIndex = colLabels.findIndex((label) => extractLabelText(label) === "slot level");

  const slotLevelText =
    slotLevelIndex >= 0 ? cleanDataText(row?.[slotLevelIndex]) : "";

  return {
    slotLevel: parseOrdinalLevel(slotLevelText),
    slots: slotsIndex >= 0 ? Number(row?.[slotsIndex] ?? 0) : 0,
  };
}

function getFullCasterSpellSlots(level) {
  const classes = [...getIndex().classes.values()];
  const fullCaster = classes.find((entry) =>
    normalizeName(entry.rawClass?.casterProgression) === "full"
  );

  if (!fullCaster) {
    return {};
  }

  return getClassLevelSpellSlots(fullCaster.name, level);
}

function getSpellcastingModeForClassName(className) {
  const classDef = getClassDefinition(className);
  const rawClass = classDef?.rawClass;

  if (!rawClass?.spellcastingAbility) {
    return "none";
  }

  if (
    Array.isArray(rawClass.spellsKnownProgressionFixed) &&
    rawClass.preparedSpells
  ) {
    return "spellbook";
  }

  if (rawClass.preparedSpells) {
    return "prepared";
  }

  if (
    Array.isArray(rawClass.spellsKnownProgression) ||
    rawClass.spellsKnownProgressionFixedByLevel ||
    normalizeName(rawClass.casterProgression) === "pact"
  ) {
    return "known";
  }

  return "none";
}

function evaluatePreparedSpellFormula(profile, classEntry, formula) {
  const level = Number(classEntry?.level ?? 0);
  const abilityScores = profile?.abilityModifiers || {};
  const sanitized = String(formula || "")
    .replace(/<\$level\$>/g, String(level))
    .replace(/<\$([a-z]{3})_mod\$>/gi, (_, ability) =>
      String(Number(abilityScores[String(ability).toLowerCase()] ?? 0))
    )
    .replace(/[^0-9+\-*/(). ]/g, "");

  if (!sanitized) {
    return 0;
  }

  try {
    const rawValue = Function(`"use strict"; return (${sanitized});`)();
    return Math.max(1, Math.floor(Number(rawValue || 0)));
  } catch (error) {
    return 0;
  }
}

function getPreparedSpellLimitForClassEntry(profile, classEntry) {
  const classDef = getClassDefinition(classEntry?.name);
  const formula = classDef?.rawClass?.preparedSpells;

  if (!formula) {
    return 0;
  }

  return evaluatePreparedSpellFormula(profile, classEntry, formula);
}

function getCasterProgression(className) {
  return normalizeName(getClassDefinition(className)?.rawClass?.casterProgression);
}

function getClassFeatureEntriesUpToLevel(className, classLevel) {
  const classDef = getClassDefinition(className);
  if (!classDef || classLevel <= 0) return [];

  const features = [];

  for (const rawFeatureRef of classDef.rawClass.classFeatures || []) {
    const parsed = parseClassFeatureRef(rawFeatureRef);
    if (!parsed || parsed.level > classLevel) continue;

    const resolved = getClassFeatureByRef(parsed.ref);
    const name = parsed.tableDisplayName || resolved?.name || parsed.name;
    const description = flattenEntryText(resolved?.entries || []);

    features.push({
      id: parsed.id,
      ref: parsed.ref,
      name,
      className: classDef.name,
      level: parsed.level,
      source: resolved?.source || parsed.featureSource || classDef.rawClass.source || "",
      description,
      gainSubclassFeature: parsed.gainSubclassFeature,
      type: "class",
    });
  }

  return dedupeFeatures(features);
}

function getSubclassFeatureEntriesUpToLevel(className, subclassName, classLevel) {
  const subclassDef = getSubclassDefinition(className, subclassName);
  if (!subclassDef || classLevel <= 0) return [];

  const features = [];

  for (const rawFeatureRef of subclassDef.subclassFeatures || []) {
    const parsed = parseSubclassFeatureRef(rawFeatureRef);
    if (!parsed || parsed.level > classLevel) continue;

    const resolved = getSubclassFeatureByRef(parsed.ref);

    features.push({
      id: parsed.id,
      ref: parsed.ref,
      name: resolved?.name || parsed.name,
      className: subclassDef.className,
      subclassName: subclassDef.name,
      level: parsed.level,
      source: resolved?.source || parsed.featureSource || subclassDef.source || "",
      description: flattenEntryText(resolved?.entries || []),
      type: "subclass",
    });
  }

  return dedupeFeatures(features);
}

function getFeatureEntriesForClassLevel(className, subclassName, classLevel) {
  return [
    ...getClassFeatureEntriesUpToLevel(className, classLevel),
    ...getSubclassFeatureEntriesUpToLevel(className, subclassName, classLevel),
  ].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });
}

function getFeaturesGrantedAtLevel(className, subclassName, classLevel) {
  const current = getFeatureEntriesForClassLevel(className, subclassName, classLevel);
  const previous = getFeatureEntriesForClassLevel(className, subclassName, classLevel - 1);
  const previousIds = new Set(previous.map((feature) => feature.id));

  return current.filter((feature) => !previousIds.has(feature.id));
}

function dedupeFeatures(features) {
  const seen = new Set();
  const result = [];

  for (const feature of features) {
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    result.push(feature);
  }

  return result;
}

function getSubclassRequirementLevel(className) {
  const classDef = getClassDefinition(className);
  if (!classDef) return null;

  for (const rawFeatureRef of classDef.rawClass.classFeatures || []) {
    const parsed = parseClassFeatureRef(rawFeatureRef);
    if (parsed?.gainSubclassFeature) {
      return parsed.level;
    }
  }

  return null;
}

module.exports = {
  cleanDataText,
  flattenEntryText,
  getCantripsKnownForClassLevel,
  getCasterProgression,
  getClassDefinition,
  getClassFeatureByRef,
  getClassFeatureEntriesUpToLevel,
  getClassLevelSpellSlots,
  getFeatureEntriesForClassLevel,
  getFeaturesGrantedAtLevel,
  getFullCasterSpellSlots,
  getKnownSpellLimitForClassLevel,
  getMysticArcanumProgressionForClassLevel,
  getPactMagicForClassLevel,
  getPreparedSpellLimitForClassEntry,
  getSpellcastingModeForClassName,
  getSubclassDefinition,
  getSubclassFeatureByRef,
  getSubclassFeatureEntriesUpToLevel,
  getSubclassOptions,
  getSubclassRequirementLevel,
  normalizeName,
  parseClassFeatureRef,
};
