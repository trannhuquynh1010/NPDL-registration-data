import fs from "node:fs";
import path from "node:path";

const dataPath = path.join(process.cwd(), "data", "room-registrations.json");
const validRooms = new Set(["Room 1", "Room 2", "Room 3"]);

function normalizeValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeRoom(value) {
  const room = normalizeValue(value);
  const match = room.match(/room\s*([123])/i);
  return match ? `Room ${match[1]}` : room;
}

function readPayload() {
  const rawPayload = process.env.REGISTRATION_PAYLOAD || "{}";
  try {
    return JSON.parse(rawPayload);
  } catch {
    throw new Error("REGISTRATION_PAYLOAD is not valid JSON.");
  }
}

function readDataFile() {
  if (!fs.existsSync(dataPath)) {
    return {
      updatedAt: "",
      rooms: {
        "Room 1": [],
        "Room 2": [],
        "Room 3": []
      }
    };
  }

  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function sortParticipants(participants) {
  return participants.sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

const payload = readPayload();
const name = normalizeValue(payload.teacherName || payload.name);
const subject = normalizeValue(payload.subject);
const room = normalizeRoom(payload.room || payload.selectedRoom);

if (!name) {
  throw new Error("Missing teacherName in registration payload.");
}

if (!validRooms.has(room)) {
  throw new Error(`Invalid room in registration payload: ${room || "(empty)"}`);
}

const data = readDataFile();
data.rooms = data.rooms || {};
validRooms.forEach((roomName) => {
  data.rooms[roomName] = Array.isArray(data.rooms[roomName]) ? data.rooms[roomName] : [];
});

validRooms.forEach((roomName) => {
  data.rooms[roomName] = data.rooms[roomName].filter((participant) => {
    return normalizeValue(participant.name).toLowerCase() !== name.toLowerCase();
  });
});

data.rooms[room].push({
  name,
  subject,
  updatedAt: new Date().toISOString()
});

validRooms.forEach((roomName) => {
  data.rooms[roomName] = sortParticipants(data.rooms[roomName]);
});

data.updatedAt = new Date().toISOString();

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
