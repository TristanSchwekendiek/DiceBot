const ABILITIES = [
  { key: "str", label: "STR" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIS" },
  { key: "cha", label: "CHA" },
];

const SKILLS = [
  ["acrobatics", "Acrobatics", "dex"],
  ["animal-handling", "Animal Handling", "wis"],
  ["arcana", "Arcana", "int"],
  ["athletics", "Athletics", "str"],
  ["deception", "Deception", "cha"],
  ["history", "History", "int"],
  ["insight", "Insight", "wis"],
  ["intimidation", "Intimidation", "cha"],
  ["investigation", "Investigation", "int"],
  ["medicine", "Medicine", "wis"],
  ["nature", "Nature", "int"],
  ["perception", "Perception", "wis"],
  ["performance", "Performance", "cha"],
  ["persuasion", "Persuasion", "cha"],
  ["religion", "Religion", "int"],
  ["sleight-of-hand", "Sleight of Hand", "dex"],
  ["stealth", "Stealth", "dex"],
  ["survival", "Survival", "wis"],
];

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

const FULL_CASTER_HIGHEST_SLOT = {
  0: 0,
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 3,
  6: 3,
  7: 4,
  8: 4,
  9: 5,
  10: 5,
  11: 6,
  12: 6,
  13: 7,
  14: 7,
  15: 8,
  16: 8,
  17: 9,
  18: 9,
  19: 9,
  20: 9,
};

const state = {
  playerName: "",
  characterName: "",
  className: "",
  subclassName: "",
  level: 1,
  experience: 0,
  raceId: "",
  subraceId: "",
  background: "",
  alignment: "",
  ac: 10,
  hpMax: 8,
  baseAbilities: {
    str: 15,
    dex: 14,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  },
  skillProficiencies: {},
  skillExpertise: {},
  startingFeat: false,
  feats: [],
  spells: [],
  gearChoices: {},
  customGear: "",
};

let data = {
  classes: [],
  races: [],
  subraces: [],
  feats: [],
  spells: [],
};

let latestProfile = null;
let refreshTimer = null;

const dom = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectDom();
  bindStaticEvents();
  showLoading();

  const response = await fetch("/api/builder-data");
  data = await response.json();

  decorateDataIds();
  restoreDraft();
  seedDefaults();
  renderAllControls();
  syncInputsFromState();
  await refreshProfile();
}

function collectDom() {
  [
    "characterName",
    "playerName",
    "classSelect",
    "levelInput",
    "subclassSelect",
    "experienceInput",
    "raceSelect",
    "subraceSelect",
    "backgroundInput",
    "alignmentInput",
    "acInput",
    "hpInput",
    "raceTraitSummary",
    "abilityGrid",
    "bonusStrip",
    "savingThrowGrid",
    "skillGrid",
    "startingFeatToggle",
    "featSearch",
    "featSelect",
    "featAbilitySelect",
    "addFeatButton",
    "selectedFeats",
    "spellMeta",
    "spellSearch",
    "spellLevelFilter",
    "spellList",
    "gearChoices",
    "customGear",
    "previewName",
    "previewLevel",
    "coreStats",
    "scorePreview",
    "featurePreview",
    "spellPreview",
    "jsonPreview",
    "exportButton",
    "copyButton",
    "resetButton",
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindStaticEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      document.getElementById(`tab-${button.dataset.tab}`).classList.add("is-active");
    });
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const presets = {
        standard: [15, 14, 13, 12, 10, 8],
        balanced: [13, 13, 13, 12, 12, 10],
        heroic: [16, 15, 14, 13, 12, 10],
      };
      const values = presets[button.dataset.preset] || presets.standard;
      ABILITIES.forEach((ability, index) => {
        state.baseAbilities[ability.key] = values[index];
      });
      renderAbilities();
      scheduleRefresh();
    });
  });

  dom.addFeatButton.addEventListener("click", addSelectedFeat);
  dom.exportButton.addEventListener("click", exportJson);
  dom.copyButton.addEventListener("click", copyJson);
  dom.resetButton.addEventListener("click", resetBuilder);
}

