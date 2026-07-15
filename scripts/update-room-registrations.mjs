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

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readPayload() {
  const rawPayload = process.env.REGISTRATION_PAYLOAD || "{}";
  try {
    return parseMaybeJson(JSON.parse(rawPayload));
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

function getParticipantKey(name, subject) {
  return `${normalizeValue(name).toLowerCase()}|${normalizeValue(subject).toLowerCase()}`;
}

function flattenPayload(value, pathParts = []) {
  const parsedValue = parseMaybeJson(value);

  if (Array.isArray(parsedValue)) {
    return parsedValue.flatMap((item, index) => flattenPayload(item, [...pathParts, String(index)]));
  }

  if (parsedValue && typeof parsedValue === "object") {
    return Object.entries(parsedValue).flatMap(([key, item]) => flattenPayload(item, [...pathParts, key]));
  }

  return [
    {
      key: pathParts.join("."),
      value: parsedValue
    }
  ];
}

function looksLikeMetadata(entry) {
  const key = entry.key.toLowerCase();
  const value = normalizeValue(entry.value);

  if (!value) {
    return true;
  }

  if (/\b(id|email|responder|submit|submission|date|time|form|etag|token|webhook|resource)\b/i.test(key)) {
    return true;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return true;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return true;
  }

  return false;
}

function extractRegistration(payload) {
  const entries = flattenPayload(payload);
  const textEntries = entries
    .map((entry) => ({
      key: entry.key,
      value: normalizeValue(entry.value)
    }))
    .filter((entry) => entry.value);

  let room = normalizeRoom(payload.room || payload.selectedRoom || payload.selected_room);
  let name = normalizeValue(payload.teacherName || payload.teacher_name || payload.name);
  let subject = normalizeValue(payload.subject);

  if (!validRooms.has(room)) {
    const roomEntry = textEntries.find((entry) => {
      return /room|phòng|select/i.test(entry.key) || validRooms.has(normalizeRoom(entry.value));
    });
    room = normalizeRoom(roomEntry?.value);
  }

  if (!name) {
    const nameEntry = textEntries.find((entry) => /teacher|name|tên|ho.?ten|họ.?tên/i.test(entry.key));
    name = normalizeValue(nameEntry?.value);
  }

  if (!subject) {
    const subjectEntry = textEntries.find((entry) => /subject|môn|bo.?mon|bộ.?môn/i.test(entry.key));
    subject = normalizeValue(subjectEntry?.value);
  }

  const answerCandidates = textEntries
    .filter((entry) => !looksLikeMetadata(entry))
    .map((entry) => entry.value)
    .filter((value) => !validRooms.has(normalizeRoom(value)));

  if (!name && answerCandidates.length) {
    name = answerCandidates[0];
  }

  if (!subject) {
    subject = answerCandidates.find((value) => value !== name) || "";
  }

  return {
    name,
    subject,
    room
  };
}

const payload = readPayload();
const { name, subject, room } = extractRegistration(payload);

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
  const incomingKey = getParticipantKey(name, subject);
  data.rooms[roomName] = data.rooms[roomName].filter((participant) => {
    return getParticipantKey(participant.name, participant.subject) !== incomingKey;
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
