const fs = require("fs");
const path = require("path");
const { importDMVCharacter } = require("../dmvImporter");

try {
  const filePath = path.join(__dirname, "(Mari) Poka Dought-dmv.json");
  const rawText = fs.readFileSync(filePath, "utf8");
  const rawData = JSON.parse(rawText);

  const profile = importDMVCharacter(rawData);

  console.log("Imported profile:");
  console.log(JSON.stringify(profile, null, 2));
} catch (error) {
  console.error("Import failed:");
  console.error(error.message);
}