const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "analog.html"), "utf8");
const moves = [...html.matchAll(/data-from="(\d+)" data-to="(\d+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
const permutation = moves.map(([, to]) => to - 1);
const pair = (a, b) => [a, b].sort((x, y) => x - y).join("-");

function rounds(count, mapping = permutation) {
  const result = [];
  let seats = mapping.map((_, index) => index);
  for (let r = 0; r < count; r++) {
    result.push(seats);
    seats = seats.map(seat => mapping[seat]);
  }
  return result;
}

function pairs(seats, team = false) {
  const result = new Set();
  for (let a = 0; a < seats.length; a++) for (let b = a + 1; b < seats.length; b++) {
    if (seats[a] < 12 && seats[b] < 12 && Math.floor(seats[a] / (team ? 2 : 4)) === Math.floor(seats[b] / (team ? 2 : 4))) result.add(pair(a, b));
  }
  return result;
}

test("Der statische Ausdruck hat zwölf eindeutige Ziele und einen einzigen vollständigen Zyklus", () => {
  expect(moves.map(([from]) => from)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(new Set(permutation).size).toBe(12);
  expect([...new Set(permutation)].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  const simulated = rounds(13);
  expect(simulated[12]).toEqual(simulated[0]);
  for (let player = 0; player < 12; player++) expect(new Set(simulated.slice(0, 12).map(seats => seats[player])).size).toBe(12);
  expect(html).not.toMatch(/<script\b/i);
  expect(html).toContain("size: A4 landscape");
});

test("Bei jedem Wechsel inklusive Zyklusgrenze sind genau drei Begegnungspaare wiederholt und keine Partner", () => {
  const simulated = rounds(13);
  for (let r = 1; r < simulated.length; r++) {
    const previous = pairs(simulated[r - 1]);
    expect([...pairs(simulated[r])].filter(key => previous.has(key))).toHaveLength(3);
    const previousTeams = pairs(simulated[r - 1], true);
    expect([...pairs(simulated[r], true)].filter(key => previousTeams.has(key))).toHaveLength(0);
  }
});

test("Die beworbenen Begegnungszahlen und Positionswechsel stimmen", () => {
  const simulated = rounds(25);
  const tablemates = Array.from({ length: 12 }, () => new Set());
  const partners = Array.from({ length: 12 }, () => new Set());
  const lastPartnerPositions = new Map();
  simulated.forEach((seats, index) => {
    for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) {
      if (Math.floor(seats[a] / 4) !== Math.floor(seats[b] / 4)) continue;
      if (index < 12) { tablemates[a].add(b); tablemates[b].add(a); }
      if (Math.floor(seats[a] / 2) !== Math.floor(seats[b] / 2)) continue;
      if (index < 12) { partners[a].add(b); partners[b].add(a); }
      const key = pair(a, b), positions = [seats[a] % 2, seats[b] % 2];
      if (lastPartnerPositions.has(key)) {
        const previous = lastPartnerPositions.get(key);
        expect(positions[0]).not.toBe(previous[0]);
        expect(positions[1]).not.toBe(previous[1]);
      }
      lastPartnerPositions.set(key, positions);
    }
  });
  expect(tablemates.map(set => set.size)).toEqual(Array(12).fill(10));
  expect(partners.map(set => set.size)).toEqual(Array(12).fill(4));
});

test("Die Ziele auf den Platten entsprechen der Wechselübersicht", () => {
  const seats = [...html.matchAll(/<strong class="number">(\d+)<\/strong><span class="destination">weiter zu (\d+) →<\/span>/g)];
  expect(seats).toHaveLength(12);
  seats.forEach(([, from, to]) => expect(permutation[Number(from) - 1] + 1).toBe(Number(to)));
});

test("Die optionale Bank lässt einen Leerplatz mitwandern und verteilt Pausen gleichmäßig", () => {
  const withBank = [...permutation, permutation[11]];
  withBank[11] = 12;
  expect(html).toContain("12 → 13 (Pause) → 4");
  expect(withBank[11]).toBe(12);
  expect(withBank[12]).toBe(3);
  const simulated = rounds(14, withBank);
  expect(simulated[13]).toEqual(simulated[0]);
  for (let player = 0; player < 12; player++) expect(simulated.slice(0, 13).filter(seats => seats[player] === 12)).toHaveLength(1);
  simulated.slice(0, 13).forEach(seats => {
    const occupied = seats.slice(0, 12);
    expect(new Set(occupied).size).toBe(12);
    const playing = occupied.filter(seat => seat < 12);
    expect([11, 12]).toContain(playing.length);
    for (let table = 0; table < 3; table++) expect([3, 4]).toContain(playing.filter(seat => Math.floor(seat / 4) === table).length);
  });
});
