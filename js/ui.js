/* =====================================================================
   ui.js  -  tiny declarative control toolkit for the side panel
   ===================================================================== */
(function (global) {
  'use strict';

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  /* A collection of controls that can all be refreshed from the model. */
  function Panel(root) {
    this.root = root;
    this.controls = [];
  }
  Panel.prototype.refresh = function () {
    for (var i = 0; i < this.controls.length; i++) {
      try { this.controls[i].update(); } catch (e) { /* control detached */ }
    }
  };
  Panel.prototype.clear = function () { this.root.innerHTML = ''; this.controls = []; };
  Panel.prototype.add = function (c) { this.controls.push(c); return c; };

  var groupState = {};

  function group(parent, title, opts) {
    opts = opts || {};
    var key = (opts.key || title);
    var collapsed = (key in groupState) ? groupState[key] : !!opts.collapsed;
    var body = el('div', { class: 'gbody' });
    var h = el('h3', { text: title });
    var g = el('div', { class: 'group' + (collapsed ? ' collapsed' : '') }, [h, body]);
    h.addEventListener('click', function () {
      g.classList.toggle('collapsed');
      groupState[key] = g.classList.contains('collapsed');
    });
    parent.appendChild(g);
    return body;
  }

  function row(parent, label, ctlNodes, title) {
    var ctl = el('div', { class: 'ctl' }, ctlNodes);
    var r = el('div', { class: 'row', title: title || null }, [el('label', { text: label }), ctl]);
    parent.appendChild(r);
    return r;
  }

  function fmtNum(v, step) {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (step >= 1) return v.toFixed(0);
    if (step >= 0.1) return v.toFixed(1);
    if (step >= 0.01) return v.toFixed(2);
    return v.toFixed(3);
  }

  var NUM_RE = /-?\d*\.?\d+(?:[eE][+-]?\d+)?/;

  /* A slider whose readout is also an input, so any value can be typed.
     `toDisplay` / `fromDisplay` let a control whose slider works in one
     unit (log zoom, say) accept the number the user actually sees. */
  function slider(panel, parent, o) {
    var step = o.step === undefined ? 0.01 : o.step;
    var toDisp = o.toDisplay || function (v) { return v; };
    var fromDisp = o.fromDisplay || function (v) { return v; };
    var inp = el('input', { type: 'range', min: o.min, max: o.max, step: step });
    var val = el('input', { type: 'text', class: 'val', spellcheck: 'false', title: 'type a value' });
    var editing = false;

    function show(v) { if (!editing) val.value = o.fmt ? o.fmt(v) : fmtNum(v, step); }

    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      show(v); o.set(v);
    });

    val.addEventListener('focus', function () {
      editing = true;
      var raw = toDisp(parseFloat(inp.value));
      val.value = String(Math.round(raw * 1e6) / 1e6);
      setTimeout(function () { try { val.select(); } catch (e) { } }, 0);
    });
    function commit() {
      if (!editing) return;
      editing = false;
      var m = NUM_RE.exec(String(val.value));
      var cur = parseFloat(inp.value);
      if (!m) { show(cur); return; }
      var v = fromDisp(parseFloat(m[0]));
      if (!isFinite(v)) { show(cur); return; }
      v = Math.max(+o.min, Math.min(+o.max, v));
      inp.value = v;
      o.set(v);
      show(v);
      if (o.after) o.after();
    }
    val.addEventListener('blur', commit);
    val.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); val.blur(); }
      else if (e.key === 'Escape') { editing = false; show(parseFloat(inp.value)); val.blur(); }
    });

    var r = row(parent, o.label, [inp, val], o.title);
    if (o.reset !== undefined && r.firstChild) {
      r.firstChild.style.cursor = 'pointer';
      r.firstChild.title = 'double-click to reset';
      r.firstChild.addEventListener('dblclick', function () {
        o.set(o.reset); inp.value = o.reset; show(o.reset); if (o.after) o.after();
      });
    }
    var c = { el: inp, update: function () { var v = o.get(); if (document.activeElement !== val) { inp.value = v; show(v); } } };
    c.update();
    panel.add(c);
    return c;
  }

  function number(panel, parent, o) {
    var inp = el('input', { type: 'number', step: o.step === undefined ? 'any' : o.step, min: o.min, max: o.max });
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) { c.update(); return; }
      o.set(v);
    });
    row(parent, o.label, [inp], o.title);
    var c = { el: inp, update: function () { inp.value = o.get(); } };
    c.update(); panel.add(c); return c;
  }

  function check(panel, parent, o) {
    var inp = el('input', { type: 'checkbox' });
    inp.style.flex = '0 0 auto';
    inp.style.width = '14px';
    inp.style.accentColor = '#ff8a3d';
    inp.addEventListener('change', function () { o.set(inp.checked); });
    row(parent, o.label, [inp, el('span', { class: 'hint', text: o.note || '', style: 'margin:0' })], o.title);
    var c = { el: inp, update: function () { inp.checked = !!o.get(); } };
    c.update(); panel.add(c); return c;
  }

  function select(panel, parent, o) {
    var sel = el('select');
    (o.options || []).forEach(function (op) {
      var v = (typeof op === 'string') ? op : op.value;
      var t = (typeof op === 'string') ? op : op.label;
      sel.appendChild(el('option', { value: v, text: t }));
    });
    sel.addEventListener('change', function () { o.set(sel.value); });
    row(parent, o.label, [sel], o.title);
    var c = {
      el: sel,
      setOptions: function (opts) {
        var cur = sel.value; sel.innerHTML = '';
        opts.forEach(function (op) {
          var v = (typeof op === 'string') ? op : op.value;
          var t = (typeof op === 'string') ? op : op.label;
          sel.appendChild(el('option', { value: v, text: t }));
        });
        sel.value = cur;
      },
      update: function () { sel.value = o.get(); }
    };
    c.update(); panel.add(c); return c;
  }

  function text(panel, parent, o) {
    var inp = el('input', { type: 'text' });
    inp.addEventListener('change', function () { o.set(inp.value); });
    row(parent, o.label, [inp], o.title);
    var c = { el: inp, update: function () { if (document.activeElement !== inp) inp.value = o.get(); } };
    c.update(); panel.add(c); return c;
  }

  function color(panel, parent, o) {
    var inp = el('input', { type: 'color' });
    inp.style.flex = '0 0 44px';
    inp.addEventListener('input', function () { o.set(inp.value); });
    row(parent, o.label, [inp], o.title);
    var c = { el: inp, update: function () { inp.value = o.get(); } };
    c.update(); panel.add(c); return c;
  }

  function buttons(parent, list, cls) {
    var r = el('div', { class: 'btnrow' + (cls ? ' ' + cls : '') });
    list.forEach(function (b) {
      if (!b) return;
      var btn = el('button', { text: b.label, title: b.title || null, class: b.class || '' , onclick: b.onclick });
      if (b.ref) b.ref(btn);
      r.appendChild(btn);
    });
    parent.appendChild(r);
    return r;
  }

  function hint(parent, txt) { parent.appendChild(el('div', { class: 'hint', text: txt })); return parent; }

  global.UI = {
    el: el, Panel: Panel, group: group, row: row,
    slider: slider, number: number, check: check, select: select,
    text: text, color: color, buttons: buttons, hint: hint, fmtNum: fmtNum
  };
})(typeof window !== 'undefined' ? window : globalThis);
