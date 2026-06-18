const fs = require("fs");
const path = require("path");

const profilesDir = path.join(__dirname, "..", "profiles");

function ensureProfilesDir() {
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .trim();
}

function getUserProfileDir(discordUserId) {
  return path.join(profilesDir, String(discordUserId));
}

function ensureUserProfileDir(discordUserId) {
  ensureProfilesDir();

  const userDir = getUserProfileDir(discordUserId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  return userDir;
}

function getCharacterDir(discordUserId, characterName) {
  const safeCharacterName = sanitizeFileName(characterName || "character");
  return path.join(getUserProfileDir(discordUserId), safeCharacterName);
}

function ensureCharacterDir(discordUserId, characterName) {
  const characterDir = getCharacterDir(discordUserId, characterName);

  if (!fs.existsSync(characterDir)) {
    fs.mkdirSync(characterDir, { recursive: true });
  }

  return characterDir;
}

function getProfilePath(discordUserId, characterName) {
  return path.join(getCharacterDir(discordUserId, characterName), "profile.json");
}

function getActiveCharacterFilePath(discordUserId) {
  return path.join(getUserProfileDir(discordUserId), "activeCharacter.txt");
}

function setActiveCharacter(discordUserId, characterName) {
  ensureUserProfileDir(discordUserId);
  fs.writeFileSync(
    getActiveCharacterFilePath(discordUserId),
    sanitizeFileName(characterName),
    "utf8"
  );
}

function getActiveCharacterName(discordUserId) {
  const filePath = getActiveCharacterFilePath(discordUserId);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8").trim() || null;
}

function savePlayerProfile(discordUserId, profile) {
  ensureUserProfileDir(discordUserId);

  const characterName = sanitizeFileName(profile.characterName || "character");
  const characterDir = ensureCharacterDir(discordUserId, characterName);
  const filePath = path.join(characterDir, "profile.json");

  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf8");

  setActiveCharacter(discordUserId, characterName);

  return filePath;
}

function loadPlayerProfile(discordUserId, characterName = null) {
  ensureUserProfileDir(discordUserId);

  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return null;
  }

  const filePath = getProfilePath(discordUserId, resolvedCharacterName);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawText = fs.readFileSync(filePath, "utf8");
  return JSON.parse(rawText);
}

function profileExists(discordUserId, characterName = null) {
  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return false;
  }

  return fs.existsSync(getProfilePath(discordUserId, resolvedCharacterName));
}

function listCharacterNames(discordUserId) {
  const userDir = getUserProfileDir(discordUserId);

  if (!fs.existsSync(userDir)) {
    return [];
  }

  return fs
    .readdirSync(userDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function deletePlayerProfile(discordUserId, characterName = null) {
  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return false;
  }

  const characterDir = getCharacterDir(discordUserId, resolvedCharacterName);

  if (!fs.existsSync(characterDir)) {
    return false;
  }

  fs.rmSync(characterDir, { recursive: true, force: true });

  const remainingCharacters = listCharacterNames(discordUserId);

  if (remainingCharacters.length > 0) {
    setActiveCharacter(discordUserId, remainingCharacters[0]);
  } else {
    const activeFile = getActiveCharacterFilePath(discordUserId);
    if (fs.existsSync(activeFile)) {
      fs.unlinkSync(activeFile);
    }
  }

  return true;
}

function getPortraitPath(discordUserId, originalFileName = "portrait.png", characterName = null) {
  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return null;
  }

  const characterDir = ensureCharacterDir(discordUserId, resolvedCharacterName);
  const extension = path.extname(originalFileName) || ".png";

  return path.join(characterDir, `portrait${extension}`);
}

function deleteExistingPortraits(discordUserId, characterName = null) {
  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return;
  }

  const characterDir = getCharacterDir(discordUserId, resolvedCharacterName);

  if (!fs.existsSync(characterDir)) {
    return;
  }

  const files = fs.readdirSync(characterDir);

  for (const file of files) {
    if (file.startsWith("portrait.")) {
      fs.unlinkSync(path.join(characterDir, file));
    }
  }
}

function getPortraitFile(discordUserId, characterName = null) {
  const resolvedCharacterName =
    characterName || getActiveCharacterName(discordUserId);

  if (!resolvedCharacterName) {
    return null;
  }

  const characterDir = getCharacterDir(discordUserId, resolvedCharacterName);

  if (!fs.existsSync(characterDir)) {
    return null;
  }

  const files = fs.readdirSync(characterDir);
  const portraitFile = files.find((file) => file.startsWith("portrait."));

  if (!portraitFile) {
    return null;
  }

  return path.join(characterDir, portraitFile);
}

module.exports = {
  savePlayerProfile,
  loadPlayerProfile,
  profileExists,
  deletePlayerProfile,
  getUserProfileDir,
  getCharacterDir,
  getProfilePath,
  getPortraitPath,
  deleteExistingPortraits,
  getPortraitFile,
  listCharacterNames,
  setActiveCharacter,
  getActiveCharacterName,
};