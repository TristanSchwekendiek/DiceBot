const {
  savePlayerProfile,
  loadPlayerProfile,
  profileExists,
  deletePlayerProfile,
} = require("../utils/profileStorage");

const testUserId = "123456789";
const testProfile = {
  playerName: "Mari",
  characterName: "Poka Dought",
  race: "Human",
  subrace: "Mulan",
  alignment: "Chaotic Good",
  background: "Criminal",
  level: 4,
  class: "Cleric",
  subclass: "Peace Domain",
  experience: 2800,
  ac: 18,
  hp: {
    current: 32,
    max: 32,
  },
  initiative: 2,
  passivePerception: 16,
  proficiencyBonus: 2,
  abilities: {
    str: 16,
    dex: 15,
    con: 16,
    int: 12,
    wis: 22,
    cha: 14,
  },
  abilityModifiers: {
    str: 3,
    dex: 2,
    con: 3,
    int: 1,
    wis: 6,
    cha: 2,
  },
  savingThrows: {
    str: 3,
    dex: 2,
    con: 3,
    int: 1,
    wis: 8,
    cha: 4,
  },
};

try {
  console.log("Exists before save:", profileExists(testUserId));

  savePlayerProfile(testUserId, testProfile);
  console.log("Profile saved.");

  console.log("Exists after save:", profileExists(testUserId));

  const loadedProfile = loadPlayerProfile(testUserId);
  console.log("Loaded profile:");
  console.log(JSON.stringify(loadedProfile, null, 2));

  const deleted = deletePlayerProfile(testUserId);
  console.log("Deleted:", deleted);

  console.log("Exists after delete:", profileExists(testUserId));
} catch (error) {
  console.error("Storage test failed:");
  console.error(error.message);
}