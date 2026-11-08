// ЭКСПЕРИМЕНТ (в игру не встроен): варианты «живой» поверхности моря на WebGL.
// Подключается поверх игры в тестовом браузере; window.VARIANT = 'flow' | 'swell' | 'gust' | 'caust'.
// Рисует отдельный холст под слоем пены; маска моря — sea.png (WV.mask), мелководье — размытая маска.
(() => {
  const wrap = $('mapwrap'), cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1';
  wrap.insertBefore(cv, $('wavecv'));
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
  if (!gl) { console.log('EXP: no webgl'); return; }
  const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FS = `precision highp float;
uniform vec2 uRes; uniform vec4 uView; uniform vec2 uMap; uniform float uT; uniform int uMode; uniform vec2 uWind;
uniform sampler2D uSea, uSeaB;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uView.w;      // css-пиксели экрана
  vec2 mp = (sp - uView.xy) / uView.z;                                    // пиксели карты
  float sea = texture2D(uSea, mp / uMap).a;
  if (sea < 0.01) { gl_FragColor = vec4(0.0); return; }
  float shallow = clamp(1.0 - texture2D(uSeaB, mp / uMap).a, 0.0, 1.0);  // 0 — открытое море, к берегу → 1
  float z = uView.z, T = uT, sh = 0.0, lightA = 0.0, darkA = 0.0;
  vec3 L = normalize(vec3(-0.55, -0.6, 0.6));
  if (uMode == 1) {          // «Течение»: медленные перетекающие светлые и тёмные разводы (изогнутый шум)
    vec2 p = mp / 110.0; float t = T * 0.045;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.8, 0.0)));
    vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + uWind * t * 0.6), fbm(p + 2.0 * q + vec2(8.3, 2.8) - uWind.yx * t * 0.4));
    float f = fbm(p + 2.2 * r);
    sh = (f - 0.5) * 2.6;
    lightA = 0.16; darkA = 0.14;
  } else if (uMode == 2) {   // «Зыбь»: набегающие пологие волны со светотенью (свет — слева сверху)
    vec2 g = vec2(0.0); float base = atan(uWind.y, uWind.x);
    for (int i = 0; i < 10; i++) {
      float fi = float(i), lam = 10.0 + 4.5 * fi + 4.0 * hash(vec2(fi, 3.0));
      float ang = base + (hash(vec2(fi, 7.0)) - 0.5) * 1.8 + (i > 7 ? 1.25 : 0.0);   // две последние — встречная «старая» зыбь
      vec2 d = vec2(cos(ang), sin(ang)); float k = 6.2832 / lam, w = sqrt(3.3 * k);
      float aa = smoothstep(4.0, 10.0, lam * z);                       // слишком мелкие на экране — гасим (без муара)
      float st = 0.085 * aa * (0.6 + 0.4 * hash(vec2(fi, 11.0)));
      g += st * cos(dot(d, mp) * k - w * T + 6.2832 * hash(vec2(fi, 5.0))) * d;
    }
    // группы волн: где-то зыбь сильнее, где-то вода почти гладкая
    g *= 0.25 + 1.2 * smoothstep(0.3, 0.7, fbm(mp / 85.0 + uWind * T * 0.025));
    vec3 n = normalize(vec3(-g, 1.0));
    sh = (dot(n, L) - L.z) * 3.0;
    lightA = 0.24; darkA = 0.2;
  } else if (uMode == 3) {   // «Порывы ветра»: тёмные пятна ряби бегут по ветру, между ними — гладкая светлая вода
    float gust = fbm(mp / 120.0 - uWind * T * 9.0 / 120.0 + vec2(0.0, sin(T * 0.05) * 0.3));
    gust = smoothstep(0.5, 0.63, gust);
    vec2 g = vec2(0.0); float base = atan(uWind.y, uWind.x);
    for (int i = 0; i < 6; i++) {
      float fi = float(i), lam = 3.0 + 1.4 * fi, ang = base + (hash(vec2(fi, 2.0)) - 0.5) * 1.8;
      vec2 d = vec2(cos(ang), sin(ang)); float k = 6.2832 / lam;
      float aa = smoothstep(3.0, 7.0, lam * z);
      g += 0.14 * aa * cos(dot(d, mp) * k - sqrt(3.3 * k) * T * 1.4 + 6.2832 * hash(vec2(fi, 9.0))) * d;
    }
    vec3 n = normalize(vec3(-g * gust, 1.0));
    float rip = (dot(n, L) - L.z) * 3.0;
    sh = -0.75 * gust + 0.22 * (1.0 - gust) + rip * gust;
    lightA = 0.18; darkA = 0.26;
  } else if (uMode == 4) {   // «Блики»: сетка солнечных бликов (каустика) — у берегов ярче, в открытом море едва видна
    vec2 p = mod(mp / 34.0 * 6.2832, 6.2832) - 250.0, i = p; float c = 1.0, inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float t = T * 0.22 * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 4.0; c = 1.17 - pow(c, 1.4);
    float col = pow(abs(c), 8.0);
    float aa = smoothstep(2.5, 6.0, z * 34.0 / 6.0);
    sh = clamp(col, 0.0, 1.0) * (0.08 + 1.0 * smoothstep(0.05, 0.45, shallow)) * aa;
    sh += 0.06 * (fbm(mp / 90.0 + T * 0.02) - 0.5);
    lightA = 0.55; darkA = 0.1;
  }
  float a = sh > 0.0 ? min(1.0, sh) * lightA : min(1.0, -sh) * darkA;
  vec3 col = sh > 0.0 ? vec3(0.90, 0.96, 0.99) : vec3(0.02, 0.10, 0.20);
  a *= sea;
  gl_FragColor = vec4(col * a, a);
}`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.log('EXP shader: ' + gl.getShaderInfoLog(o)); return o; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.log('EXP link: ' + gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const ap = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
  const tex = (src, unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); return t; };
  tex(WV.mask, 0);
  const bc = document.createElement('canvas'); bc.width = WV.mask.width; bc.height = WV.mask.height; const bx = bc.getContext('2d');
  bx.filter = 'blur(7px)'; bx.drawImage(WV.mask, 0, 0); tex(bc, 1);
  const U = n => gl.getUniformLocation(pr, n);
  gl.uniform1i(U('uSea'), 0); gl.uniform1i(U('uSeaB'), 1);
  const MODES = { flow: 1, swell: 2, gust: 3, caust: 4 };
  window.EXP = T => {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const v = UI.view, wl = Math.hypot(WIND[0], WIND[1]);
    gl.uniform2f(U('uRes'), cv.width, cv.height); gl.uniform4f(U('uView'), v.x, v.y, v.z, dpr); gl.uniform2f(U('uMap'), MAPINFO.W, MAPINFO.H);
    gl.uniform1f(U('uT'), T); gl.uniform1i(U('uMode'), MODES[window.VARIANT] || 0); gl.uniform2f(U('uWind'), WIND[0] / wl, WIND[1] / wl);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
})();