function bindInputEvents() {
  const simpleBindings = [
    ["characterName", "characterName", String],
    ["playerName", "playerName", String],
    ["backgroundInput", "background", String],
    ["alignmentInput", "alignment", String],
    ["experienceInput", "experience", toNonNegativeInt],
    ["acInput", "ac", toPositiveInt],
    ["hpInput", "hpMax", toPositiveInt],
    ["customGear", "customGear", String],
  ];

  simpleBindings.forEach(([id, key, cast]) => {
    dom[id].addEventListener("input", () => {
      state[key] = cast(dom[id].value);
      scheduleRefresh();
    });
  });

  dom.classSelect.addEventListener("change", () => {
    state.className = dom.classSelect.value;
    state.subclassName = "";
    state.spells = [];
    state.gearChoices = {};
    syncClassDefaults();
    renderSubclassSelect();
    renderSavingThrows();
    renderGearChoices();
    renderSpellControls();
    scheduleRefresh();
  });

  dom.levelInput.addEventListener("input", () => {
    state.level = clamp(toPositiveInt(dom.levelInput.value), 1, 20);
    state.experience = XP_THRESHOLDS[state.level] || 0;
    dom.experienceInput.value = state.experience;
    renderSpellControls();
    scheduleRefresh();
  });

  dom.subclassSelect.addEventListener("change", () => {
    state.subclassName = dom.subclassSelect.value;
    renderSpellControls();
    scheduleRefresh();
  });

  dom.raceSelect.addEventListener("change", () => {
    state.raceId = dom.raceSelect.value;
    state.subraceId = "";
    renderSubraceSelect();
    renderAbilities();
    renderRaceSummary();
    scheduleRefresh();
  });

  dom.subraceSelect.addEventListener("change", () => {
    state.subraceId = dom.subraceSelect.value;
    renderAbilities();
    renderRaceSummary();
    scheduleRefresh();
  });

  dom.startingFeatToggle.addEventListener("change", () => {
    state.startingFeat = dom.startingFeatToggle.checked;
    scheduleRefresh();
  });

  dom.featSearch.addEventListener("input", renderFeatSelect);
  dom.featSelect.addEventListener("change", renderFeatAbilitySelect);
  dom.spellSearch.addEventListener("input", renderSpellList);
  dom.spellLevelFilter.addEventListener("change", renderSpellList);
}

function showLoading() {
  dom.jsonPreview.textContent = "Loading builder data...";
}

function decorateDataIds() {
  for (const collectionName of ["races", "subraces", "feats"]) {
    data[collectionName].forEach((item, index) => {
      item._builderId = `${item.name}::${item.source || ""}::${index}`;
    });
  }
}

function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem("dicebot-builder-draft") || "null");
    if (saved && typeof saved === "object") {
      Object.assign(state, saved);
    }
  } catch (error) {
    localStorage.removeItem("dicebot-builder-draft");
  }
}

function seedDefaults() {
  if (!state.className) {
    state.className = findClass("Wizard")?.name || data.classes[0]?.name || "";
  }

  if (!state.raceId) {
    state.raceId = findRaceId("Human", "PHB") || data.races[0]?._builderId || "";
  }

  syncClassDefaults();
  normalizeSubclassState();
  state.experience = Number(state.experience ?? XP_THRESHOLDS[state.level] ?? 0);
}

function syncClassDefaults() {
  const cls = getSelectedClass();
  if (!cls) return;

  state.hpMax = Math.max(Number(state.hpMax || 0), cls.hitDie || 8);
  state.ac = Number(state.ac || 10);

  if (!Object.keys(state.gearChoices).length) {
    const rows = cls.startingEquipment?.defaultData || [];
    rows.forEach((row, index) => {
      const firstChoice = Object.keys(row || {})[0];
      if (firstChoice) state.gearChoices[index] = firstChoice;
    });
  }
}

function renderAllControls() {
  renderClassSelect();
  renderSubclassSelect();
  renderRaceSelect();
  renderSubraceSelect();
  renderAbilities();
  renderSavingThrows();
  renderSkills();
  renderFeatSelect();
  renderFeatAbilitySelect();
  renderSelectedFeats();
  renderSpellControls();
  renderGearChoices();
  renderRaceSummary();
  bindInputEvents();
}

function syncInputsFromState() {
  dom.characterName.value = state.characterName || "";
  dom.playerName.value = state.playerName || "";
  dom.levelInput.value = state.level;
  dom.experienceInput.value = state.experience;
  dom.backgroundInput.value = state.background || "";
  dom.alignmentInput.value = state.alignment || "";
  dom.acInput.value = state.ac;
  dom.hpInput.value = state.hpMax;
  dom.startingFeatToggle.checked = Boolean(state.startingFeat);
  dom.customGear.value = state.customGear || "";
}

function renderClassSelect() {
  dom.classSelect.innerHTML = data.classes
    .map((cls) => `<option value="${escapeAttr(cls.name)}">${escapeHtml(cls.name)}</option>`)
    .join("");
  dom.classSelect.value = state.className;
}

function renderSubclassSelect() {
  const cls = getSelectedClass();
  const subclasses = getSubclassesForClass(cls);
  normalizeSubclassState(cls, subclasses);

  dom.subclassSelect.innerHTML = [
    '<option value="">None</option>',
    ...subclasses.map((subclass) => `<option value="${escapeAttr(subclass.name)}">${escapeHtml(subclass.name)}</option>`),
  ].join("");
  dom.subclassSelect.value = state.subclassName || "";
  dom.subclassSelect.disabled = subclasses.length === 0;
}

