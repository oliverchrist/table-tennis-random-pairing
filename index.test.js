const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function application(seed = 1) {
  const elements = new Map();
  const storage = new Map();
  const errors = [];
  let now = 1000000;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function element() {
    return {
      textContent: "", value: "", hidden: false, disabled: false,
      children: [], style: {}, listeners: {}, classList: { toggle() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      focus() {}, showModal() {},
      close() { if (this.listeners.close) this.listeners.close(); }
    };
  }
  const context = vm.createContext({
    Math: math,
    Date: { now: () => now },
    crypto: { randomUUID },
    console: { error: (...args) => errors.push(args) },
    setInterval() {},
    document: {
      title: "", hidden: false, addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  });
  vm.runInContext(`${script}
    globalThis.app = {
      get state() { return state; },
      set state(value) { state = value; },
      freshState, addPlayers, createRound, isValidState, save, load, tick,
      optimalGroups, splitTeams, encounterMaps, pairKey, eachPair,
      getElement: $, get storageKey() { return STORAGE_KEY; }
    };`, context);
  return { app: context.app, context, storage, errors, advance: ms => { now += ms; } };
}

function addNumbered(app, count) {
  app.addPlayers(Array.from({ length: count }, (_, i) => `Spieler ${i + 1}`));
}

function checkRound(app, count) {
  const round = app.state.rounds.at(-1);
  const playing = round.groups.flat(2);
  expect(round.groups.length).toBeLessThanOrEqual(3);
  round.groups.forEach(teams => {
    expect(teams).toHaveLength(2);
    teams.forEach(team => {
      expect(team.length).toBeGreaterThanOrEqual(1);
      expect(team.length).toBeLessThanOrEqual(2);
      team.forEach((player, index) => expect(player.position).toBe(team.length === 1 ? "center" : index === 0 ? "left" : "right"));
    });
  });
  const everyone = [...playing, ...round.waiting, ...round.paused];
  expect(everyone).toHaveLength(count);
  expect(new Set(everyone.map(p => p.id)).size).toBe(count);
  expect(playing.length).toBe(Math.min(count, 12));
  expect(app.isValidState(app.state)).toBe(true);
}

describe("Rundeneinteilung", () => {
  test.each(Array.from({ length: 15 }, (_, i) => i + 2))("%i Personen werden vollständig und ohne doppelte Plätze verteilt", count => {
    const { app } = application(count);
    addNumbered(app, count);
    app.createRound();
    checkRound(app, count);
    const sizes = Array.from(app.state.rounds[0].groups, group => group.flat().length).sort();
    if (count === 10) expect(sizes).toEqual([3, 3, 4]);
    if (count === 11) expect(sizes).toEqual([3, 4, 4]);
    if (count >= 12) expect(sizes).toEqual([4, 4, 4]);
  });

  test("0 oder 1 verfügbare Person erzeugt keine Runde und verbraucht keine Pause", () => {
    const { app } = application();
    app.createRound();
    expect(app.state.rounds).toHaveLength(0);
    addNumbered(app, 2);
    app.state.players[0].pause = true;
    app.createRound();
    expect(app.state.rounds).toHaveLength(0);
    expect(app.state.players[0].pause).toBe(true);
    expect(app.getElement("notice").textContent).toMatch(/mindestens 2/);
  });

  test.each([1, 2, 3, 4, 5])("12 Personen erreichen in Runde 2 das exakte Optimum von 3 wiederholten Paaren (Seed %i)", seed => {
    const { app } = application(seed);
    addNumbered(app, 12);
    app.createRound();
    app.createRound();
    checkRound(app, 12);
    expect(app.state.rounds[1].repeats).toBe(3);
    expect(app.state.rounds[1].historicalRepeats).toBe(3);
    const previous = new Set();
    app.state.rounds[0].groups.forEach(teams => teams.forEach(team => app.eachPair(team, key => previous.add(key))));
    app.state.rounds[1].groups.forEach(teams => teams.forEach(team => app.eachPair(team, key => expect(previous.has(key)).toBe(false))));
  });

  test("8 Personen haben in Runde 2 genau 4 unvermeidbare Wiederholungen", () => {
    const { app } = application();
    addNumbered(app, 8);
    app.createRound(); app.createRound();
    expect(app.state.rounds[1].repeats).toBe(4);
  });

  test.each([13, 17, 24, 25, 100])("Unfreiwillige Wartezeiten bleiben bei %i Personen fair", count => {
    const { app } = application(count);
    addNumbered(app, count);
    for (let i = 0; i < 20; i++) {
      app.createRound();
      checkRound(app, count);
      const waits = app.state.players.map(p => p.waits);
      expect(Math.max(...waits) - Math.min(...waits)).toBeLessThanOrEqual(1);
    }
  });

  test("Pause gilt genau eine Runde; Hinzufügen/Entfernen verändert keine vergangene Einteilung", () => {
    const { app } = application();
    addNumbered(app, 12);
    app.createRound();
    const firstRound = JSON.stringify(app.state.rounds[0]);
    const paused = app.state.players[0];
    paused.pause = true;
    const removed = app.state.players.pop();
    app.addPlayers(["Nachzügler"]);
    expect(JSON.stringify(app.state.rounds[0])).toBe(firstRound);
    app.createRound();
    const second = app.state.rounds[1];
    expect(second.paused.map(p => p.id)).toContain(paused.id);
    expect(second.groups.flat(2).map(p => p.id)).not.toContain(removed.id);
    expect(second.groups.flat(2).map(p => p.name)).toContain("Nachzügler");
    expect(paused.pause).toBe(false);
    expect(paused.games).toBe(1);
    expect(paused.waits).toBe(0);
    app.createRound();
    expect(app.state.rounds[2].groups.flat(2).map(p => p.id)).toContain(paused.id);
  });

  test("Gruppensuche minimiert auch die historische Gewichtung bei gleicher Vorrundenwertung", () => {
    const { app } = application();
    addNumbered(app, 6);
    const players = app.state.players;
    const counts = new Map([[app.pairKey(players[0].id, players[1].id), 5]]);
    const result = app.optimalGroups(players, [3, 3], { counts, recent: new Set() });
    expect(Array.from(result.score)).toEqual([0, 0]);
    expect(result.groups.some(group => group.includes(players[0]) && group.includes(players[1]))).toBe(false);
  });

  test("Doppelte Namen und ungültige Eingaben werden ausdrücklich gemeldet", () => {
    const { app } = application();
    expect(app.addPlayers([])).toBe(false);
    expect(app.addPlayers(["Anna", "anna", "Ben"])).toBe(true);
    expect(app.state.players).toHaveLength(2);
    expect(app.getElement("notice").textContent).toMatch(/doppelte Namen/);
    expect(app.addPlayers(["ANNA"])).toBe(false);
    expect(app.addPlayers(["x".repeat(81)])).toBe(false);
    expect(app.state.players).toHaveLength(2);
  });

  test("Alle Spieler entfernen erfordert Bestätigung und erhält Runde, Timer und Historie", () => {
    const { app } = application();
    expect(app.getElement("clear-players").disabled).toBe(true);
    addNumbered(app, 12); app.createRound();
    app.getElement("timer-toggle").onclick();
    const rounds = JSON.stringify(app.state.rounds);
    const timer = JSON.stringify(app.state.timer);
    expect(app.getElement("clear-players").disabled).toBe(false);
    app.getElement("clear-players").onclick();
    expect(app.state.players).toHaveLength(12);
    app.getElement("confirm-cancel").onclick();
    expect(app.state.players).toHaveLength(12);
    app.getElement("clear-players").onclick();
    app.getElement("confirm-ok").onclick();
    expect(app.state.players).toHaveLength(0);
    expect(JSON.stringify(app.state.rounds)).toBe(rounds);
    expect(JSON.stringify(app.state.timer)).toBe(timer);
    expect(app.getElement("clear-players").disabled).toBe(true);
    expect(app.getElement("next-round").disabled).toBe(true);
    app.state = app.freshState(); app.load();
    expect(app.state.players).toHaveLength(0);
    expect(JSON.stringify(app.state.rounds)).toBe(rounds);
    expect(JSON.stringify(app.state.timer)).toBe(timer);
    expect(app.isValidState(app.state)).toBe(true);
    addNumbered(app, 2);
    expect(app.getElement("next-round").disabled).toBe(false);
  });
});

describe("Doppelpartner und Links-/Rechtspositionen", () => {
  test("Erneute Begegnungen werden auf gegnerische Teams verteilt, selbst bei langer Partnerhistorie", () => {
    const { app } = application();
    addNumbered(app, 4);
    const [a, b, c, d] = app.state.players;
    const maps = app.encounterMaps([]);
    maps.recent.add(app.pairKey(a.id, b.id));
    maps.recent.add(app.pairKey(c.id, d.id));
    for (const [first, second] of [[a, c], [a, d], [b, c], [b, d]]) maps.partners.set(app.pairKey(first.id, second.id), 2000);
    const teams = app.splitTeams([a, b, c, d], maps);
    teams.forEach(team => app.eachPair(team, key => expect(maps.recent.has(key)).toBe(false)));
  });

  test.each([3, 4])("Unvermeidbare Doppelpartner tauschen bei %i Personen beide Positionen, auch nach einer Pause", count => {
    const { app } = application();
    addNumbered(app, count);
    const players = app.state.players;
    const first = { ...players[0], position: "left" };
    const second = { ...players[1], position: "right" };
    const others = players.slice(2).map((p, index) => ({ ...p, position: count === 3 ? "center" : index === 0 ? "left" : "right" }));
    const maps = app.encounterMaps([
      { groups: [[[first, second], others]] },
      { groups: [] }
    ]);
    for (const a of players) for (const b of players) {
      if (a.id !== b.id && !maps.partners.has(app.pairKey(a.id, b.id))) maps.partners.set(app.pairKey(a.id, b.id), 20);
    }
    const teams = app.splitTeams(players, maps);
    const repeated = teams.find(team => team.some(p => p.id === first.id));
    expect(repeated.map(p => p.id)).toContain(second.id);
    expect(repeated.find(p => p.id === first.id).position).toBe("right");
    expect(repeated.find(p => p.id === second.id).position).toBe("left");
    if (count === 4) {
      const otherTeam = teams.find(team => team !== repeated);
      expect(otherTeam.find(p => p.id === others[0].id).position).toBe("right");
      expect(otherTeam.find(p => p.id === others[1].id).position).toBe("left");
    } else expect(teams.find(team => team !== repeated)[0].position).toBe("center");
  });

  test("Bekannte Doppelpartner werden unabhängig von der direkt letzten Runde vermieden", () => {
    const { app } = application();
    addNumbered(app, 4);
    const players = app.state.players;
    const maps = app.encounterMaps([{ groups: [[[players[0], players[1]], [players[2], players[3]]]] }, { groups: [] }]);
    app.splitTeams(players, maps).forEach(team => app.eachPair(team, key => expect(maps.partners.has(key)).toBe(false)));
  });

  test("Bei sonst gleicher Bewertung wechseln einzelne Spieler ihre letzte Links-/Rechtsposition", () => {
    const { app } = application();
    addNumbered(app, 4);
    const players = app.state.players;
    const maps = app.encounterMaps([]);
    players.forEach((p, index) => maps.lastPositions.set(p.id, index % 2 === 0 ? "left" : "right"));
    app.splitTeams(players, maps).flat().forEach(p => expect(p.position).not.toBe(maps.lastPositions.get(p.id)));
  });

  test("Positionen bleiben gespeichert; alte Einteilungen bleiben gültig ohne erfundene Positionen", () => {
    const { app } = application();
    addNumbered(app, 4); app.createRound();
    const original = JSON.stringify(app.state);
    app.state = app.freshState(); app.load();
    expect(JSON.stringify(app.state)).toBe(original);
    expect(app.isValidState(app.state)).toBe(true);
    const old = JSON.parse(original);
    old.rounds[0].groups.flat(2).forEach(p => { delete p.position; });
    expect(app.isValidState(old)).toBe(true);
    const maps = app.encounterMaps(old.rounds);
    expect(maps.partnerPositions.size).toBe(0);
    expect(maps.lastPositions.size).toBe(0);
    const invalid = JSON.parse(original);
    invalid.rounds[0].groups[0][0][0].position = "right";
    expect(app.isValidState(invalid)).toBe(false);
    const partial = JSON.parse(original);
    delete partial.rounds[0].groups[0][0][0].position;
    expect(app.isValidState(partial)).toBe(false);
  });
});

describe("Timer und Speicherung", () => {
  test("Timer lässt sich starten, pausieren und fortsetzen und läuft über Tab-Abwesenheit weiter", () => {
    const { app, advance } = application();
    addNumbered(app, 2);
    app.createRound();
    app.getElement("timer-toggle").onclick();
    expect(app.state.timer.mode).toBe("running");
    advance(2000);
    app.getElement("timer-toggle").onclick();
    expect(app.state.timer.remaining).toBe(598000);
    expect(app.state.timer.mode).toBe("paused");
    advance(5000); app.tick();
    expect(app.state.timer.remaining).toBe(598000);
    app.getElement("timer-toggle").onclick();
    advance(598001); app.tick();
    expect(app.state.timer.mode).toBe("finished");
    expect(app.getElement("timer-readout").textContent).toBe("00:00");
    expect(app.getElement("notice").textContent).toMatch(/Zeit vorbei/);
    expect(app.state.rounds).toHaveLength(1);
    expect(app.getElement("timer-toggle").disabled).toBe(true);
  });

  test("Eingestellte Minuten und aktive Timer überstehen erneutes Laden", () => {
    const { app, advance } = application();
    addNumbered(app, 12); app.createRound();
    app.getElement("duration").value = "0.1";
    app.getElement("duration").listeners.change();
    expect(app.state.duration).toBe(.1);
    expect(app.state.timer.remaining).toBe(6000);
    app.getElement("timer-toggle").onclick();
    const before = JSON.stringify(app.state);
    app.state = app.freshState();
    app.load();
    expect(JSON.stringify(app.state)).toBe(before);
    advance(6001); app.tick();
    expect(app.state.timer.mode).toBe("finished");
    expect(app.isValidState(app.state)).toBe(true);
  });

  test("Kaputte gespeicherte Daten bleiben bis zur nächsten Änderung erhalten und werden gemeldet", () => {
    const { app, storage, errors } = application();
    storage.set(app.storageKey, "{kaputt");
    app.load();
    expect(app.state.players).toHaveLength(0);
    expect(storage.get(app.storageKey)).toBe("{kaputt");
    expect(app.getElement("notice").textContent).toMatch(/nicht geladen/);
    expect(errors).toHaveLength(1);
    const invalid = JSON.parse(JSON.stringify(app.freshState()));
    invalid.duration = -1;
    expect(app.isValidState(invalid)).toBe(false);
    invalid.duration = 10;
    invalid.timer.mode = "running";
    invalid.timer.deadline = 100;
    expect(app.isValidState(invalid)).toBe(false);
    addNumbered(app, 2);
    const duplicate = JSON.parse(JSON.stringify(app.state));
    duplicate.players[1].id = duplicate.players[0].id;
    expect(app.isValidState(duplicate)).toBe(false);
  });

  test("Ungültige Rundenzeit verändert weder Timer noch gespeicherte Dauer", () => {
    const { app } = application();
    for (const invalid of ["", "0", "-2", "181", "NaN"]) {
      app.getElement("duration").value = invalid;
      app.getElement("duration").listeners.change();
      expect(app.state.duration).toBe(10);
      expect(app.state.timer.remaining).toBe(600000);
      expect(app.getElement("notice").textContent).toMatch(/zwischen 0,1 und 180/);
    }
  });

  test("Blockierter Speicher führt zu einer sichtbaren Warnung, nicht zu einem falschen Erfolg", () => {
    const { app, context, errors } = application();
    context.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    addNumbered(app, 2); app.createRound();
    expect(app.state.rounds).toHaveLength(1);
    expect(app.getElement("notice").textContent).toMatch(/nicht speichern/);
    expect(errors.length).toBeGreaterThan(0);
  });
});
