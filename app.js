(function () {
  "use strict";
  var IMG = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp", "ico"];
  var VID = ["mp4", "m4v", "webm", "mov", "ogv"];
  var files = [];
  var selected = {};
  var cards = {};
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
  }
  function linkOf(name) { return location.origin + "/f/" + encodeURIComponent(name); }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }
  function setStatus(s) { $("status").textContent = s; }

  function copyText(text) {
    return new Promise(function (resolve) {
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        resolve(ok);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, fallback);
      } else {
        fallback();
      }
    });
  }

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || "Error");
        return j;
      });
    });
  }

  function selectedNames() {
    return files.filter(function (f) { return selected[f.name]; }).map(function (f) { return f.name; });
  }
  function updateSel() {
    var n = 0;
    files.forEach(function (f) {
      var c = cards[f.name];
      if (!c) return;
      if (selected[f.name]) { c.classList.add("sel"); n++; } else { c.classList.remove("sel"); }
    });
    $("count").textContent = n + " selected";
  }

  function makeCard(f) {
    var card = document.createElement("div");
    card.className = "card";

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    var ext = extOf(f.name);
    if (IMG.indexOf(ext) >= 0) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.src = "/f/" + encodeURIComponent(f.name);
      img.alt = f.name;
      thumb.appendChild(img);
    } else if (VID.indexOf(ext) >= 0) {
      var v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.src = "/f/" + encodeURIComponent(f.name) + "#t=0.1";
      thumb.appendChild(v);
    } else {
      var e = document.createElement("div");
      e.className = "ext";
      e.textContent = ext || "file";
      thumb.appendChild(e);
    }
    var chk = document.createElement("span");
    chk.className = "check";
    thumb.appendChild(chk);
    thumb.addEventListener("click", function () {
      selected[f.name] = !selected[f.name];
      updateSel();
    });
    card.appendChild(thumb);

    var info = document.createElement("div");
    info.className = "info";
    var nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = f.name;
    var sz = document.createElement("span");
    sz.className = "sz";
    sz.textContent = fmtSize(f.size);
    info.appendChild(nm);
    info.appendChild(sz);
    card.appendChild(info);

    var act = document.createElement("div");
    act.className = "actions";
    var b1 = document.createElement("button");
    b1.type = "button";
    b1.textContent = "\uD83D\uDD17 Link";
    b1.addEventListener("click", function () {
      copyText(linkOf(f.name)).then(function (ok) { toast(ok ? "Link copied" : "Copy failed"); });
    });
    var a = document.createElement("a");
    a.href = "/f/" + encodeURIComponent(f.name);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open";
    var b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "del";
    b2.textContent = "Delete";
    b2.addEventListener("click", function () {
      if (!confirm("Delete " + f.name + "?")) return;
      api("/api/delete", { names: [f.name] }).then(function () {
        delete selected[f.name];
        load();
      }, function (e) { toast(e.message); });
    });
    act.appendChild(b1);
    act.appendChild(a);
    act.appendChild(b2);
    card.appendChild(act);
    return card;
  }

  function render() {
    var grid = $("grid");
    grid.textContent = "";
    cards = {};
    var keep = {};
    files.forEach(function (f) {
      var c = makeCard(f);
      cards[f.name] = c;
      grid.appendChild(c);
      if (selected[f.name]) keep[f.name] = true;
    });
    selected = keep;
    $("empty").hidden = files.length > 0;
    updateSel();
  }

  function load() {
    return fetch("/api/files", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      files = j.files || [];
      render();
    }).catch(function () { toast("Could not load files"); });
  }

  function uploadOne(file, i, total) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open("POST", "/api/upload?ext=" + encodeURIComponent(extOf(file.name) || "bin"));
      x.upload.onprogress = function (e) {
        if (e.lengthComputable) setStatus("Uploading " + i + "/" + total + " - " + Math.round(e.loaded * 100 / e.total) + "%");
      };
      x.onload = function () {
        if (x.status === 200) {
          try { resolve(JSON.parse(x.responseText).name); } catch (e) { resolve(null); }
        } else { resolve(null); }
      };
      x.onerror = function () { resolve(null); };
      x.send(file);
    });
  }

  function uploadAll(list) {
    var arr = Array.prototype.slice.call(list);
    if (!arr.length) return;
    var added = [];
    var failed = 0;
    var chain = Promise.resolve();
    arr.forEach(function (file, idx) {
      chain = chain.then(function () {
        return uploadOne(file, idx + 1, arr.length).then(function (name) {
          if (name) added.push(name); else failed++;
        });
      });
    });
    chain.then(function () {
      added.forEach(function (n) { selected[n] = true; });
      setStatus("");
      toast(failed ? ("Uploaded " + added.length + ", failed " + failed) : ("Uploaded " + added.length));
      return load();
    });
  }

  $("picker").addEventListener("change", function (e) {
    uploadAll(e.target.files);
    e.target.value = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); $("drop").classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); $("drop").classList.remove("over"); });
  });
  document.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) uploadAll(e.dataTransfer.files);
  });

  $("selAll").addEventListener("click", function () {
    files.forEach(function (f) { selected[f.name] = true; });
    updateSel();
  });
  $("selNone").addEventListener("click", function () {
    selected = {};
    updateSel();
  });

  $("getLinks").addEventListener("click", function () {
    var names = selectedNames();
    if (!names.length) return toast("Select files first");
    var text = names.map(linkOf).join("\n");
    $("links").value = text;
    $("linksBox").hidden = false;
    copyText(text).then(function (ok) { toast(ok ? (names.length + " links copied") : "Tap Copy all"); });
  });
  $("copyAll").addEventListener("click", function () {
    copyText($("links").value).then(function (ok) { toast(ok ? "Copied" : "Copy failed"); });
  });
  $("closeLinks").addEventListener("click", function () { $("linksBox").hidden = true; });

  $("delSel").addEventListener("click", function () {
    var names = selectedNames();
    if (!names.length) return toast("Select files first");
    if (!confirm("Delete " + names.length + " file(s)?")) return;
    api("/api/delete", { names: names }).then(function () {
      selected = {};
      $("linksBox").hidden = true;
      load();
    }, function (e) { toast(e.message); });
  });

  $("renameBtn").addEventListener("click", function () {
    var names = selectedNames();
    if (!names.length) return toast("Select files first");
    var prefix = $("prefix").value.trim();
    if (!/^[A-Za-z0-9_-]{0,12}$/.test(prefix)) return toast("Prefix: letters, numbers, - _ only");
    var start = parseInt($("start").value, 10);
    if (isNaN(start) || start < 0) start = 1;
    var items = names.map(function (n, i) {
      return { from: n, to: prefix + (start + i) + "." + extOf(n) };
    });
    api("/api/rename", { items: items }).then(function () {
      selected = {};
      items.forEach(function (it) { selected[it.to] = true; });
      $("linksBox").hidden = true;
      toast("Renamed " + items.length);
      load();
    }, function (e) { toast(e.message); });
  });

  load();
})();