function renderRaceSelect() {
  const counts = data.races.reduce((acc, race) => {
    acc[normalizeName(race.name)] = (acc[normalizeName(race.name)] || 0) + 1;
    return acc;
  }, {});

  const sorted = [...data.races].sort((a, b) => {
    const nameSort = a.name.localeCompare(b.name);
    return nameSort || String(a.source || "").localeCompare(String(b.source || ""));
  });

  dom.raceSelect.innerHTML = sorted
    .map((race) => {
      const duplicate = counts[normalizeName(race.name)] > 1;
      const label = duplicate ? `${race.name} (${race.source || "Unknown"})` : race.name;
      return `<option value="${escapeAttr(race._builderId)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (!data.races.some((race) => race._builderId === state.raceId)) {
    state.raceId = dom.raceSelect.options[0]?.value || "";
  }
  dom.raceSelect.value = state.raceId;
}

function renderSubraceSelect() {
  const race = getSelectedRace();
  const subraces = getSubracesForRace(race);

  dom.subraceSelect.innerHTML = [
    '<option value="">None</option>',
    ...subraces.map((subrace) => `<option value="${escapeAttr(subrace._builderId)}">${escapeHtml(subrace.name)}</option>`),
  ].join("");

  if (!subraces.some((subrace) => subrace._builderId === state.subraceId)) {
    state.subraceId = "";
  }
  dom.subraceSelect.value = state.subraceId;
}

function renderAbilities() {
  const bonuses = getAllAbilityBonuses();
  const totals = getAbilityScores();

  dom.abilityGrid.innerHTML = ABILITIES.map((ability) => {
    const bonus = bonuses[ability.key] || 0;
    const sign = bonus >= 0 ? "+" : "";
    return `
      <div class="ability-box">
        <strong>${ability.label}</strong>
        <input type="number" min="1" max="30" value="${state.baseAbilities[ability.key]}" data-ability="${ability.key}" />
        <small>Final ${totals[ability.key]} (${formatModifier(abilityMod(totals[ability.key]))})</small>
        <small>Bonus ${sign}${bonus}</small>
      </div>
    `;
  }).join("");

  dom.abilityGrid.querySelectorAll("input[data-ability]").forEach((input) => {
    input.addEventListener("input", () => {
      state.baseAbilities[input.dataset.ability] = clamp(toPositiveInt(input.value), 1, 30);
      renderAbilities();
      scheduleRefresh();
    });
  });

  const bonusTags = Object.entries(bonuses)
    .filter(([, value]) => value !== 0)
    .map(([ability, value]) => `<span class="tag good">${ability.toUpperCase()} ${value >= 0 ? "+" : ""}${value}</span>`);

  dom.bonusStrip.innerHTML = bonusTags.length
    ? bonusTags.join("")
    : '<span class="tag">No automatic ability bonuses</span>';
}

function renderSavingThrows() {
  const cls = getSelectedClass();
  const saveSet = new Set((cls?.savingThrows || []).map(normalizeName));

  dom.savingThrowGrid.innerHTML = ABILITIES.map((ability) => `
      <label class="check-tile">
      <span>${ability.label} Save</span>
      <input type="checkbox" ${saveSet.has(ability.key) ? "checked" : ""} disabled />
    </label>
  `).join("");
}

function renderSkills() {
  dom.skillGrid.innerHTML = SKILLS.map(([key, label, ability]) => `
    <div class="check-tile">
      <span title="${escapeAttr(label)}">${escapeHtml(label)} <small>(${ability.toUpperCase()})</small></span>
      <label title="Proficient">
        <small>P</small>
        <input type="checkbox" data-skill="${key}" data-kind="proficiency" ${state.skillProficiencies[key] ? "checked" : ""} />
      </label>
      <label title="Expertise">
        <small>E</small>
        <input type="checkbox" data-skill="${key}" data-kind="expertise" ${state.skillExpertise[key] ? "checked" : ""} />
      </label>
    </div>
  `).join("");

  dom.skillGrid.querySelectorAll("input[data-skill]").forEach((input) => {
    input.addEventListener("change", () => {
      const target = input.dataset.kind === "expertise" ? state.skillExpertise : state.skillProficiencies;
      target[input.dataset.skill] = input.checked;
      scheduleRefresh();
    });
  });
}

function renderFeatSelect() {
  const query = normalizeName(dom.featSearch.value || "");
  const feats = data.feats
    .filter((feat) => !query || normalizeName(feat.name).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 180);

  dom.featSelect.innerHTML = feats
    .map((feat) => `<option value="${escapeAttr(feat._builderId)}">${escapeHtml(feat.name)}</option>`)
    .join("");

  renderFeatAbilitySelect();
}

function renderFeatAbilitySelect() {
  const feat = getSelectedFeatFromSelect();
  const choice = getFeatAbilityChoice(feat);

  if (!choice) {
    dom.featAbilitySelect.innerHTML = '<option value="">No ability choice</option>';
    dom.featAbilitySelect.disabled = true;
    return;
  }

  dom.featAbilitySelect.disabled = false;
  dom.featAbilitySelect.innerHTML = choice.from
    .map((ability) => `<option value="${escapeAttr(ability)}">${ability.toUpperCase()} +${choice.amount}</option>`)
    .join("");
}

function renderSelectedFeats() {
  if (!state.feats.length) {
    dom.selectedFeats.innerHTML = '<div class="is-empty">No feats selected.</div>';
    return;
  }

  dom.selectedFeats.innerHTML = state.feats.map((selected, index) => {
    const ability = selected.chosenAbility ? `, ${selected.chosenAbility.toUpperCase()}` : "";
    return `
      <div class="selected-item">
        <div>
          <strong>${escapeHtml(selected.name)}</strong>
          <small>${escapeHtml(selected.source || "Unknown")}${ability}</small>
        </div>
        <button class="mini-button" type="button" data-remove-feat="${index}">Remove</button>
      </div>
    `;
  }).join("");

  dom.selectedFeats.querySelectorAll("[data-remove-feat]").forEach((button) => {
    button.addEventListener("click", () => {
      state.feats.splice(Number(button.dataset.removeFeat), 1);
      renderSelectedFeats();
      renderAbilities();
      scheduleRefresh();
    });
  });
}

function renderSpellControls() {
  const cls = getSelectedClass();
  const highest = getHighestSpellLevel(cls, state.level);
  const mode = cls?.spellcastingMode || "none";

  if (mode === "none" || highest === 0) {
    dom.spellMeta.innerHTML = '<span class="tag">No class spellcasting</span>';
  } else {
    dom.spellMeta.innerHTML = [
      `<span class="tag good">${escapeHtml(modeLabel(mode))}</span>`,
      `<span class="tag">Highest slot ${highest}</span>`,
      cls.spellcastingAbility ? `<span class="tag">${cls.spellcastingAbility.toUpperCase()} casting</span>` : "",
    ].filter(Boolean).join("");
  }

  dom.spellLevelFilter.innerHTML = [
    '<option value="all">All levels</option>',
    '<option value="0">Cantrips</option>',
    ...Array.from({ length: Math.max(highest, 0) }, (_, index) => {
      const level = index + 1;
      return `<option value="${level}">Level ${level}</option>`;
    }),
  ].join("");

  renderSpellList();
}

function renderSpellList() {
  const cls = getSelectedClass();
  const highest = getHighestSpellLevel(cls, state.level);
  const query = normalizeName(dom.spellSearch.value || "");
  const levelFilter = dom.spellLevelFilter.value || "all";
  const allowed = getAvailableSpells()
    .filter((spell) => Number(spell.level || 0) === 0 || Number(spell.level || 0) <= highest)
    .filter((spell) => levelFilter === "all" || Number(spell.level || 0) === Number(levelFilter))
    .filter((spell) => !query || normalizeName(spell.name).includes(query))
    .sort((a, b) => Number(a.level || 0) - Number(b.level || 0) || a.name.localeCompare(b.name));

  if (!allowed.length) {
    dom.spellList.innerHTML = '<div class="is-empty">No matching spells.</div>';
    return;
  }

  const selected = new Set(state.spells.map(normalizeName));

  dom.spellList.innerHTML = allowed.map((spell) => {
    const spellLevel = Number(spell.level || 0);
    return `
      <label class="spell-item">
        <input type="checkbox" data-spell="${escapeAttr(spell.name)}" ${selected.has(normalizeName(spell.name)) ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(spell.name)}</strong>
          <small>${spellLevel === 0 ? "Cantrip" : `Level ${spellLevel}`} ${escapeHtml(capitalize(String(spell.school || "")))}</small>
        </span>
      </label>
    `;
  }).join("");

  dom.spellList.querySelectorAll("input[data-spell]").forEach((input) => {
    input.addEventListener("change", () => {
      const name = input.dataset.spell;
      const existing = new Set(state.spells.map(normalizeName));
      if (input.checked && !existing.has(normalizeName(name))) {
        state.spells.push(name);
      } else if (!input.checked) {
        state.spells = state.spells.filter((spellName) => normalizeName(spellName) !== normalizeName(name));
      }
      scheduleRefresh();
    });
  });
}

function renderGearChoices() {
  const cls = getSelectedClass();
  const rows = cls?.startingEquipment?.defaultData || [];
  const labels = cls?.startingEquipment?.default || [];

  if (!rows.length) {
    dom.gearChoices.innerHTML = '<div class="is-empty">No class starting gear choices found.</div>';
    return;
  }

  dom.gearChoices.innerHTML = rows.map((row, index) => {
    const keys = Object.keys(row || {});
    const selected = state.gearChoices[index] || keys[0] || "";
    const buttons = keys.map((key) => `
      <button class="mini-button ${selected === key ? "is-selected" : ""}" type="button" data-gear-row="${index}" data-gear-choice="${escapeAttr(key)}">
        ${key === "_" ? "Take" : key.toUpperCase()}
      </button>
    `).join("");

    return `
      <div class="gear-choice">
        <div>
          <strong>Choice ${index + 1}</strong>
          <small>${escapeHtml(cleanText(labels[index] || describeGearItems(row[selected] || [])))}</small>
        </div>
        <div>${buttons}</div>
      </div>
    `;
  }).join("");

  dom.gearChoices.querySelectorAll("[data-gear-row]").forEach((button) => {
    button.addEventListener("click", () => {
      state.gearChoices[button.dataset.gearRow] = button.dataset.gearChoice;
      renderGearChoices();
      scheduleRefresh();
    });
  });
}

function renderRaceSummary() {
  const race = getSelectedRace();
  const subrace = getSelectedSubrace();
  const tags = [];

  for (const source of [race, subrace]) {
    for (const entry of source?.entries || []) {
      if (entry?.name && !["age", "alignment", "size", "languages"].includes(normalizeName(entry.name))) {
        tags.push(`<span class="tag">${escapeHtml(entry.name)}</span>`);
      }
    }
  }

  dom.raceTraitSummary.innerHTML = tags.slice(0, 10).join("") || '<span class="tag">No race traits found</span>';
}

async function refreshProfile() {
  clearTimeout(refreshTimer);
  const localProfile = buildProfile();
  latestProfile = localProfile;
  renderPreview(localProfile);
  dom.jsonPreview.textContent = JSON.stringify(localProfile, null, 2);

  try {
    const response = await fetch("/api/builder/normalize-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: localProfile }),
    });

    if (!response.ok) {
      throw new Error("Profile normalization failed.");
    }

    latestProfile = await response.json();
    renderPreview(latestProfile);
    dom.jsonPreview.textContent = JSON.stringify(latestProfile, null, 2);
  } catch (error) {
    dom.jsonPreview.textContent = JSON.stringify(localProfile, null, 2);
  }

  persistDraft();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshProfile, 240);
}

function buildProfile() {
  const cls = getSelectedClass();
  const race = getSelectedRace();
  const subrace = getSelectedSubrace();
  const abilities = getAbilityScores();
  const classKey = normalizeName(cls?.name || "");
  const subclassName = getSelectedSubclassName();
  const mode = cls?.spellcastingMode || "none";
  const selectedSpells = sortSpellsByLevel(state.spells);
  const preparedSpells = mode === "prepared" || mode === "spellbook" ? selectedSpells : [];
  const knownSpells = mode === "known" || mode === "spellbook" ? selectedSpells : [];
  const level = clamp(Number(state.level || 1), 1, 20);

  const savingThrowProficiencies = {};
  const classSaves = new Set((cls?.savingThrows || []).map(normalizeName));
  ABILITIES.forEach((ability) => {
    savingThrowProficiencies[ability.key] = classSaves.has(ability.key);
  });

  const skillProficiencies = {};
  const skillExpertise = {};
  const racialSkillProficiencies = getGrantedSkillProficiencies([race, subrace]);
  SKILLS.forEach(([key]) => {
    skillProficiencies[key] = Boolean(state.skillProficiencies[key] || racialSkillProficiencies.has(key));
    skillExpertise[key] = Boolean(state.skillExpertise[key]);
  });

  const spellcastingByClass = {};
  if (cls && mode !== "none") {
    spellcastingByClass[classKey] = {
      className: cls.name,
      subclass: subclassName,
      mode,
      preparedLimit: 0,
      cantripsKnown: 0,
      knownSpellLimit: 0,
      mysticArcanum: {},
      preparedSpells,
      knownSpells,
      loadouts: {},
    };
  }

  return {
    playerName: state.playerName || "",
    characterName: state.characterName || "Unnamed Character",
    race: race?.name || "",
    subrace: subrace?.name || "",
    alignment: state.alignment || "",
    background: state.background || "",
    class: cls?.name || "",
    subclass: subclassName,
    level,
    hitDie: Number(cls?.hitDie || 0),
    classes: cls
      ? [
          {
            name: cls.name,
            subclass: subclassName,
            level,
            hitDie: Number(cls.hitDie || 0),
          },
        ]
      : [],
    totalLevel: level,
    experience: Number(state.experience || 0),
    ac: Number(state.ac || 10),
    hp: {
      current: Number(state.hpMax || 1),
      max: Number(state.hpMax || 1),
    },
    initiative: abilityMod(abilities.dex),
    passivePerception: 10,
    proficiencyBonus: Math.floor((level - 1) / 4) + 2,
    abilities,
    savingThrowProficiencies,
    skillProficiencies,
    skillExpertise,
    inventory: buildInventory(),
    spellcastingByClass,
    selectedFeats: state.feats.map((feat, index) => ({
      name: feat.name,
      source: feat.source || "",
      chosenAbility: feat.chosenAbility || null,
      acquiredLevel: state.startingFeat && index === 0 ? 1 : level,
      category: feat.category || "",
    })),
    deathSaves: {
      successes: 0,
      failures: 0,
    },
  };
}

function renderPreview(profile) {
  const abilities = profile.abilities || getAbilityScores();
  dom.previewName.textContent = profile.characterName || "Unnamed Character";
  dom.previewLevel.textContent = `Level ${profile.totalLevel || profile.level || 1}`;

  dom.coreStats.innerHTML = [
    ["AC", profile.ac || 10],
    ["HP", `${profile.hp?.current || 1}/${profile.hp?.max || 1}`],
    ["Init", formatModifier(profile.initiative || 0)],
    ["PB", formatModifier(profile.proficiencyBonus || 2)],
  ].map(([label, value]) => `<div class="stat-chip">${label} ${value}</div>`).join("");

  dom.scorePreview.innerHTML = ABILITIES.map((ability) => `
    <div class="score-cell">
      <strong>${ability.label}</strong>
      <span>${abilities[ability.key] ?? 10}</span>
      <small>${formatModifier(abilityMod(abilities[ability.key] ?? 10))}</small>
    </div>
  `).join("");

  const features = [
    ...(profile.racialFeatures || []),
    ...(profile.selectedFeatFeatures || []),
    ...(profile.characterFeatures || []),
  ].slice(0, 12);

  dom.featurePreview.innerHTML = features.length
    ? `<div class="preview-lines">${features.map((feature) => `<div class="preview-line">${escapeHtml(feature.name)}</div>`).join("")}</div>`
    : '<div class="is-empty">No derived features yet.</div>';

  const spellNames = getProfileSpellNames(profile).slice(0, 18);
  dom.spellPreview.innerHTML = spellNames.length
    ? `<div class="preview-lines">${spellNames.map((name) => `<div class="preview-line">${escapeHtml(name)}</div>`).join("")}</div>`
    : '<div class="is-empty">No spells selected.</div>';
}

function addSelectedFeat() {
  const feat = getSelectedFeatFromSelect();
  if (!feat) return;

  if (state.feats.some((selected) => normalizeName(selected.name) === normalizeName(feat.name))) {
    return;
  }

  state.feats.push({
    name: feat.name,
    source: feat.source || "",
    chosenAbility: dom.featAbilitySelect.disabled ? null : dom.featAbilitySelect.value,
    category: feat.category || "",
  });

  renderSelectedFeats();
  renderAbilities();
  scheduleRefresh();
}

async function exportJson() {
  await refreshProfile();
  const profile = latestProfile || buildProfile();
  const fileName = `${safeFileName(profile.characterName || "character")}-dicebot-profile.json`;
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyJson() {
  const text = dom.jsonPreview.textContent || "{}";
  try {
    await navigator.clipboard.writeText(text);
    dom.copyButton.textContent = "Copied";
  } catch (error) {
    dom.copyButton.textContent = "Copy failed";
  }
  setTimeout(() => {
    dom.copyButton.textContent = "Copy";
  }, 1200);
}

function resetBuilder() {
  localStorage.removeItem("dicebot-builder-draft");
  window.location.reload();
}

function persistDraft() {
  localStorage.setItem("dicebot-builder-draft", JSON.stringify(state));
}

function getSelectedClass() {
  return findClass(state.className);
}

function getSubclassesForClass(cls) {
  if (!cls) return [];

  const seen = new Set();
  return (cls.subclasses || [])
    .filter((subclass) => {
      if (!subclass?.name) return false;
      if (subclass.className && normalizeName(subclass.className) !== normalizeName(cls.name)) return false;
      if (subclass.classSource && cls.source && normalizeName(subclass.classSource) !== normalizeName(cls.source)) return false;

      const key = normalizeName(subclass.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSelectedSubclassName() {
  const cls = getSelectedClass();
  const subclasses = getSubclassesForClass(cls);
  const match = subclasses.find((subclass) => normalizeName(subclass.name) === normalizeName(state.subclassName));
  return match?.name || "";
}

function normalizeSubclassState(cls = getSelectedClass(), subclasses = getSubclassesForClass(cls)) {
  if (!state.subclassName) return;

  const match = subclasses.find((subclass) => normalizeName(subclass.name) === normalizeName(state.subclassName));
  state.subclassName = match?.name || "";
}

function findClass(name) {
  return data.classes.find((cls) => normalizeName(cls.name) === normalizeName(name)) || null;
}

function getSelectedRace() {
  return data.races.find((race) => race._builderId === state.raceId) || null;
}

function getSelectedSubrace() {
  return data.subraces.find((subrace) => subrace._builderId === state.subraceId) || null;
}

function findRaceId(name, source = null) {
  const match = data.races.find(
    (race) =>
      normalizeName(race.name) === normalizeName(name) &&
      (!source || normalizeName(race.source) === normalizeName(source))
  );
  return match?._builderId || "";
}

function getSubracesForRace(race) {
  if (!race) return [];

  return data.subraces
    .filter((subrace) => {
      if (normalizeName(subrace.raceName) !== normalizeName(race.name)) return false;
      if (!subrace.raceSource || !race.source) return true;
      return normalizeName(subrace.raceSource) === normalizeName(race.source);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSelectedFeatFromSelect() {
  return data.feats.find((feat) => feat._builderId === dom.featSelect.value) || null;
}

function getAllAbilityBonuses() {
  const totals = Object.fromEntries(ABILITIES.map((ability) => [ability.key, 0]));

  for (const source of [getSelectedRace(), getSelectedSubrace()]) {
    mergeAbilityBonus(totals, fixedAbilityBonus(source));
  }

  for (const selected of state.feats) {
    const feat = data.feats.find((item) => normalizeName(item.name) === normalizeName(selected.name));
    mergeAbilityBonus(totals, featAbilityBonus(feat, selected.chosenAbility));
  }

  return totals;
}

function getGrantedSkillProficiencies(sources) {
  const result = new Set();

  for (const source of sources) {
    for (const entry of source?.skillProficiencies || []) {
      for (const [skill, value] of Object.entries(entry || {})) {
        if (value === true) {
          result.add(normalizeName(skill).replace(/\s+/g, "-"));
        }
      }
    }
  }

  return result;
}

function getAbilityScores() {
  const bonuses = getAllAbilityBonuses();
  const scores = {};

  ABILITIES.forEach((ability) => {
    scores[ability.key] = clamp(Number(state.baseAbilities[ability.key] || 10) + Number(bonuses[ability.key] || 0), 1, 30);
  });

  return scores;
}

function fixedAbilityBonus(source) {
  const result = Object.fromEntries(ABILITIES.map((ability) => [ability.key, 0]));

  for (const entry of source?.ability || []) {
    for (const ability of ABILITIES) {
      if (entry && Object.prototype.hasOwnProperty.call(entry, ability.key)) {
        result[ability.key] += Number(entry[ability.key] || 0);
      }
    }
  }

  return result;
}

function featAbilityBonus(feat, chosenAbility) {
  const result = Object.fromEntries(ABILITIES.map((ability) => [ability.key, 0]));
  if (!feat) return result;

  for (const entry of feat.ability || []) {
    for (const ability of ABILITIES) {
      if (entry && Object.prototype.hasOwnProperty.call(entry, ability.key)) {
        result[ability.key] += Number(entry[ability.key] || 0);
      }
    }

    const choice = entry.choose;
    if (choice && chosenAbility) {
      const from = Array.isArray(choice.from) ? choice.from.map(normalizeName) : [];
      const amount = Number(choice.amount || 1);
      if (from.includes(normalizeName(chosenAbility))) {
        result[normalizeName(chosenAbility)] += amount;
      }
    }
  }

  return result;
}

function getFeatAbilityChoice(feat) {
  const choices = [];

  for (const entry of feat?.ability || []) {
    if (entry.choose) {
      choices.push({
        from: Array.isArray(entry.choose.from) ? entry.choose.from.map(normalizeName) : [],
        amount: Number(entry.choose.amount || 1),
        count: Number(entry.choose.count || 1),
      });
    }
  }

  if (choices.length !== 1 || choices[0].count !== 1) return null;
  return choices[0];
}

function mergeAbilityBonus(target, source) {
  ABILITIES.forEach((ability) => {
    target[ability.key] += Number(source[ability.key] || 0);
  });
}

function getAvailableSpells() {
  const cls = getSelectedClass();
  if (!cls || cls.spellcastingMode === "none") return [];

  return data.spells.filter((spell) => spellBelongsToClass(spell, cls.name, getSelectedSubclassName()));
}

function spellBelongsToClass(spell, className, subclassName) {
  const classMatches = (spell.classes?.fromClassList || []).some(
    (entry) => normalizeName(entry.name) === normalizeName(className)
  );

  if (classMatches) return true;

  if (!subclassName) return false;

  return (spell.classes?.fromSubclass || []).some((entry) => {
    const spellClass = entry.class?.name || "";
    const spellSubclass = entry.subclass?.name || "";
    const selected = normalizeName(subclassName);
    const candidate = normalizeName(spellSubclass);
    return (
      normalizeName(spellClass) === normalizeName(className) &&
      (selected === candidate || selected.includes(candidate) || candidate.includes(selected))
    );
  });
}

function getHighestSpellLevel(cls, level) {
  if (!cls || cls.spellcastingMode === "none") return 0;

  const safeLevel = clamp(Number(level || 1), 1, 20);
  const progression = String(cls.casterProgression || "none").toLowerCase();

  if (progression === "pact") {
    if (safeLevel < 3) return 1;
    if (safeLevel < 5) return 2;
    if (safeLevel < 7) return 3;
    if (safeLevel < 9) return 4;
    return 5;
  }

  if (progression === "full") {
    return FULL_CASTER_HIGHEST_SLOT[safeLevel] || 0;
  }

  if (progression === "artificer") {
    return FULL_CASTER_HIGHEST_SLOT[Math.ceil(safeLevel / 2)] || 0;
  }

  if (progression === "1 2") {
    return FULL_CASTER_HIGHEST_SLOT[Math.floor(safeLevel / 2)] || 0;
  }

  if (progression === "1 3") {
    return FULL_CASTER_HIGHEST_SLOT[Math.floor(safeLevel / 3)] || 0;
  }

  return 0;
}

function sortSpellsByLevel(names) {
  const byName = new Map(data.spells.map((spell) => [normalizeName(spell.name), spell]));
  return [...names].sort((a, b) => {
    const spellA = byName.get(normalizeName(a));
    const spellB = byName.get(normalizeName(b));
    return Number(spellA?.level || 0) - Number(spellB?.level || 0) || a.localeCompare(b);
  });
}

function buildInventory() {
  const cls = getSelectedClass();
  const rows = cls?.startingEquipment?.defaultData || [];
  const inventory = [];

  rows.forEach((row, index) => {
    const choiceKey = state.gearChoices[index] || Object.keys(row || {})[0];
    for (const item of row?.[choiceKey] || []) {
      const name = gearItemName(item);
      if (name) addInventoryItem(inventory, name, 1, "starting gear");
    }
  });

  for (const line of splitCustomGear(state.customGear)) {
    addInventoryItem(inventory, line.name, line.quantity, "custom");
  }

  return inventory;
}

function addInventoryItem(inventory, name, quantity, category) {
  const cleanName = cleanText(name).trim();
  if (!cleanName) return;

  const existing = inventory.find((item) => normalizeName(item.name) === normalizeName(cleanName));
  if (existing) {
    existing.quantity += Number(quantity || 1);
  } else {
    inventory.push({
      name: cleanName,
      quantity: Number(quantity || 1),
      equipped: false,
      category,
    });
  }
}

function gearItemName(item) {
  if (!item) return "";

  if (typeof item === "string") {
    return item.split("|")[0];
  }

  if (typeof item === "object") {
    if (item.item) return String(item.item).split("|")[0];
    if (item.equipmentType) return cleanEquipmentType(item.equipmentType);
    if (item.special) return item.special;
  }

  return "";
}

function cleanEquipmentType(value) {
  return String(value || "")
    .replace(/^focusSpellcasting/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase() || "equipment choice";
}

function describeGearItems(items) {
  return (items || []).map(gearItemName).filter(Boolean).join(", ");
}

function splitCustomGear(text) {
  return String(text || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const leading = entry.match(/^(\d+)\s+(.+)$/);
      const trailing = entry.match(/^(.+?)\s+x\s*(\d+)$/i);

      if (leading) {
        return { quantity: Number(leading[1]), name: leading[2] };
      }

      if (trailing) {
        return { quantity: Number(trailing[2]), name: trailing[1] };
      }

      return { quantity: 1, name: entry };
    });
}

function getProfileSpellNames(profile) {
  const names = [];

  for (const entry of Object.values(profile.spellcastingByClass || {})) {
    names.push(...(entry.preparedSpells || []), ...(entry.knownSpells || []));
  }

  return [...new Set(names)];
}

function modeLabel(mode) {
  if (mode === "prepared") return "Prepared casting";
  if (mode === "known") return "Known spells";
  if (mode === "spellbook") return "Spellbook";
  return "Spellcasting";
}

function cleanText(text) {
  return String(text || "")
    .replace(/\{@(?:spell|item|condition|dice|damage|hit|dc|sense|variantrule|language|creature) ([^}|]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{@([^ }]+) ([^}|]+)(?:\|[^}]*)?\}/g, "$2")
    .replace(/#c$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abilityMod(score) {
  return Math.floor((Number(score || 10) - 10) / 2);
}

function formatModifier(value) {
  const number = Number(value || 0);
  return number >= 0 ? `+${number}` : String(number);
}

function toPositiveInt(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function toNonNegativeInt(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function capitalize(value) {
  return String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeFileName(value) {
  return String(value || "character")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
