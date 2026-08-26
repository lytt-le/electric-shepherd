/* =====================================================================
   library.js  -  saving, loading, exporting sheep
   ---------------------------------------------------------------------
   Every sheep is a plain JSON document, so a .sheep.json file is the
   canonical, portable format. Browser storage is only a convenience
   cache and always degrades gracefully to in-memory.
   ===================================================================== */
(function (global) {
  'use strict';

  var GEN = global.FlameGenome;
  // Storage keys and the export format tag keep their original names on
  // purpose: renaming them after the Electric Shepherd rebrand would hide
  // every flock already saved in a browser and reject every exported file.
  var KEY = 'electric-sheep-flock-v1';
  var SETTINGS_KEY = 'electric-sheep-settings-v1';

  function safeGet(key) {
    try { return global.localStorage ? global.localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { if (global.localStorage) { global.localStorage.setItem(key, val); return true; } }
    catch (e) { return false; }
    return false;
  }

  function Library() {
    this.items = [];
    this.persistent = false;
    this.load();
  }

  Library.prototype.load = function () {
    var raw = safeGet(KEY);
    if (!raw) { this.persistent = safeSet(KEY, '[]'); return; }
    try {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (it && it.genome) { it.genome = GEN.normalize(it.genome); this.items.push(it); }
        }
      }
      this.persistent = true;
    } catch (e) { this.persistent = false; }
  };

  Library.prototype.save = function () {
    var payload;
    try { payload = JSON.stringify(this.items); } catch (e) { return false; }
    if (safeSet(KEY, payload)) { this.persistent = true; return true; }
    // quota trouble: drop thumbnails, then oldest entries
    var stripped = this.items.map(function (it) { return { id: it.id, name: it.name, created: it.created, fav: it.fav, genome: it.genome }; });
    try { if (safeSet(KEY, JSON.stringify(stripped))) return true; } catch (e) { /* fall through */ }
    var trimmed = stripped.slice(-60);
    try { return safeSet(KEY, JSON.stringify(trimmed)); } catch (e) { return false; }
  };

  Library.prototype.add = function (genome, thumb) {
    var g = GEN.clone(genome);
    var item = {
      id: g.id || ('s' + Date.now().toString(36)),
      name: g.name,
      created: g.created || new Date().toISOString(),
      fav: false,
      thumb: thumb || null,
      genome: g
    };
    // avoid exact duplicates
    var fp = GEN.fingerprint(g);
    for (var i = 0; i < this.items.length; i++) {
      if (GEN.fingerprint(this.items[i].genome) === fp) { this.items[i].thumb = thumb || this.items[i].thumb; this.save(); return this.items[i]; }
    }
    this.items.push(item);
    this.save();
    return item;
  };

  Library.prototype.remove = function (id) {
    this.items = this.items.filter(function (i) { return i.id !== id; });
    this.save();
  };
  Library.prototype.get = function (id) {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i];
    return null;
  };
  Library.prototype.rename = function (id, name) {
    var it = this.get(id); if (!it) return;
    it.name = name; it.genome.name = name; this.save();
  };
  Library.prototype.toggleFav = function (id) {
    var it = this.get(id); if (!it) return;
    it.fav = !it.fav; this.save();
  };
  Library.prototype.clear = function () { this.items = []; this.save(); };
  Library.prototype.move = function (id, dir) {
    var idx = this.items.findIndex(function (i) { return i.id === id; });
    if (idx < 0) return;
    var to = idx + dir;
    if (to < 0 || to >= this.items.length) return;
    var tmp = this.items[idx]; this.items[idx] = this.items[to]; this.items[to] = tmp;
    this.save();
  };

  /* ---------------- file IO ------------------------------------------ */
  function sanitise(name) {
    return String(name || 'sheep').replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '-').slice(0, 60) || 'sheep';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  function exportGenome(g) {
    var txt = GEN.serialize(g);
    downloadBlob(new Blob([txt], { type: 'application/json' }), sanitise(g.name) + '.sheep.json');
  }

  Library.prototype.exportAll = function (filename) {
    var payload = {
      format: 'electric-sheep-local-flock',
      version: 1,
      exported: new Date().toISOString(),
      sheep: this.items.map(function (i) { return i.genome; })
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      filename || 'flock-' + new Date().toISOString().slice(0, 10) + '.flock.json');
  };

  Library.prototype.importText = function (txt) {
    var data = JSON.parse(txt);
    var list = [];
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.sheep)) list = data.sheep;
    else list = [data];
    var added = [];
    for (var i = 0; i < list.length; i++) {
      var g = GEN.normalize(list[i]);
      if (g) added.push(this.add(g, null));
    }
    return added;
  };

  function readFiles(fileList, cb) {
    var files = Array.prototype.slice.call(fileList);
    var results = [];
    var pending = files.length;
    if (!pending) { cb(results); return; }
    files.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () { results.push({ name: f.name, text: fr.result }); if (--pending === 0) cb(results); };
      fr.onerror = function () { if (--pending === 0) cb(results); };
      fr.readAsText(f);
    });
  }

  /* ---------------- app settings (non-genome preferences) ------------ */
  function loadSettings(defaults) {
    var raw = safeGet(SETTINGS_KEY);
    if (!raw) return Object.assign({}, defaults);
    try { return Object.assign({}, defaults, JSON.parse(raw)); }
    catch (e) { return Object.assign({}, defaults); }
  }
  function saveSettings(obj) {
    try { return safeSet(SETTINGS_KEY, JSON.stringify(obj)); } catch (e) { return false; }
  }
  // true once anything has ever been saved - lets the app tell a brand new
  // visitor (worth calibrating quality for) from a returning one.
  function hasSettings() { return safeGet(SETTINGS_KEY) != null; }

  global.FlameLibrary = {
    Library: Library,
    exportGenome: exportGenome,
    downloadBlob: downloadBlob,
    readFiles: readFiles,
    sanitise: sanitise,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    hasSettings: hasSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
