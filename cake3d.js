(function () {
  const TOP_Y = 0.115;
  const STAR_R = 0.022;
  const glbUrl = "cake.glb";
  let gl, prog, cake = null, candles = null, flame = null, shadow = null, cpu = null;
  let mvp = new Float32Array(16);
  let ready = false;
  let litKey = "";
  let viewT = 0;
  let spin = 0;
  let windT = 0;
  let glow = null;
  const anchors = [];

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }
  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }
  function yaw(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ]);
  }
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function accessorArray(json, bin, index) {
    const acc = json.accessors[index];
    const bv = json.bufferViews[acc.bufferView];
    const comps = acc.type === "VEC3" ? 3 : acc.type === "VEC2" ? 2 : 1;
    const start = (bin.byteOffset || 0) + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    if (acc.componentType === 5126) return new Float32Array(bin.buffer, start, acc.count * comps);
    if (acc.componentType === 5125) return new Uint32Array(bin.buffer, start, acc.count);
    throw new Error("bad accessor");
  }
  function isStarVert(pos, nor, i) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nor[i * 3];
    return Math.abs(x) < 0.026 && Math.abs(z) < 0.21 && y > 0.08 && (y > 0.11 || Math.abs(nx) > 0.6);
  }
  function splitStar(pos, nor, idx) {
    const faces = idx.length / 3;
    const mark = new Uint8Array(faces);
    let starCount = 0;
    for (let f = 0, t = 0; f < faces; f++, t += 3) {
      if (isStarVert(pos, nor, idx[t]) && isStarVert(pos, nor, idx[t + 1]) && isStarVert(pos, nor, idx[t + 2])) {
        mark[f] = 1;
        starCount++;
      }
    }
    const star = new Uint32Array(starCount * 3);
    const body = new Uint32Array(idx.length - starCount * 3);
    let s = 0, b = 0;
    for (let f = 0, t = 0; f < faces; f++, t += 3) {
      if (mark[f]) {
        star[s++] = idx[t]; star[s++] = idx[t + 1]; star[s++] = idx[t + 2];
      } else {
        body[b++] = idx[t]; body[b++] = idx[t + 1]; body[b++] = idx[t + 2];
      }
    }
    return { star: star, body: body };
  }
  function buildSlots() {
    const xz = [
      [-0.108, -0.187], [0.108, -0.187],
      [-0.216, -0.125], [-0.144, -0.125], [0.144, -0.125], [0.216, -0.125],
      [-0.252, -0.062], [-0.18, -0.062], [-0.108, -0.062], [0.108, -0.062], [0.18, -0.062],
      [-0.216, 0], [-0.144, 0], [0.144, 0], [0.216, 0],
      [-0.252, 0.062], [-0.18, 0.062], [-0.108, 0.062], [0.108, 0.062], [0.18, 0.062],
      [-0.216, 0.125], [-0.144, 0.125], [0.144, 0.125], [0.216, 0.125],
      [-0.108, 0.187], [0.108, 0.187], [0.18, 0.187]
    ];
    return xz.map((p) => [p[0], TOP_Y, p[1]]);
  }
  function pushGlow(pos, x, y, z, r) {
    for (let i = 0; i < 10; i++) {
      const a0 = -Math.PI / 2 + i * Math.PI / 5;
      const a1 = a0 + Math.PI / 5;
      const r0 = i % 2 ? r * 0.42 : r;
      const r1 = (i + 1) % 2 ? r * 0.42 : r;
      pos.push(
        x, y, z,
        x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0,
        x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1
      );
    }
  }
  function pushStar(pos, col, x, y, z, r, color) {
    for (let i = 0; i < 10; i++) {
      const a0 = -Math.PI / 2 + i * Math.PI / 5;
      const a1 = a0 + Math.PI / 5;
      const r0 = i % 2 ? r * 0.42 : r;
      const r1 = (i + 1) % 2 ? r * 0.42 : r;
      pos.push(
        x, y, z,
        x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0,
        x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1
      );
      col.push(color[0], color[1], color[2], color[0], color[1], color[2], color[0], color[1], color[2]);
    }
  }
  function makeCandles(lit) {
    const pos = [];
    const col = [];
    const flames = [];
    anchors.forEach((p, i) => {
      const on = !!(lit && lit[i]);
      const color = on ? [1, 0.98, 0.86] : [1, 0.84, 0.32];
      pushStar(pos, col, p[0], p[1], p[2], STAR_R, color);
      if (on) {
        const fy = p[1] + STAR_R * 1.5;
        flames.push(
          p[0], fy, p[2], p[0] - STAR_R * 0.5, p[1] + STAR_R * 0.25, p[2], p[0] + STAR_R * 0.5, p[1] + STAR_R * 0.25, p[2],
          p[0], fy, p[2], p[0], p[1] + STAR_R * 0.25, p[2] - STAR_R * 0.5, p[0], p[1] + STAR_R * 0.25, p[2] + STAR_R * 0.5
        );
      }
    });
    return { pos: new Float32Array(pos), col: new Float32Array(col), flames: new Float32Array(flames) };
  }
  function uploadCandles(lit) {
    const mesh = makeCandles(lit);
    gl.bindBuffer(gl.ARRAY_BUFFER, candles.pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, candles.col);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.col, gl.DYNAMIC_DRAW);
    candles.count = mesh.pos.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, flame.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.flames, gl.DYNAMIC_DRAW);
    flame.count = mesh.flames.length / 3;
  }

  const vsCake = [
    "attribute vec3 aPos;",
    "attribute vec3 aNor;",
    "attribute vec2 aUv;",
    "uniform mat4 uMvp;",
    "uniform float uGap;",
    "uniform float uSide;",
    "varying vec2 vUv;",
    "varying vec3 vN;",
    "varying float vClip;",
    "void main(){",
    "  vec3 p = aPos;",
    "  vClip = 0.0;",
    "  if (uSide < 0.0 && p.x > 0.002) vClip = 1.0;",
    "  if (uSide > 0.0 && p.x < -0.002) vClip = 1.0;",
    "  p.x += uSide * uGap;",
    "  vUv = vec2(aUv.x, 1.0 - aUv.y);",
    "  vN = aNor;",
    "  gl_Position = uMvp * vec4(p, 1.0);",
    "}"
  ].join("\n");
  const fsCake = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "varying vec3 vN;",
    "varying float vClip;",
    "uniform sampler2D uTex;",
    "void main(){",
    "  if (vClip > 0.5) discard;",
    "  vec3 n = normalize(vN);",
    "  float lambert = max(dot(n, normalize(vec3(0.15, 0.92, 0.28))), 0.0);",
    "  float rim = pow(1.0 - max(dot(n, normalize(vec3(0.1, 0.25, 0.95))), 0.0), 2.2);",
    "  vec3 light = vec3(0.58, 0.52, 0.64) + vec3(0.5, 0.46, 0.42) * lambert + vec3(0.16, 0.2, 0.42) * rim;",
    "  vec3 tex = texture2D(uTex, vUv).rgb;",
    "  gl_FragColor = vec4(tex * light, 1.0);",
    "}"
  ].join("\n");
  const vsColor = [
    "attribute vec3 aPos;",
    "attribute vec3 aCol;",
    "uniform mat4 uMvp;",
    "uniform float uGap;",
    "varying vec3 vCol;",
    "void main(){",
    "  vec3 p = aPos;",
    "  if (p.x < 0.0) p.x -= uGap; else p.x += uGap;",
    "  vCol = aCol;",
    "  gl_Position = uMvp * vec4(p, 1.0);",
    "}"
  ].join("\n");
  const fsColor = [
    "precision mediump float;",
    "varying vec3 vCol;",
    "void main(){ gl_FragColor = vec4(vCol, 1.0); }"
  ].join("\n");
  const vsFlame = [
    "precision mediump float;",
    "attribute vec3 aPos;",
    "uniform mat4 uMvp;",
    "uniform float uGap;",
    "uniform float uWind;",
    "void main(){",
    "  vec3 p = aPos;",
    "  if (p.x < 0.0) p.x -= uGap; else p.x += uGap;",
    "  p.y += uWind * 0.16;",
    "  gl_Position = uMvp * vec4(p, 1.0);",
    "}"
  ].join("\n");
  const fsFlame = [
    "precision mediump float;",
    "uniform float uWind;",
    "void main(){ gl_FragColor = vec4(1.0, 0.92, 0.45, 0.95 * (1.0 - uWind * 0.85)); }"
  ].join("\n");
  const vsGlow = [
    "precision mediump float;",
    "attribute vec3 aPos;",
    "uniform mat4 uMvp;",
    "uniform float uGap;",
    "uniform float uWind;",
    "void main(){",
    "  vec3 p = aPos;",
    "  if (p.x < 0.0) p.x -= uGap; else p.x += uGap;",
    "  p.y += uWind * 0.07;",
    "  gl_Position = uMvp * vec4(p, 1.0);",
    "}"
  ].join("\n");
  const fsGlow = [
    "precision mediump float;",
    "uniform float uAlpha;",
    "void main(){ gl_FragColor = vec4(1.0, 0.94, 0.72, uAlpha); }"
  ].join("\n");
  const vsStar = [
    "attribute vec3 aPos;",
    "uniform mat4 uMvp;",
    "uniform float uGap;",
    "uniform float uSide;",
    "uniform float uScale;",
    "varying float vClip;",
    "varying vec3 vPos;",
    "void main(){",
    "  vec3 p = aPos;",
    "  vClip = 0.0;",
    "  if (uSide < 0.0 && p.x > 0.002) vClip = 1.0;",
    "  if (uSide > 0.0 && p.x < -0.002) vClip = 1.0;",
    "  vPos = aPos;",
    "  p.y = 0.29 + (p.y - 0.29) * uScale;",
    "  p.z *= uScale;",
    "  p.x += uSide * uGap;",
    "  gl_Position = uMvp * vec4(p, 1.0);",
    "}"
  ].join("\n");
  const fsStar = [
    "precision mediump float;",
    "varying float vClip;",
    "varying vec3 vPos;",
    "uniform float uTime;",
    "uniform float uSpark;",
    "uniform float uGlow;",
    "void main(){",
    "  if (vClip > 0.5) discard;",
    "  float breath = sin(uTime * 1.15);",
    "  float pulse = mix(1.0, 0.94 + 0.06 * breath, uSpark);",
    "  float band = abs(vPos.y - (0.22 + 0.18 * sin(uTime * 0.42)));",
    "  float gleam = smoothstep(0.12, 0.0, band) * uSpark;",
    "  vec3 env = vec3(0.9, 0.82, 0.7);",
    "  vec3 gold = vec3(1.0, 0.9, 0.16);",
    "  vec3 yellow = mix(gold, env, 0.08);",
    "  vec3 hot = vec3(1.0, 0.97, 0.45);",
    "  if (uGlow > 0.5) {",
    "    float a = 0.24 + 0.08 * breath * uSpark;",
    "    vec3 halo = mix(vec3(1.0, 0.92, 0.28), env, 0.1);",
    "    gl_FragColor = vec4(halo, a);",
    "    return;",
    "  }",
    "  gl_FragColor = vec4(mix(yellow, hot, gleam) * pulse, 1.0);",
    "}"
  ].join("\n");

  function initGl(canvas) {
    if (!gl || gl.isContextLost()) {
      gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
      prog = null;
    }
    if (!gl) throw new Error("no webgl");
    gl.getExtension("OES_element_index_uint");
    if (!prog) {
      prog = {
        cake: program(gl, vsCake, fsCake),
        color: program(gl, vsColor, fsColor),
        flame: program(gl, vsFlame, fsFlame),
        glow: program(gl, vsGlow, fsGlow),
        star: program(gl, vsStar, fsStar)
      };
    }
  }
  function decodeParts(parts) {
    const chunks = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const bin = atob(parts[i]);
      const arr = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      chunks.push(arr);
      total += arr.length;
      parts[i] = "";
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], o);
      o += chunks[i].length;
    }
    return out.buffer;
  }
  function ingest(buf) {
    const view = new DataView(buf);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    const binStart = 20 + jsonLen + 8;
    const bin = new Uint8Array(buf, binStart);
    const prim = json.meshes[0].primitives[0];
    const pos = accessorArray(json, bin, prim.attributes.POSITION);
    const nor = accessorArray(json, bin, prim.attributes.NORMAL);
    const uv = accessorArray(json, bin, prim.attributes.TEXCOORD_0);
    const idx = accessorArray(json, bin, prim.indices);
    const parts = splitStar(pos, nor, idx);
    const bv = json.bufferViews[json.images[0].bufferView];
    const blob = new Blob([bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength)], { type: "image/jpeg" });
    const img = new Image();
    img.onload = () => {
      cpu = { pos: pos, nor: nor, uv: uv, bodyIdx: parts.body, starIdx: parts.star, img: img };
      if (!anchors.length) anchors.push.apply(anchors, buildSlots());
      ready = true;
      if (img.src.indexOf("blob:") === 0) URL.revokeObjectURL(img.src);
    };
    img.onerror = () => { window.__cakeErr = "cake texture"; };
    img.src = URL.createObjectURL(blob);
  }
  function fitTexture(img) {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    if (img.width <= max && img.height <= max) return img;
    const scale = max / Math.max(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.floor(img.width * scale));
    c.height = Math.max(1, Math.floor(img.height * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function load() {
    if (cake || window.__cakeLoad) return;
    window.__cakeLoad = true;
    const fail = (err) => { window.__cakeErr = String(err && err.stack || err); };
    if (window.CAKE_GLB_PARTS && window.CAKE_GLB_PARTS.length) {
      try {
        const buf = decodeParts(window.CAKE_GLB_PARTS);
        window.CAKE_GLB_PARTS = null;
        ingest(buf);
        return;
      } catch (err) {
        fail(err);
      }
    }
    fetch(glbUrl).then((r) => {
      if (!r.ok) throw new Error("cake " + r.status);
      return r.arrayBuffer();
    }).then(ingest).catch(fail);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function frameMatrices(canvas, split, mode) {
    const aspect = canvas.width / Math.max(1, canvas.height);
    let t = viewT;
    if (mode === "side") t = 0;
    else if (mode === "top") t = 1;
    t = Math.max(0, Math.min(1, t));
    const eye = [lerp(2.05, 0.06, t), lerp(1.02, 2.15, t), lerp(0.32, 0, t)];
    const target = [0, lerp(-0.04, 0.08, t), 0];
    if (mode === "side" && !document.documentElement.classList.contains("reduce")) {
      eye[2] += Math.sin(performance.now() / 2200) * 0.05;
    }
    const proj = perspective(lerp(0.74, 0.56, t), aspect, 0.05, 24);
    const view = lookAt(eye, target, [0, 1, 0]);
    mvp = mul(proj, mul(view, yaw(spin)));
    return (split || 0) * 0.2;
  }
  function bindCake(side, gap) {
    const p = prog.cake;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(p, "uGap"), gap);
    gl.uniform1f(gl.getUniformLocation(p, "uSide"), side);
    gl.uniform1i(gl.getUniformLocation(p, "uTex"), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, cake.posBuf);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, cake.norBuf);
    const ln = gl.getAttribLocation(p, "aNor");
    gl.enableVertexAttribArray(ln);
    gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, cake.uvBuf);
    const lu = gl.getAttribLocation(p, "aUv");
    gl.enableVertexAttribArray(lu);
    gl.vertexAttribPointer(lu, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cake.bodyIdx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cake.tex);
  }
  function drawColor(gap) {
    const p = prog.color;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(p, "uGap"), gap);
    gl.bindBuffer(gl.ARRAY_BUFFER, candles.pos);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, candles.col);
    const lc = gl.getAttribLocation(p, "aCol");
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, candles.count);
    gl.disableVertexAttribArray(lc);
  }
  function drawGlow(gap, lit) {
    if (!glow || !lit || !lit.some(Boolean)) return;
    const pos = [];
    const wobble = Math.sin(performance.now() / 240);
    anchors.forEach((p, i) => {
      if (!lit[i]) return;
      const pulse = 1 + wobble * 0.16;
      pushGlow(pos, p[0], p[1] + 0.008, p[2], STAR_R * 1.55 * pulse);
      pushGlow(pos, p[0], p[1] + 0.014, p[2], STAR_R * 2.15 * pulse);
    });
    if (!pos.length) return;
    const arr = new Float32Array(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, glow.buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    const p = prog.glow;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(p, "uGap"), gap);
    gl.uniform1f(gl.getUniformLocation(p, "uAlpha"), 0.38 * (1 - windT));
    gl.uniform1f(gl.getUniformLocation(p, "uWind"), windT);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, arr.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(loc);
  }
  function drawFlames(gap) {
    if (!flame.count) return;
    const p = prog.flame;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(p, "uGap"), gap);
    gl.uniform1f(gl.getUniformLocation(p, "uWind"), windT);
    gl.bindBuffer(gl.ARRAY_BUFFER, flame.buf);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    if (windT > 0.02) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLES, 0, flame.count);
    if (windT > 0.02) gl.disable(gl.BLEND);
  }
  function drawBigStar(side, gap, scale, glowPass, time, spark) {
    if (!cake.starCount) return;
    const p = prog.star;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(p, "uGap"), gap);
    gl.uniform1f(gl.getUniformLocation(p, "uSide"), side);
    gl.uniform1f(gl.getUniformLocation(p, "uScale"), scale);
    gl.uniform1f(gl.getUniformLocation(p, "uTime"), time);
    gl.uniform1f(gl.getUniformLocation(p, "uSpark"), spark);
    gl.uniform1f(gl.getUniformLocation(p, "uGlow"), glowPass);
    gl.bindBuffer(gl.ARRAY_BUFFER, cake.posBuf);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cake.starIdx);
    if (glowPass > 0.5) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
    } else {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
    }
    gl.drawElements(gl.TRIANGLES, cake.starCount, gl.UNSIGNED_INT, 0);
    if (glowPass > 0.5) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    } else {
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }
  function ensureGpu(canvas) {
    if (!cpu) return false;
    if (gl && gl.isContextLost()) return false;
    if (cake && gl && gl.canvas === canvas) return true;
    initGl(canvas);
    const source = fitTexture(cpu.img);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cpu.pos, gl.STATIC_DRAW);
    const norBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cpu.nor, gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cpu.uv, gl.STATIC_DRAW);
    const bodyIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bodyIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cpu.bodyIdx, gl.STATIC_DRAW);
    const starIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, starIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cpu.starIdx, gl.STATIC_DRAW);
    cake = {
      posBuf: posBuf, norBuf: norBuf, uvBuf: uvBuf, tex: tex,
      bodyIdx: bodyIdx, bodyCount: cpu.bodyIdx.length,
      starIdx: starIdx, starCount: cpu.starIdx.length
    };
    candles = { pos: gl.createBuffer(), col: gl.createBuffer(), count: 0 };
    flame = { buf: gl.createBuffer(), count: 0 };
    glow = { buf: gl.createBuffer() };
    litKey = "";
    uploadCandles([]);
    if (!canvas.__cakeHook) {
      canvas.__cakeHook = true;
      canvas.addEventListener("webglcontextlost", function (ev) {
        ev.preventDefault();
        cake = null;
        prog = null;
      });
      canvas.addEventListener("webglcontextrestored", function () {
        cake = null;
        prog = null;
        try { ensureGpu(canvas); } catch (err) { window.__cakeErr = String(err && err.stack || err); }
      });
    }
    return true;
  }
  function render(canvas, split, lit, mode) {
    if (!canvas) return;
    if (!ready) return;
    try {
      if (!ensureGpu(canvas)) return;
    } catch (err) {
      window.__cakeErr = String(err && err.stack || err);
      return;
    }
    const key = (lit || []).map((v) => (v ? "1" : "0")).join("");
    if (key !== litKey) { litKey = key; uploadCandles(lit); }
    const gap = frameMatrices(canvas, split || 0, mode || "side");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const reduce = document.documentElement.classList.contains("reduce");
    const time = reduce ? 0 : performance.now() / 1000;
    const spark = reduce ? 0 : 1;
    const halo = reduce ? 1.08 : 1.04 + Math.sin(time * 1.15) * 0.035;
    const sides = gap < 0.004 ? [0] : [-1, 1];
    for (let i = 0; i < sides.length; i++) {
      bindCake(sides[i], gap);
      gl.drawElements(gl.TRIANGLES, cake.bodyCount, gl.UNSIGNED_INT, 0);
    }
    for (let i = 0; i < sides.length; i++) drawBigStar(sides[i], gap, 1, 0, time, spark);
    for (let i = 0; i < sides.length; i++) drawBigStar(sides[i], gap, halo, 1, time, spark);
    drawColor(gap);
    drawFlames(gap);
    drawGlow(gap, lit || []);
  }
  function project(i, canvas, split, mode) {
    if (!ready || !anchors[i]) return null;
    frameMatrices(canvas, split || 0, mode || "top");
    const gap = (split || 0) * 0.2;
    const p = anchors[i];
    const x = p[0] + (p[0] < 0 ? -gap : gap);
    const y = p[1];
    const z = p[2];
    const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (!w) return null;
    const cx = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / w;
    const cy = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / w;
    return {
      x: (cx * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (cy * 0.5 + 0.5)) * canvas.clientHeight
    };
  }
  window.Cake3D = {
    load: load,
    render: render,
    project: project,
    setView: function (t) { viewT = t; },
    setSpin: function (a) { spin = a || 0; },
    setWind: function (t) { windT = Math.max(0, Math.min(1, t || 0)); },
    get view() { return viewT; },
    get ready() { return ready; }
  };
})();
