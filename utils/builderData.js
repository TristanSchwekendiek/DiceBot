const fs = require("fs");
const path = require("path");

const {
  getSpellcastingModeForClassName,
  normalizeName,
} = require("./classData");

const DATA_ROOT = path.join(__dirname, "..");
const CLASS_DATA_DIR = path.join(DATA_ROOT, "class_data");

let cachedBuilderData = null;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function scoreClassRecord(record) {
  let score = 0;

  if ((record?.edition || "").toLowerCase() === "classic") score += 100;
  if ((record?.source || "").toUpperCase() === "PHB") score += 75;
  if (record?.srd) score += 25;
  if (record?.basicRules) score += 20;

  return score;
}

function chooseBestClassRecord(records) {
  return records.reduce((best, candidate) => {
    if (!best) return candidate;
    return scoreClassRecord(candidate) > scoreClassRecord(best) ? candidate : best;
  }, null);
}

function summarizeClassFile(fileName) {
  const filePath = path.join(CLASS_DATA_DIR, fileName);
  const data = readJson(filePath);
  const classRecord = chooseBestClassRecord(data.class || []);

  if (!classRecord) {
    return null;
  }

  const classKey = normalizeName(classRecord.name);
  const subclasses = (data.subclass || [])
    .filter((subclass) => normalizeName(subclass.className) === classKey)
    .map((subclass) => ({
      name: subclass.name,
      shortName: subclass.shortName || subclass.name,
      source: subclass.source || "",
      className: subclass.className || classRecord.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: classRecord.name,
    source: classRecord.source || "",
    hitDie: Number(classRecord.hd?.faces ?? 0),
    savingThrows: classRecord.proficiency || [],
    spellcastingAbility: classRecord.spellcastingAbility || null,
    spellcastingMode: getSpellcastingModeForClassName(classRecord.name),
    casterProgression: classRecord.casterProgression || "none",
    preparedSpells: classRecord.preparedSpells || null,
    cantripProgression: classRecord.cantripProgression || [],
    spellsKnownProgression: classRecord.spellsKnownProgression || [],
    spellsKnownProgressionFixed: classRecord.spellsKnownProgressionFixed || [],
    startingProficiencies: classRecord.startingProficiencies || {},
    startingEquipment: classRecord.startingEquipment || {},
    subclasses,
  };
}

function getClassSummaries() {
  return fs
    .readdirSync(CLASS_DATA_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map(summarizeClassFile)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getBuilderData({ forceRefresh = false } = {}) {
  if (cachedBuilderData && !forceRefresh) {
    return cachedBuilderData;
  }

  const raceData = readJson(path.join(DATA_ROOT, "race_data", "races.json"));
  const featData = readJson(path.join(DATA_ROOT, "feat_data", "feats.json"));
  const spellData = readJson(path.join(DATA_ROOT, "spells.json"));

  cachedBuilderData = {
    classes: getClassSummaries(),
    races: raceData.race || [],
    subraces: raceData.subrace || [],
    feats: featData.feat || [],
    spells: spellData.spell || [],
  };

  return cachedBuilderData;
}

module.exports = {
  getBuilderData,
};
